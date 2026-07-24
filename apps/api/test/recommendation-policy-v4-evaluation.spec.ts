import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapRecommendationPolicyV4,
  RecommendationPolicyV4EvaluationService,
  softmaxRecommendationPolicyV4,
  type RecommendationPolicyV4MatchContribution,
} from '../src/deadlock-live/recommendation-policy-v4-evaluation.service';
import {
  RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION,
  type RecommendationBehavioralV4PreparedRow,
} from '../src/deadlock-live/recommendation-behavioral-v4-training.service';
import { RECOMMENDATION_DECISION_DATASET_V4_VERSION } from '../src/deadlock-live/recommendation-decision-dataset-v4.service';
import {
  RECOMMENDATION_VALUE_V4_MODEL_VERSION,
  type RecommendationValueV4PreparedRow,
} from '../src/deadlock-live/recommendation-value-v4-training.service';

describe('recommendation policy v4 evaluation', () => {
  let datasetDirectory = '';
  let behavioralDirectory = '';
  let valueDirectory = '';
  let outputDirectory = '';

  beforeEach(async () => {
    datasetDirectory = await mkdtemp(join(tmpdir(), 'policy-v4-dataset-'));
    behavioralDirectory = await mkdtemp(
      join(tmpdir(), 'policy-v4-behavioral-'),
    );
    valueDirectory = await mkdtemp(join(tmpdir(), 'policy-v4-value-'));
    outputDirectory = await mkdtemp(join(tmpdir(), 'policy-v4-output-'));
    process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR =
      datasetDirectory;
    process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR =
      behavioralDirectory;
    process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR = valueDirectory;
    process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR = outputDirectory;
  });

  afterEach(async () => {
    delete process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR;
    delete process.env.DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR;
    await Promise.all([
      rm(datasetDirectory, { recursive: true, force: true }),
      rm(behavioralDirectory, { recursive: true, force: true }),
      rm(valueDirectory, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
    ]);
  });

  it('evaluates joined held-out decisions and restores persisted artifacts', async () => {
    const artifacts = await writeSourceArtifacts({
      datasetDirectory,
      behavioralDirectory,
      valueDirectory,
    });
    const service = new RecommendationPolicyV4EvaluationService();
    await service.onModuleInit();

    await service.start({
      behaviorTemperature: 1,
      targetTemperature: 1,
      targetValueWeight: 1,
      minBehaviorProbability: 0.001,
      maxImportanceWeight: 10,
      bootstrapReplicates: 200,
      bootstrapSeed: 12345,
      maxCandidateActions: 16,
      expectedDatasetSha256: artifacts.datasetSha256,
      expectedBehavioralModelSha256: artifacts.behavioralModelSha256,
      expectedValueModelSha256: artifacts.valueModelSha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      processedBehavioralRowCount: 12,
      processedValueRowCount: 12,
      joinedDecisionCount: 12,
      candidateCoveredDecisionCount: 11,
      supportedDecisionCount: 11,
      evaluatedDecisionCount: 11,
      evaluatedMatchCount: 6,
      manifestAvailable: true,
      auditAvailable: true,
      evaluationAvailable: true,
    });

    const evaluation = service.getEvaluation();
    expect(evaluation).toMatchObject({
      evaluationKind: 'DIAGNOSTIC_OFFLINE_POLICY_EVALUATION',
      causalInterpretationAllowed: false,
      rolloutAuthorization: 'FORBIDDEN',
      estimators: {
        decisionCount: 11,
        matchCount: 6,
      },
      bootstrap: {
        confidenceLevel: 0.95,
        replicateCount: 200,
        seed: 12345,
      },
      coverage: {
        joinedDecisionCount: 12,
        candidateCoveredDecisionCount: 11,
        supportedDecisionCount: 11,
        candidateMissingObservedActionCount: 1,
      },
      releaseGate: {
        productionRolloutAuthorized: false,
        passed: false,
      },
    });

    const estimators = asRecord(evaluation?.estimators);
    expect(Number.isFinite(estimators.inversePropensityValue)).toBe(true);
    expect(
      Number.isFinite(estimators.selfNormalizedInversePropensityValue),
    ).toBe(true);
    expect(Number.isFinite(estimators.directMethodValue)).toBe(true);
    expect(Number.isFinite(estimators.doublyRobustValue)).toBe(true);

    const decisionRows = await readNdjson(
      join(outputDirectory, 'decision-evaluation.ndjson'),
    );
    expect(decisionRows).toHaveLength(12);
    expect(
      decisionRows.filter((row) => row.eligible === true),
    ).toHaveLength(11);
    expect(decisionRows).toContainEqual(
      expect.objectContaining({
        decisionId: 'decision-6-2',
        eligible: false,
        exclusionReason: 'OBSERVED_ACTION_NOT_IN_RECORDED_CANDIDATES',
      }),
    );

    const matchRows = await readNdjson(
      join(outputDirectory, 'match-summary.ndjson'),
    );
    expect(matchRows).toHaveLength(6);

    const audit = service.getAudit();
    expect(audit).toMatchObject({
      passed: true,
      source: {
        hashes: {
          dataset: artifacts.datasetSha256,
          behavioralModel: artifacts.behavioralModelSha256,
          valueModel: artifacts.valueModelSha256,
        },
      },
      leakage: {
        evaluationRows:
          'INTERSECTION_OF_BEHAVIORAL_AND_VALUE_VALIDATION',
        targetOutcomeUsedForPolicyScoring: false,
        matchLevelBootstrap: true,
        causalInterpretationAllowed: false,
      },
    });

    const manifest = service.getManifest();
    expect(manifest).toMatchObject({
      evaluationKind: 'DIAGNOSTIC_OFFLINE_POLICY_EVALUATION',
      auditPassed: true,
      productionRolloutAuthorized: false,
    });

    const restored = new RecommendationPolicyV4EvaluationService();
    await restored.onModuleInit();
    expect(restored.getStatus()).toMatchObject({
      state: 'COMPLETE',
      evaluatedDecisionCount: 11,
      evaluatedMatchCount: 6,
      manifestAvailable: true,
      auditAvailable: true,
      evaluationAvailable: true,
    });
  });

  it('fails safely when a pinned model hash does not match', async () => {
    await writeSourceArtifacts({
      datasetDirectory,
      behavioralDirectory,
      valueDirectory,
    });
    const service = new RecommendationPolicyV4EvaluationService();
    await service.onModuleInit();

    await service.start({
      bootstrapReplicates: 100,
      expectedBehavioralModelSha256: '0'.repeat(64),
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'FAILED',
      error: expect.stringContaining('Behavioral V4 model SHA-256 mismatch'),
    });
  });

  it('normalizes finite scores into deterministic probabilities', () => {
    const probabilities = softmaxRecommendationPolicyV4([0, 1, 2], 0.75);
    expect(probabilities).toHaveLength(3);
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1,
      12,
    );
    expect(probabilities[2]).toBeGreaterThan(probabilities[1]);
    expect(probabilities[1]).toBeGreaterThan(probabilities[0]);
    expect(softmaxRecommendationPolicyV4([0, 1, 2], 0.75)).toEqual(
      probabilities,
    );
  });

  it('uses deterministic match-level bootstrap sampling', () => {
    const matches: RecommendationPolicyV4MatchContribution[] = [
      createMatchContribution('match-a', 1, 0.8),
      createMatchContribution('match-b', 0, 1.2),
      createMatchContribution('match-c', 1, 0.6),
    ];
    const first = bootstrapRecommendationPolicyV4(matches, 200, 42);
    const second = bootstrapRecommendationPolicyV4(matches, 200, 42);
    const different = bootstrapRecommendationPolicyV4(matches, 200, 43);

    expect(first).toEqual(second);
    expect(first.intervals.doublyRobustValue).not.toEqual(
      different.intervals.doublyRobustValue,
    );
  });
});

