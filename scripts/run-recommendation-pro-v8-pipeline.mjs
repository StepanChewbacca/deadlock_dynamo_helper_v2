#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

const DATASET_VERSION = 'RECOMMENDATION_DECISION_DATASET_V5_3';
const PIPELINE_VERSION = 'RECOMMENDATION_PRO_V8_PIPELINE_1';
const BEHAVIOR_VERSION = 'RECOMMENDATION_BEHAVIORAL_V5_PRO_CANDIDATE_SET_1';
const VALUE_VERSION = 'RECOMMENDATION_VALUE_V8_PRO_RESIDUAL_ADVANTAGE_1';
const POLICY_VERSION = 'RECOMMENDATION_POLICY_V8_PRO_DR_1';
const PRO_SOURCES = new Set(['PRO_HISTORICAL', 'PRO_LIVE']);
const HORIZONS = [
  ['3m', 1],
  ['5m', 0.75],
  ['10m', 0.5],
];
const SCALE_CANDIDATES = [0.25, 0.5, 1, 2, 4];
const BEHAVIOR_FOLDS = 3;
const MIN_PROPENSITY = 0.01;
const MAX_IMPORTANCE_WEIGHT = 10;
const MIN_OBSERVATIONS = 10;
const BOOTSTRAP_SAMPLES = 200;

const args = parseArgs(process.argv.slice(2));
const sourceDirectory = requiredArg(args, 'source-dir');
const outputDirectory = requiredArg(args, 'output-dir');
const mode = args.mode === 'full' ? 'full' : 'diagnostic';
const maxRows = args['max-rows']
  ? positiveInteger(args['max-rows'], 'max-rows')
  : mode === 'diagnostic'
    ? 250_000
    : undefined;
const baselineEvaluationPath = args['baseline-evaluation'];

await main();