async function writeSourceArtifacts(input: {
  datasetDirectory: string;
  behavioralDirectory: string;
  valueDirectory: string;
}): Promise<{
  datasetSha256: string;
  behavioralModelSha256: string;
  valueModelSha256: string;
}> {
  const datasetContent = `${JSON.stringify({
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION,
    testFixture: true,
  })}\n`;
  await writeFile(
    join(input.datasetDirectory, 'dataset.ndjson'),
    datasetContent,
    'utf8',
  );
  const datasetSha256 = sha256(datasetContent);
  await writeJson(join(input.datasetDirectory, 'manifest.json'), {
    schemaVersion: 1,
    datasetVersion: RECOMMENDATION_DECISION_DATASET_V4_VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    artifact: {
      fileName: 'dataset.ndjson',
      sha256: datasetSha256,
      rowCount: 1,
    },
    auditPassed: true,
  });
  await writeJson(join(input.datasetDirectory, 'audit.json'), {
    schemaVersion: 1,
    passed: true,
  });

  const behavioralRows: RecommendationBehavioralV4PreparedRow[] = [];
  const valueRows: RecommendationValueV4PreparedRow[] = [];
  for (let matchIndex = 1; matchIndex <= 6; matchIndex += 1) {
    for (let decisionIndex = 1; decisionIndex <= 2; decisionIndex += 1) {
      const observedActionKey =
        decisionIndex === 1 ? 'BUY:1' : 'BUY:2';
      const candidateActionKeys =
        matchIndex === 6 && decisionIndex === 2
          ? ['BUY:1']
          : ['BUY:1', 'BUY:2'];
      const playerWon = matchIndex % 2 === 1;
      behavioralRows.push(
        createBehavioralRow({
          matchIndex,
          decisionIndex,
          observedActionKey,
          candidateActionKeys,
          playerWon,
        }),
      );
      valueRows.push(
        createValueRow({
          matchIndex,
          decisionIndex,
          observedActionKey,
          playerWon,
        }),
      );
    }
  }

  const behavioralValidationContent = toNdjson(behavioralRows);
  const behavioralModel = createBehavioralModel();
  const behavioralModelContent = `${JSON.stringify(behavioralModel, undefined, 2)}\n`;
  await writeFile(
    join(input.behavioralDirectory, 'validation.ndjson'),
    behavioralValidationContent,
    'utf8',
  );
  await writeFile(
    join(input.behavioralDirectory, 'model.json'),
    behavioralModelContent,
    'utf8',
  );
  const behavioralValidationSha256 = sha256(behavioralValidationContent);
  const behavioralModelSha256 = sha256(behavioralModelContent);
  await writeJson(join(input.behavioralDirectory, 'manifest.json'), {
    schemaVersion: 1,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION,
    generatedAt: '2026-01-02T00:00:00.000Z',
    source: {
      artifactSha256: datasetSha256,
    },
    artifacts: {
      validation: {
        fileName: 'validation.ndjson',
        sha256: behavioralValidationSha256,
      },
      model: {
        fileName: 'model.json',
        sha256: behavioralModelSha256,
      },
    },
    evaluationSummary: {
      releaseGate: { passed: true },
    },
    auditPassed: true,
  });
  await writeJson(join(input.behavioralDirectory, 'audit.json'), {
    schemaVersion: 1,
    passed: true,
  });

  const valueValidationContent = toNdjson(valueRows);
  const valueModel = createValueModel();
  const valueModelContent = `${JSON.stringify(valueModel, undefined, 2)}\n`;
  await writeFile(
    join(input.valueDirectory, 'validation.ndjson'),
    valueValidationContent,
    'utf8',
  );
  await writeFile(
    join(input.valueDirectory, 'model.json'),
    valueModelContent,
    'utf8',
  );
  const valueValidationSha256 = sha256(valueValidationContent);
  const valueModelSha256 = sha256(valueModelContent);
  await writeJson(join(input.valueDirectory, 'manifest.json'), {
    schemaVersion: 1,
    modelVersion: RECOMMENDATION_VALUE_V4_MODEL_VERSION,
    generatedAt: '2026-01-03T00:00:00.000Z',
    source: {
      artifactSha256: datasetSha256,
    },
    artifacts: {
      validation: {
        fileName: 'validation.ndjson',
        sha256: valueValidationSha256,
      },
      model: {
        fileName: 'model.json',
        sha256: valueModelSha256,
      },
    },
    evaluationSummary: {
      releaseGate: { passed: true },
    },
    auditPassed: true,
  });
  await writeJson(join(input.valueDirectory, 'audit.json'), {
    schemaVersion: 1,
    passed: true,
  });

  return {
    datasetSha256,
    behavioralModelSha256,
    valueModelSha256,
  };
}

function createBehavioralRow(input: {
  matchIndex: number;
  decisionIndex: number;
  observedActionKey: string;
  candidateActionKeys: string[];
  playerWon: boolean;
}): RecommendationBehavioralV4PreparedRow {
  const decisionId = `decision-${input.matchIndex}-${input.decisionIndex}`;
  const matchId = `match-${input.matchIndex}`;
  return {
    schemaVersion: 1,
    decisionId,
    matchId,
    decisionOccurredAt: `2026-01-${String(input.matchIndex).padStart(2, '0')}T00:0${input.decisionIndex}:00.000Z`,
    features: {
      heroId: 72,
      teamId: 1,
      gameTimeS: 120,
      timeBucket: 1,
      inventoryStateKey:
        input.decisionIndex === 1 ? 'EMPTY' : '1x1',
      previousActionKeys:
        input.decisionIndex === 1 ? [] : ['BUY:1'],
      previousActionTailKey:
        input.decisionIndex === 1 ? 'EMPTY' : 'BUY:1',
      alliedHeroIds: [2, 3, 4, 5, 6],
      enemyHeroIds: [11, 12, 13, 14, 15, 16],
      recommendationModel: 'CONTEXTUAL_V3',
      candidateSetPolicy: 'RECORDED_AT_DECISION_TIME',
      servedActionKey: input.candidateActionKeys[0] ?? 'HOLD',
      candidateActionKeys: [...input.candidateActionKeys],
    },
    target: {
      actionKey: input.observedActionKey,
    },
    outcomeLabel: {
      playerWon: input.playerWon,
    },
  };
}