async function main() {
  const startedAt = new Date().toISOString();
  await mkdir(outputDirectory, { recursive: true });
  const source = await loadAndValidateSource(sourceDirectory);

  console.log(`[pro-v8] source=${source.datasetPath}`);
  console.log(`[pro-v8] mode=${mode} maxRows=${maxRows ?? 'all'}`);

  const audit = await auditSource(source.datasetPath, maxRows);
  assertAudit(audit);
  await atomicJson(join(outputDirectory, '10-dataset-audit.json'), {
    pipelineVersion: PIPELINE_VERSION,
    generatedAt: new Date().toISOString(),
    source: source.descriptor,
    ...audit,
  });

  const split = chronologicalMatchSplit(audit.matches);
  await atomicJson(join(outputDirectory, '20-split.json'), split);

  console.log(
    `[pro-v8] split train=${split.trainMatchIds.length} tuning=${split.tuningMatchIds.length} test=${split.testMatchIds.length}`,
  );

  const trainSet = new Set(split.trainMatchIds);
  const tuningSet = new Set(split.tuningMatchIds);
  const testSet = new Set(split.testMatchIds);

  const behavior = createBehaviorModel();
  const stateModel = createValueTable();
  const matchDecisionCounts = new Map();

  await eachPreparedRow(source.datasetPath, maxRows, async (row) => {
    if (!trainSet.has(row.matchId)) return;
    const fold = foldForMatch(row.matchId);
    updateBehaviorModel(behavior, row, fold);
    updateValueTable(stateModel, row.stateKey, row.targetUtility, fold, 1);
    matchDecisionCounts.set(
      row.matchId,
      (matchDecisionCounts.get(row.matchId) ?? 0) + 1,
    );
  });

  const behaviorTuning = await evaluateBehavior(
    source.datasetPath,
    maxRows,
    tuningSet,
    behavior,
    false,
  );
  const behaviorTemperature = selectBehaviorTemperature(behaviorTuning.rows);
  const behaviorTest = await evaluateBehavior(
    source.datasetPath,
    maxRows,
    testSet,
    behavior,
    false,
    behaviorTemperature,
  );

  const behavioralReport = {
    version: BEHAVIOR_VERSION,
    generatedAt: new Date().toISOString(),
    folds: BEHAVIOR_FOLDS,
    temperature: behaviorTemperature,
    tuning: summarizeBehaviorRows(behaviorTuning.rows, behaviorTemperature),
    test: summarizeBehaviorRows(behaviorTest.rows, behaviorTemperature),
    gate: {
      candidateCoverage: behaviorTest.candidateCoverage,
      behaviorSupport: behaviorTest.supportCoverage,
      passed:
        behaviorTest.candidateCoverage >= 0.99 &&
        behaviorTest.supportCoverage >= 0.9,
    },
  };
  await atomicJson(join(outputDirectory, '30-behavioral-v5-report.json'), behavioralReport);

  console.log(
    `[pro-v8] behavior support=${behavioralReport.test.supportCoverage.toFixed(4)} logLoss=${behavioralReport.test.logLoss.toFixed(6)}`,
  );

  const actionModel = createValueTable();
  await eachPreparedRow(source.datasetPath, maxRows, async (row) => {
    if (!trainSet.has(row.matchId)) return;
    const fold = foldForMatch(row.matchId);
    const statePrediction = predictValueTableCrossFit(
      stateModel,
      row.stateKey,
      fold,
      20,
    );
    const behaviorProbabilities = behaviorProbabilitiesForRow(
      behavior,
      row,
      behaviorTemperature,
      fold,
    );
    const propensity =
      behaviorProbabilities.find((entry) => entry.actionKey === row.observedActionKey)
        ?.probability ?? MIN_PROPENSITY;
    const importanceWeight = Math.min(
      MAX_IMPORTANCE_WEIGHT,
      1 / Math.max(MIN_PROPENSITY, propensity),
    );
    const matchWeight = 1 / Math.max(1, matchDecisionCounts.get(row.matchId) ?? 1);
    const residual = clamp(row.targetUtility - statePrediction.mean, -1, 1);
    for (const key of row.observedActionFeatureKeys) {
      updateValueTable(
        actionModel,
        key,
        residual,
        fold,
        matchWeight * importanceWeight,
      );
    }
  });

  const tuningEvaluations = [];
  for (const scale of SCALE_CANDIDATES) {
    tuningEvaluations.push(
      await evaluateValue(
        source.datasetPath,
        maxRows,
        tuningSet,
        stateModel,
        actionModel,
        scale,
      ),
    );
  }
  const selected = selectValueScale(tuningEvaluations);
  const testEvaluation = await evaluateValue(
    source.datasetPath,
    maxRows,
    testSet,
    stateModel,
    actionModel,
    selected.scale,
  );
  const permutationEvaluation = await evaluateValue(
    source.datasetPath,
    maxRows,
    testSet,
    stateModel,
    actionModel,
    selected.scale,
    true,
  );

  const baselineEvaluation = baselineEvaluationPath
    ? await readJson(baselineEvaluationPath)
    : undefined;
  const baselineRmseImprovement = numberAt(
    baselineEvaluation,
    ['test', 'metrics', 'utilityRmseImprovement'],
  );

  const valueReport = {
    version: VALUE_VERSION,
    generatedAt: new Date().toISOString(),
    target: 'SHORT_HORIZON_ONLY',
    stateModel: {
      keyCount: stateModel.counts.size,
      minimumObservations: MIN_OBSERVATIONS,
    },
    actionModel: {
      keyCount: actionModel.counts.size,
      minimumObservations: MIN_OBSERVATIONS,
      minimumPropensity: MIN_PROPENSITY,
      maximumImportanceWeight: MAX_IMPORTANCE_WEIGHT,
    },
    tuning: {
      selectedScale: selected.scale,
      candidates: tuningEvaluations.map(compactValueEvaluation),
    },
    test: compactValueEvaluation(testEvaluation),
    negativeControls: {
      candidatePermutation: compactValueEvaluation(permutationEvaluation),
      improvementDestroyed:
        testEvaluation.utilityRmseImprovement >
        permutationEvaluation.utilityRmseImprovement + 0.0005,
    },
    comparison: {
      v6BaselineAvailable: baselineRmseImprovement !== undefined,
      v6UtilityRmseImprovement: baselineRmseImprovement,
      beatsV6:
        baselineRmseImprovement === undefined
          ? false
          : testEvaluation.utilityRmseImprovement > baselineRmseImprovement,
    },
  };
  await atomicJson(join(outputDirectory, '40-value-v8-report.json'), valueReport);
  await writeModelArtifacts(stateModel, actionModel, selected.scale);

  console.log(
    `[pro-v8] value rmseGain=${testEvaluation.utilityRmseImprovement.toFixed(6)} separation=${testEvaluation.averageTopCandidateSeparation.toFixed(6)}`,
  );

  const policy = await evaluatePolicy(
    source.datasetPath,
    maxRows,
    testSet,
    behavior,
    behaviorTemperature,
    stateModel,
    actionModel,
    selected.scale,
  );
  await atomicJson(join(outputDirectory, '50-policy-v8-report.json'), policy);

  const gate = {
    datasetAuditPassed: audit.passed,
    noUserLiveContamination: audit.sourceCounts.USER_LIVE === 0,
    candidateCoveragePassed: audit.candidateCoverage >= 0.99,
    behaviorSupportPassed: policy.behaviorSupport >= 0.9,
    essPassed: policy.effectiveSampleSizeRatio >= 0.5,
    clippingPassed: policy.clippedWeightRate <= 0.05,
    valueImprovementPassed: testEvaluation.utilityRmseImprovement > 0,
    separationPassed: testEvaluation.averageTopCandidateSeparation >= 0.002,
    permutationPassed: valueReport.negativeControls.improvementDestroyed,
    beatsV6Passed: valueReport.comparison.beatsV6,
    drLowerConfidencePassed: policy.drDeltaConfidence95.lower > 0,
  };
  const rolloutAuthorized = Object.values(gate).every(Boolean);
  const summary = {
    pipelineVersion: PIPELINE_VERSION,
    startedAt,
    completedAt: new Date().toISOString(),
    mode,
    source: source.descriptor,
    split: {
      trainMatchCount: split.trainMatchIds.length,
      tuningMatchCount: split.tuningMatchIds.length,
      testMatchCount: split.testMatchIds.length,
    },
    behavioral: behavioralReport,
    value: valueReport,
    policy,
    releaseGate: {
      ...gate,
      passed: rolloutAuthorized,
      authorization: rolloutAuthorized
        ? 'SHADOW_ELIGIBLE'
        : 'OFFLINE_ONLY',
      globalProductionAuthorized: false,
    },
  };
  await atomicJson(join(outputDirectory, '99-summary.json'), summary);

  console.log(`[pro-v8] releaseGate=${rolloutAuthorized ? 'PASS' : 'FAIL'}`);
}