function createValueRow(input: {
  matchIndex: number;
  decisionIndex: number;
  observedActionKey: string;
  playerWon: boolean;
}): RecommendationValueV4PreparedRow {
  const decisionId = `decision-${input.matchIndex}-${input.decisionIndex}`;
  const matchId = `match-${input.matchIndex}`;
  return {
    schemaVersion: 1,
    decisionId,
    matchId,
    decisionOccurredAt: `2026-01-${String(input.matchIndex).padStart(2, '0')}T00:0${input.decisionIndex}:00.000Z`,
    features: {
      heroId: 72,
      teamId: 1,
      gameTimeS: 120,
      timeBucket: 1,
      inventoryStateKey:
        input.decisionIndex === 1 ? 'EMPTY' : '1x1',
      previousActionKeys:
        input.decisionIndex === 1 ? [] : ['BUY:1'],
      previousActionTailKey:
        input.decisionIndex === 1 ? 'EMPTY' : 'BUY:1',
      alliedHeroIds: [2, 3, 4, 5, 6],
      enemyHeroIds: [11, 12, 13, 14, 15, 16],
      actionKey: input.observedActionKey,
    },
    target: {
      playerWon: input.playerWon,
    },
  };
}

function createBehavioralModel(): Record<string, unknown> {
  const actionCounts = { 'BUY:1': 40, 'BUY:2': 20 };
  return {
    schemaVersion: 1,
    modelVersion: RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION,
    generatedAt: '2026-01-02T00:00:00.000Z',
    options: {
      smoothing: 1,
      minContextObservations: 1,
    },
    weights: {
      heroTimeBase: 1,
      inventoryDelta: 0.55,
      previousActionTailDelta: 0.35,
      alliedRosterDeltaAverage: 0.08,
      enemyRosterDeltaAverage: 0.12,
    },
    counts: {
      hero: { '72': actionCounts },
      heroTime: { '72|1': actionCounts },
      heroTimeInventory: {
        '72|1|EMPTY': actionCounts,
        '72|1|1x1': actionCounts,
      },
      heroTimePreviousTail: {
        '72|1|EMPTY': actionCounts,
        '72|1|BUY:1': actionCounts,
      },
      ally: {},
      enemy: {},
    },
  };
}

function createValueModel(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modelVersion: RECOMMENDATION_VALUE_V4_MODEL_VERSION,
    generatedAt: '2026-01-03T00:00:00.000Z',
    causalInterpretationAllowed: false,
    options: {
      priorStrength: 5,
      minContextObservations: 1,
    },
    weights: {
      base: 1,
      heroTimeAction: 1.5,
      inventoryAction: 0.75,
      previousActionTailAction: 0.5,
      alliedRosterActionAverage: 0.2,
      enemyRosterActionAverage: 0.3,
    },
    counts: {
      global: { wins: 30, total: 60 },
      hero: { '72': { wins: 30, total: 60 } },
      heroTime: { '72|1': { wins: 30, total: 60 } },
      heroTimeAction: {
        '72|1|BUY:1': { wins: 32, total: 40 },
        '72|1|BUY:2': { wins: 4, total: 20 },
      },
      heroTimeInventoryAction: {
        '72|1|EMPTY|BUY:1': { wins: 16, total: 20 },
        '72|1|EMPTY|BUY:2': { wins: 2, total: 10 },
        '72|1|1x1|BUY:1': { wins: 16, total: 20 },
        '72|1|1x1|BUY:2': { wins: 2, total: 10 },
      },
      heroTimePreviousTailAction: {
        '72|1|EMPTY|BUY:1': { wins: 16, total: 20 },
        '72|1|EMPTY|BUY:2': { wins: 2, total: 10 },
        '72|1|BUY:1|BUY:1': { wins: 16, total: 20 },
        '72|1|BUY:1|BUY:2': { wins: 2, total: 10 },
      },
      allyAction: {},
      enemyAction: {},
    },
  };
}

function createMatchContribution(
  matchId: string,
  reward: number,
  weight: number,
): RecommendationPolicyV4MatchContribution {
  const direct = 0.6;
  const observedActionValue = 0.5;
  return {
    matchId,
    decisionCount: 1,
    rewardSum: reward,
    ipsNumerator: weight * reward,
    snipsNumerator: weight * reward,
    weightSum: weight,
    weightSquareSum: weight * weight,
    directSum: direct,
    doublyRobustSum: direct + weight * (reward - observedActionValue),
  };
}

async function readNdjson(path: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function toNdjson(values: readonly unknown[]): string {
  return `${values.map((value) => JSON.stringify(value)).join('\n')}\n`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