async function loadAndValidateSource(directory) {
  const manifest = await readJson(join(directory, 'manifest.json'));
  const audit = await readJson(join(directory, 'audit.json'));
  if (manifest.datasetVersion !== DATASET_VERSION) {
    throw new Error(`Expected ${DATASET_VERSION}.`);
  }
  if (audit.passed !== true) {
    throw new Error('Recommendation Dataset V5.3 audit did not pass.');
  }
  const artifact = record(manifest.artifact);
  const fileName = text(artifact.fileName) || 'dataset.ndjson.gz';
  const datasetPath = join(directory, fileName);
  const metadata = await stat(datasetPath);
  const expectedSha256 = requiredSha(artifact.sha256, 'source artifact SHA-256');
  const actualSha256 = await sha256File(datasetPath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Source artifact SHA mismatch: ${actualSha256} versus ${expectedSha256}.`,
    );
  }
  return {
    datasetPath,
    descriptor: {
      datasetVersion: DATASET_VERSION,
      directory,
      fileName,
      byteLength: metadata.size,
      sha256: actualSha256,
      upstreamDatasetV4Sha256: text(record(manifest.source).sha256),
    },
  };
}

async function auditSource(path, limit) {
  const decisionIds = new Set();
  const matches = new Map();
  const sourceCounts = {
    PRO_HISTORICAL: 0,
    PRO_LIVE: 0,
    USER_LIVE: 0,
  };
  let rowCount = 0;
  let eligibleRowCount = 0;
  let invalidRowCount = 0;
  let duplicateDecisionCount = 0;
  let candidateCoveredCount = 0;
  let candidateMetadataCount = 0;
  let timelineCount = 0;
  let shortHorizonCount = 0;

  await eachJsonLine(path, limit, async (value) => {
    rowCount += 1;
    try {
      const source = resolveRowSource(value);
      sourceCounts[source] += 1;
      if (!PRO_SOURCES.has(source)) {
        return;
      }
      const row = prepareRow(value);
      if (!row) {
        invalidRowCount += 1;
        return;
      }
      eligibleRowCount += 1;
      if (decisionIds.has(row.decisionId)) {
        duplicateDecisionCount += 1;
      }
      decisionIds.add(row.decisionId);
      candidateCoveredCount += row.candidateActions.some(
        (candidate) => candidate.actionKey === row.observedActionKey,
      )
        ? 1
        : 0;
      candidateMetadataCount += row.candidateMetadataCovered ? 1 : 0;
      timelineCount += row.timelineAvailable ? 1 : 0;
      shortHorizonCount += row.shortHorizonCount > 0 ? 1 : 0;
      const existing = matches.get(row.matchId);
      if (!existing || row.decisionOccurredAt < existing.firstObservedAt) {
        matches.set(row.matchId, {
          matchId: row.matchId,
          firstObservedAt: row.decisionOccurredAt,
        });
      }
    } catch {
      invalidRowCount += 1;
    }
  });

  const denominator = Math.max(1, eligibleRowCount);
  const result = {
    passed:
      sourceCounts.USER_LIVE === 0 &&
      duplicateDecisionCount === 0 &&
      invalidRowCount === 0 &&
      eligibleRowCount > 0,
    rowCount,
    eligibleRowCount,
    invalidRowCount,
    duplicateDecisionCount,
    sourceCounts,
    userLiveExcludedCount: sourceCounts.USER_LIVE,
    candidateCoverage: candidateCoveredCount / denominator,
    candidateMetadataCoverage: candidateMetadataCount / denominator,
    timelineCoverage: timelineCount / denominator,
    shortHorizonCoverage: shortHorizonCount / denominator,
    matches: [...matches.values()],
  };
  return result;
}

function assertAudit(audit) {
  if (audit.sourceCounts.USER_LIVE > 0) {
    throw new Error(
      `Pro pipeline source contains ${audit.sourceCounts.USER_LIVE} USER_LIVE rows.`,
    );
  }
  if (!audit.passed) {
    throw new Error(
      `Pro dataset audit failed: invalid=${audit.invalidRowCount}, duplicate=${audit.duplicateDecisionCount}.`,
    );
  }
}

function chronologicalMatchSplit(matches) {
  const ordered = [...matches].sort(
    (left, right) =>
      Date.parse(left.firstObservedAt) - Date.parse(right.firstObservedAt) ||
      left.matchId.localeCompare(right.matchId),
  );
  const trainEnd = Math.max(1, Math.floor(ordered.length * 0.7));
  const tuningEnd = Math.max(trainEnd + 1, Math.floor(ordered.length * 0.85));
  return {
    method: 'CHRONOLOGICAL_MATCH_LEVEL_70_15_15',
    trainMatchIds: ordered.slice(0, trainEnd).map((entry) => entry.matchId),
    tuningMatchIds: ordered.slice(trainEnd, tuningEnd).map((entry) => entry.matchId),
    testMatchIds: ordered.slice(tuningEnd).map((entry) => entry.matchId),
    leakage: {
      matchOverlapCount: 0,
      tuningUsedForSelection: true,
      testUsedForSelection: false,
    },
  };
}

function createBehaviorModel() {
  return {
    stateTotals: new Map(),
    stateActionCounts: new Map(),
    globalActions: new Map(),
    total: createFoldCount(),
  };
}

function updateBehaviorModel(model, row, fold) {
  incrementFoldCount(model.total, fold, 1);
  incrementMapFoldCount(model.stateTotals, row.behaviorStateKey, fold, 1);
  incrementMapFoldCount(
    model.stateActionCounts,
    `${row.behaviorStateKey}\u0000${row.observedActionKey}`,
    fold,
    1,
  );
  incrementMapFoldCount(model.globalActions, row.observedActionKey, fold, 1);
}

function behaviorProbabilitiesForRow(
  model,
  row,
  temperature = 1,
  excludedFold,
) {
  const stateTotal = foldAdjustedCount(
    model.stateTotals.get(row.behaviorStateKey),
    excludedFold,
  );
  const total = Math.max(1, foldAdjustedCount(model.total, excludedFold));
  const logits = row.candidateActions.map((candidate) => {
    const stateAction = foldAdjustedCount(
      model.stateActionCounts.get(
        `${row.behaviorStateKey}\u0000${candidate.actionKey}`,
      ),
      excludedFold,
    );
    const globalAction = foldAdjustedCount(
      model.globalActions.get(candidate.actionKey),
      excludedFold,
    );
    const prior = (globalAction + 1) / (total + model.globalActions.size);
    const probability = (stateAction + 2 * prior) / (stateTotal + 2);
    return {
      actionKey: candidate.actionKey,
      logit: Math.log(Math.max(1e-12, probability)) / temperature,
    };
  });
  const maximum = Math.max(...logits.map((entry) => entry.logit));
  const exponentials = logits.map((entry) => ({
    actionKey: entry.actionKey,
    value: Math.exp(entry.logit - maximum),
  }));
  const sum = exponentials.reduce((totalValue, entry) => totalValue + entry.value, 0);
  return exponentials.map((entry) => ({
    actionKey: entry.actionKey,
    probability: entry.value / Math.max(Number.EPSILON, sum),
  }));
}

async function evaluateBehavior(
  path,
  limit,
  matchSet,
  model,
  crossFit,
  temperature = 1,
) {
  const rows = [];
  let candidateCount = 0;
  let supportedCount = 0;
  await eachPreparedRow(path, limit, async (row) => {
    if (!matchSet.has(row.matchId)) return;
    const excludedFold = crossFit ? foldForMatch(row.matchId) : undefined;
    const probabilities = behaviorProbabilitiesForRow(
      model,
      row,
      temperature,
      excludedFold,
    );
    const observed = probabilities.find(
      (entry) => entry.actionKey === row.observedActionKey,
    );
    candidateCount += observed ? 1 : 0;
    supportedCount += observed && observed.probability >= MIN_PROPENSITY ? 1 : 0;
    if (observed) {
      rows.push({
        probability: observed.probability,
        candidateCount: probabilities.length,
      });
    }
  });
  return {
    rows,
    candidateCoverage: candidateCount / Math.max(1, rows.length),
    supportCoverage: supportedCount / Math.max(1, rows.length),
  };
}

function selectBehaviorTemperature(rows) {
  const temperatures = [0.5, 0.75, 1, 1.5, 2];
  const evaluations = temperatures.map((temperature) => {
    const transformed = rows.map((row) => {
      const p = clamp(row.probability, 1e-9, 1 - 1e-9);
      const powered = p ** (1 / temperature);
      const remaining = Math.max(1e-9, 1 - p) ** (1 / temperature);
      return powered / (powered + remaining);
    });
    return {
      temperature,
      logLoss:
        transformed.reduce((sum, value) => sum - Math.log(value), 0) /
        Math.max(1, transformed.length),
    };
  });
  evaluations.sort(
    (left, right) =>
      left.logLoss - right.logLoss || left.temperature - right.temperature,
  );
  return evaluations[0].temperature;
}

function summarizeBehaviorRows(rows, temperature) {
  const probabilities = rows.map((row) => {
    const p = clamp(row.probability, 1e-9, 1 - 1e-9);
    const powered = p ** (1 / temperature);
    const remaining = Math.max(1e-9, 1 - p) ** (1 / temperature);
    return powered / (powered + remaining);
  });
  return {
    decisionCount: probabilities.length,
    logLoss:
      probabilities.reduce((sum, value) => sum - Math.log(value), 0) /
      Math.max(1, probabilities.length),
    brierScore:
      probabilities.reduce((sum, value) => sum + (1 - value) ** 2, 0) /
      Math.max(1, probabilities.length),
    supportCoverage:
      probabilities.filter((value) => value >= MIN_PROPENSITY).length /
      Math.max(1, probabilities.length),
    meanObservedProbability:
      probabilities.reduce((sum, value) => sum + value, 0) /
      Math.max(1, probabilities.length),
  };
}

function createValueTable() {
  return { global: createFoldValueCount(), counts: new Map() };
}

function updateValueTable(table, key, value, fold, weight) {
  incrementFoldValueCount(table.global, fold, value, weight);
  let count = table.counts.get(key);
  if (!count) {
    count = createFoldValueCount();
    table.counts.set(key, count);
  }
  incrementFoldValueCount(count, fold, value, weight);
}

function predictValueTableCrossFit(table, key, fold, priorStrength) {
  return predictValueCount(table, key, priorStrength, fold);
}

function predictValueCount(table, key, priorStrength, excludedFold) {
  const global = adjustedValueCount(table.global, excludedFold);
  const globalMean = global.weight > 0 ? global.sum / global.weight : 0;
  const count = adjustedValueCount(table.counts.get(key), excludedFold);
  if (count.observations < MIN_OBSERVATIONS || count.weight <= 0) {
    return { mean: globalMean, supported: false };
  }
  return {
    mean:
      (count.sum + globalMean * priorStrength) /
      (count.weight + priorStrength),
    supported: true,
  };
}

function scoreCandidates(row, stateModel, actionModel, scale, permuted = false) {
  const state = predictValueCount(stateModel, row.stateKey, 20);
  const featureSets = row.candidateActions.map((candidate) => candidate.featureKeys);
  const scores = row.candidateActions.map((candidate, index) => {
    const keys = permuted
      ? featureSets[(index + 1) % featureSets.length]
      : candidate.featureKeys;
    const predictions = keys
      .map((key) => predictValueCount(actionModel, key, 1))
      .filter((prediction) => prediction.supported);
    const residual = robustMean(predictions.map((prediction) => prediction.mean));
    return {
      actionKey: candidate.actionKey,
      stateUtility: state.mean,
      rawResidual: scale * residual,
      supportedActionKeyCount: predictions.length,
    };
  });
  const center = robustMean(scores.map((entry) => entry.rawResidual));
  return scores
    .map((entry) => ({
      ...entry,
      actionAdvantage: entry.rawResidual - center,
      actionUtility: clamp(
        entry.stateUtility + entry.rawResidual - center,
        -1,
        1,
      ),
    }))
    .sort(
      (left, right) =>
        right.actionAdvantage - left.actionAdvantage ||
        left.actionKey.localeCompare(right.actionKey),
    );
}

async function evaluateValue(
  path,
  limit,
  matchSet,
  stateModel,
  actionModel,
  scale,
  permuted = false,
) {
  let decisionCount = 0;
  let stateSquaredError = 0;
  let actionSquaredError = 0;
  let stateAbsoluteError = 0;
  let actionAbsoluteError = 0;
  let separationSum = 0;
  let top1Count = 0;
  let pairCorrect = 0;
  let pairCount = 0;
  let supportedCount = 0;

  await eachPreparedRow(path, limit, async (row) => {
    if (!matchSet.has(row.matchId)) return;
    const ranking = scoreCandidates(
      row,
      stateModel,
      actionModel,
      scale,
      permuted,
    );
    const observedIndex = ranking.findIndex(
      (entry) => entry.actionKey === row.observedActionKey,
    );
    if (observedIndex < 0) return;
    const observed = ranking[observedIndex];
    decisionCount += 1;
    stateSquaredError += (observed.stateUtility - row.targetUtility) ** 2;
    actionSquaredError += (observed.actionUtility - row.targetUtility) ** 2;
    stateAbsoluteError += Math.abs(observed.stateUtility - row.targetUtility);
    actionAbsoluteError += Math.abs(observed.actionUtility - row.targetUtility);
    supportedCount += observed.supportedActionKeyCount > 0 ? 1 : 0;
    top1Count += observedIndex === 0 ? 1 : 0;
    if (ranking.length > 1) {
      separationSum += ranking[0].actionAdvantage - ranking[1].actionAdvantage;
    }
    for (let index = 0; index < ranking.length; index += 1) {
      if (index === observedIndex) continue;
      pairCount += 1;
      pairCorrect += observedIndex < index ? 1 : 0;
    }
  });

  const denominator = Math.max(1, decisionCount);
  const stateRmse = Math.sqrt(stateSquaredError / denominator);
  const actionRmse = Math.sqrt(actionSquaredError / denominator);
  return {
    scale,
    decisionCount,
    stateRmse,
    actionRmse,
    utilityRmseImprovement: stateRmse - actionRmse,
    stateMae: stateAbsoluteError / denominator,
    actionMae: actionAbsoluteError / denominator,
    averageTopCandidateSeparation: separationSum / denominator,
    observedActionTop1Agreement: top1Count / denominator,
    pairwiseObservedActionAccuracy: pairCorrect / Math.max(1, pairCount),
    actionSupportCoverage: supportedCount / denominator,
  };
}

function selectValueScale(evaluations) {
  const ranked = [...evaluations].sort((left, right) => {
    const leftScore =
      left.utilityRmseImprovement +
      Math.min(0.01, left.averageTopCandidateSeparation) * 0.1;
    const rightScore =
      right.utilityRmseImprovement +
      Math.min(0.01, right.averageTopCandidateSeparation) * 0.1;
    return rightScore - leftScore || left.scale - right.scale;
  });
  return ranked[0];
}

function compactValueEvaluation(value) {
  return {
    scale: value.scale,
    decisionCount: value.decisionCount,
    stateRmse: value.stateRmse,
    actionRmse: value.actionRmse,
    utilityRmseImprovement: value.utilityRmseImprovement,
    stateMae: value.stateMae,
    actionMae: value.actionMae,
    averageTopCandidateSeparation: value.averageTopCandidateSeparation,
    observedActionTop1Agreement: value.observedActionTop1Agreement,
    pairwiseObservedActionAccuracy: value.pairwiseObservedActionAccuracy,
    actionSupportCoverage: value.actionSupportCoverage,
  };
}

async function evaluatePolicy(
  path,
  limit,
  matchSet,
  behaviorModel,
  temperature,
  stateModel,
  actionModel,
  scale,
) {
  const byMatch = new Map();
  let candidateCovered = 0;
  let supported = 0;
  let clipped = 0;
  let weightSum = 0;
  let weightSquaredSum = 0;

  await eachPreparedRow(path, limit, async (row) => {
    if (!matchSet.has(row.matchId)) return;
    const ranking = scoreCandidates(row, stateModel, actionModel, scale);
    const behavior = behaviorProbabilitiesForRow(
      behaviorModel,
      row,
      temperature,
    );
    const target = softmaxAdvantages(ranking, 0.05);
    const observedBehavior = behavior.find(
      (entry) => entry.actionKey === row.observedActionKey,
    )?.probability;
    const observedTarget = target.find(
      (entry) => entry.actionKey === row.observedActionKey,
    )?.probability;
    const observedPrediction = ranking.find(
      (entry) => entry.actionKey === row.observedActionKey,
    );
    if (
      observedBehavior === undefined ||
      observedTarget === undefined ||
      !observedPrediction
    ) {
      return;
    }
    candidateCovered += 1;
    supported += observedBehavior >= MIN_PROPENSITY ? 1 : 0;
    const rawWeight = observedTarget / Math.max(MIN_PROPENSITY, observedBehavior);
    const weight = Math.min(20, rawWeight);
    clipped += rawWeight > 20 ? 1 : 0;
    weightSum += weight;
    weightSquaredSum += weight ** 2;
    const directValue = target.reduce((sum, targetEntry) => {
      const prediction = ranking.find(
        (entry) => entry.actionKey === targetEntry.actionKey,
      );
      return sum + targetEntry.probability * (prediction?.actionUtility ?? 0);
    }, 0);
    const dr =
      directValue +
      weight * (row.targetUtility - observedPrediction.actionUtility);
    const delta = dr - row.targetUtility;
    const entries = byMatch.get(row.matchId) ?? [];
    entries.push({ dr, delta, outcome: row.targetUtility });
    byMatch.set(row.matchId, entries);
  });

  const matchValues = [...byMatch.entries()].map(([matchId, entries]) => ({
    matchId,
    dr: mean(entries.map((entry) => entry.dr)),
    delta: mean(entries.map((entry) => entry.delta)),
    outcome: mean(entries.map((entry) => entry.outcome)),
  }));
  const drValue = mean(matchValues.map((entry) => entry.dr));
  const drDelta = mean(matchValues.map((entry) => entry.delta));
  const confidence = bootstrapMatchDelta(matchValues, BOOTSTRAP_SAMPLES);
  const count = Math.max(1, candidateCovered);
  return {
    version: POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    matchCount: matchValues.length,
    decisionCount: candidateCovered,
    candidateCoverage: candidateCovered / count,
    behaviorSupport: supported / count,
    effectiveSampleSizeRatio:
      weightSum ** 2 /
      Math.max(Number.EPSILON, weightSquaredSum * candidateCovered),
    clippedWeightRate: clipped / count,
    drValue,
    drDelta,
    drDeltaConfidence95: confidence,
    authorization: 'OFFLINE_ONLY',
    globalProductionAuthorized: false,
  };
}

function softmaxAdvantages(ranking, temperature) {
  const maximum = Math.max(
    ...ranking.map((entry) => entry.actionAdvantage / temperature),
  );
  const values = ranking.map((entry) => ({
    actionKey: entry.actionKey,
    value: Math.exp(entry.actionAdvantage / temperature - maximum),
  }));
  const total = values.reduce((sum, entry) => sum + entry.value, 0);
  return values.map((entry) => ({
    actionKey: entry.actionKey,
    probability: entry.value / Math.max(Number.EPSILON, total),
  }));
}

function bootstrapMatchDelta(values, samples) {
  if (values.length === 0) return { lower: 0, upper: 0 };
  const random = deterministicRandom(0x5f3759df);
  const estimates = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)].delta;
    }
    estimates.push(total / values.length);
  }
  estimates.sort((left, right) => left - right);
  return {
    lower: estimates[Math.floor(estimates.length * 0.025)],
    upper: estimates[Math.min(estimates.length - 1, Math.floor(estimates.length * 0.975))],
  };
}

async function writeModelArtifacts(stateModel, actionModel, scale) {
  const state = serializeValueTable(stateModel);
  const action = serializeValueTable(actionModel);
  await atomicJson(join(outputDirectory, '41-value-v8-model.json'), {
    version: VALUE_VERSION,
    actionResidualScale: scale,
    minimumObservations: MIN_OBSERVATIONS,
    state,
    action,
  });
}

function serializeValueTable(table) {
  const counts = {};
  for (const [key, value] of table.counts) {
    const adjusted = adjustedValueCount(value);
    if (adjusted.observations >= MIN_OBSERVATIONS) {
      counts[key] = adjusted;
    }
  }
  return {
    global: adjustedValueCount(table.global),
    counts,
  };
}

async function eachPreparedRow(path, limit, visit) {
  await eachJsonLine(path, limit, async (value) => {
    const source = resolveRowSource(value);
    if (!PRO_SOURCES.has(source)) return;
    const row = prepareRow(value);
    if (row) await visit(row);
  });
}

function prepareRow(value) {
  if (value.datasetVersion !== DATASET_VERSION) return undefined;
  const identity = record(value.identity);
  const state = record(value.stateBeforeAction);
  const observedAction = record(value.observedAction);
  const eligibility = record(value.trainingEligibility);
  const features = record(value.itemAndBuildFeatures);
  if (eligibility.exactAction !== true) return undefined;
  const matchId = text(identity.matchId);
  const decisionId = text(value.decisionId);
  const observedActionKey = text(observedAction.actionKey);
  const heroId = number(identity.heroId || state.heroId);
  const timeBucket = number(state.timeBucket);
  if (!matchId || !decisionId || !observedActionKey || heroId <= 0) {
    return undefined;
  }
  const shortHorizon = shortHorizonUtility(value);
  if (!shortHorizon) return undefined;
  const candidateRows = records(state.candidateActions);
  const featureRows = records(features.candidates);
  const featureByAction = new Map(
    featureRows.map((candidate) => [text(candidate.actionKey), candidate]),
  );
  const candidateActionKeys = uniqueStrings([
    ...candidateRows.map((candidate) => text(candidate.actionKey)),
    observedActionKey,
  ]);
  const candidateActions = candidateActionKeys.map((actionKey) => ({
    actionKey,
    featureKeys: actionFeatureKeys({
      heroId,
      timeBucket,
      inventoryStateKey: text(state.inventoryStateKey) || 'UNKNOWN',
      actionKey,
      feature: featureByAction.get(actionKey) ?? {},
    }),
  }));
  const inventoryStateKey = text(state.inventoryStateKey) || 'UNKNOWN';
  const teamEconomy = record(state.teamEconomy);
  const teamBand = teamEconomy.available === true
    ? classifyEconomy(number(teamEconomy.relativeNetWorthDelta))
    : 'UNKNOWN';
  const decisionOccurredAt =
    text(identity.decisionOccurredAt) ||
    text(value.decisionOccurredAt) ||
    '1970-01-01T00:00:00.000Z';
  return {
    decisionId,
    matchId,
    decisionOccurredAt,
    observedActionKey,
    targetUtility: shortHorizon.utility,
    shortHorizonCount: shortHorizon.count,
    behaviorStateKey: `${heroId}|${timeBucket}|${inventoryStateKey}|${teamBand}`,
    stateKey: `${heroId}|${timeBucket}|${inventoryStateKey}|${teamBand}`,
    observedActionFeatureKeys:
      candidateActions.find((candidate) => candidate.actionKey === observedActionKey)
        ?.featureKeys ?? [],
    candidateActions,
    candidateMetadataCovered:
      candidateActions.length > 0 &&
      candidateActions.every((candidate) => candidate.featureKeys.length > 1),
    timelineAvailable: record(state.playerTimelineSnapshot).available === true,
  };
}

function shortHorizonUtility(value) {
  const windows = record(record(value.shortHorizonOutcomes).windows);
  const values = [];
  for (const [name, weight] of HORIZONS) {
    const window = record(windows[name]);
    if (window.available !== true) continue;
    const utility = clamp(
      number(window.killsDelta) * 0.12 +
        number(window.assistsDelta) * 0.05 +
        number(window.killParticipationDelta) * 0.04 -
        number(window.deathsDelta) * 0.18 +
        number(window.netWorthDelta) / 10_000 +
        number(window.heroDamageDelta) / 25_000 +
        number(window.enemyObjectiveLossCount) * 0.12 -
        number(window.ownObjectiveLossCount) * 0.12 +
        (window.survived === true ? 0.05 : 0),
      -1,
      1,
    );
    values.push({ utility, weight });
  }
  if (values.length === 0) return undefined;
  const weight = values.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    utility: values.reduce((sum, entry) => sum + entry.utility * entry.weight, 0) / weight,
    count: values.length,
  };
}

function actionFeatureKeys(input) {
  const item = record(input.feature.item);
  return uniqueStrings([
    `ACTION:${input.actionKey}`,
    `HERO_TIME_ACTION:${input.heroId}|${input.timeBucket}|${input.actionKey}`,
    `HERO_TIME_INVENTORY_ACTION:${input.heroId}|${input.timeBucket}|${input.inventoryStateKey}|${input.actionKey}`,
    text(item.slotType)
      ? `HERO_SLOT:${input.heroId}|${text(item.slotType)}`
      : undefined,
    number(item.tier) > 0
      ? `HERO_TIER:${input.heroId}|${number(item.tier)}`
      : undefined,
    number(item.cost) > 0
      ? `HERO_COST:${input.heroId}|${Math.floor(number(item.cost) / 500)}`
      : undefined,
    item.isActiveItem === true ? `HERO_ACTIVE:${input.heroId}` : undefined,
    ...strings(item.tags).map((tag) => `HERO_TAG:${input.heroId}|${tag}`),
    ...strings(input.feature.interactionKeys).map((key) => `INTERACTION:${key}`),
  ]);
}

function resolveRowSource(value) {
  const explicit = value.dataSource ?? value.decisionSource;
  if (explicit !== undefined) {
    if (
      explicit !== 'PRO_HISTORICAL' &&
      explicit !== 'PRO_LIVE' &&
      explicit !== 'USER_LIVE'
    ) {
      throw new Error(`Unknown recommendation data source: ${String(explicit)}`);
    }
    return explicit;
  }
  return 'PRO_HISTORICAL';
}

async function eachJsonLine(path, limit, visit) {
  const input = createReadStream(path);
  const stream = path.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (limit !== undefined && count >= limit) break;
    count += 1;
    await visit(JSON.parse(line));
    if (count % 10_000 === 0) {
      console.log(`[pro-v8] rows=${count}`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  input.destroy();
}

function createFoldCount() {
  return { total: 0, folds: Array(BEHAVIOR_FOLDS).fill(0) };
}

function incrementFoldCount(count, fold, amount) {
  count.total += amount;
  count.folds[fold] += amount;
}

function incrementMapFoldCount(map, key, fold, amount) {
  let count = map.get(key);
  if (!count) {
    count = createFoldCount();
    map.set(key, count);
  }
  incrementFoldCount(count, fold, amount);
}

function foldAdjustedCount(count, excludedFold) {
  if (!count) return 0;
  return count.total - (excludedFold === undefined ? 0 : count.folds[excludedFold]);
}

function createFoldValueCount() {
  return {
    sum: 0,
    weight: 0,
    observations: 0,
    folds: Array.from({ length: BEHAVIOR_FOLDS }, () => ({
      sum: 0,
      weight: 0,
      observations: 0,
    })),
  };
}

function incrementFoldValueCount(count, fold, value, weight) {
  count.sum += value * weight;
  count.weight += weight;
  count.observations += 1;
  count.folds[fold].sum += value * weight;
  count.folds[fold].weight += weight;
  count.folds[fold].observations += 1;
}

function adjustedValueCount(count, excludedFold) {
  if (!count) return { sum: 0, weight: 0, observations: 0 };
  const excluded = excludedFold === undefined
    ? { sum: 0, weight: 0, observations: 0 }
    : count.folds[excludedFold];
  return {
    sum: count.sum - excluded.sum,
    weight: count.weight - excluded.weight,
    observations: count.observations - excluded.observations,
  };
}

function foldForMatch(matchId) {
  const digest = createHash('sha256').update(matchId).digest();
  return digest.readUInt32BE(0) % BEHAVIOR_FOLDS;
}

function classifyEconomy(value) {
  if (value <= -0.15) return 'FAR_BEHIND';
  if (value < -0.05) return 'BEHIND';
  if (value <= 0.05) return 'EVEN';
  if (value < 0.15) return 'AHEAD';
  return 'FAR_AHEAD';
}

function robustMean(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const trim = sorted.length >= 5 ? Math.floor(sorted.length * 0.2) : 0;
  const selected = sorted.slice(trim, sorted.length - trim || undefined);
  return mean(selected);
}

function mean(values) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deterministicRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    result[key] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) index += 1;
  }
  return result;
}

function requiredArg(value, name) {
  const result = value[name];
  if (!result) throw new Error(`--${name} is required.`);
  return result;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive safe integer.`);
  }
  return parsed;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function atomicJson(path, value) {
  const partial = `${path}.partial`;
  await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rm(path, { force: true });
  await rename(partial, path);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function numberAt(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return typeof current === 'number' && Number.isFinite(current)
    ? current
    : undefined;
}

function requiredSha(value, name) {
  const result = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }
  return result;
}

function record(value) {
  return typeof value === 'object' && value !== null ? value : {};
}

function records(value) {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string')
    : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
