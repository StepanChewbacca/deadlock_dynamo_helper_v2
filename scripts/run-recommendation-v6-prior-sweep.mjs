import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository =
  process.env.DEADLOCK_DEPLOY_REPOSITORY ?? '/home/ubuntu/apps/deadlock_dynamo_helper';
const resultDirectory =
  process.env.RECOMMENDATION_V6_SWEEP_RESULT_DIR ??
  join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'recommendation-v6-improvement-result');
const apiBaseUrl = process.env.RECOMMENDATION_V6_API_BASE_URL ?? 'http://127.0.0.1:3000';
const overridePath = '/tmp/recommendation-v6-improvement.override.yml';
const datasetDirectory =
  '/app/apps/api/storage/recommendation-decision-dataset-v5-full-crawler-db-timeline-20260726';
const behavioralDirectory =
  '/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-recovery-v3-20260725';
const valueRoot =
  '/app/apps/api/storage/recommendation-value-v6-prior-sweep-db-timeline-20260726';
const policyRoot =
  '/app/apps/api/storage/recommendation-policy-v6-prior-sweep-db-timeline-20260726';
const baselineValueDirectory =
  '/app/apps/api/storage/recommendation-value-v6-full-crawler-db-timeline-20260726';
const valueEndpoint = '/deadlock/analysis/recommendation-value-v6-training';
const policyEndpoint = '/deadlock/analysis/recommendation-policy-v6-evaluation';
const telemetryEndpoint = '/deadlock/analysis/recommendation-telemetry/status';
const actionResidualScales = [0, 0.25, 0.5, 1, 2, 4, 8, 16];

await mkdir(resultDirectory, { recursive: true });

const volumeRoot = resolveStorageVolumeRoot();
const datasetManifest = readVolumeJson(datasetDirectory, 'manifest.json');
const datasetAudit = readVolumeJson(datasetDirectory, 'audit.json');
const behavioralManifest = readVolumeJson(behavioralDirectory, 'manifest.json');
const behavioralAudit = readVolumeJson(behavioralDirectory, 'audit.json');

assertTrue(datasetAudit.passed === true, 'Dataset V5.3 audit did not pass.');
assertTrue(behavioralAudit.passed === true, 'Behavioral V4 audit did not pass.');

const datasetSha256 = requiredSha(datasetManifest?.artifact?.sha256, 'Dataset V5.3 SHA-256');
const behavioralModelSha256 = requiredSha(
  behavioralManifest?.artifacts?.model?.sha256,
  'Behavioral V4 model SHA-256',
);

await saveJson('00-inputs.json', {
  generatedAt: new Date().toISOString(),
  datasetDirectory,
  behavioralDirectory,
  valueRoot,
  policyRoot,
  datasetVersion: datasetManifest.datasetVersion,
  datasetRowCount: datasetManifest?.artifact?.rowCount,
  datasetSha256,
  behavioralModelVersion: behavioralManifest.modelVersion,
  behavioralModelSha256,
  behavioralReleaseGatePassed:
    behavioralManifest?.evaluationSummary?.releaseGate?.passed === true,
  selectionProtocol: {
    selectionMetric: 'evaluation.tuning.selection.tuningLoss',
    testUsedForSelection: false,
    finalPolicyEvaluationCount: 1,
  },
});

const baselineModelPath = storageHostPath(baselineValueDirectory, 'model.json');
if (existsWithSudo(baselineModelPath)) {
  runNode([
    join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'scripts/analyze-recommendation-v6-shrinkage.mjs'),
    baselineModelPath,
    join(resultDirectory, '01-baseline-shrinkage.json'),
  ]);
}

const coarseConfigs = [
  createConfig('coarse-s100-a100-m20-w025', 100, 100, 20, 0.25),
  createConfig('coarse-s100-a10-m20-w025', 100, 10, 20, 0.25),
  createConfig('coarse-s30-a1-m20-w025', 30, 1, 20, 0.25),
  createConfig('coarse-s10-a0p1-m10-w025', 10, 0.1, 10, 0.25),
];

const coarseResults = [];
for (const config of coarseConfigs) {
  coarseResults.push(await runValueConfig(config));
  await saveJson('10-coarse-progress.json', {
    completedAt: new Date().toISOString(),
    results: coarseResults.map(summarizeValueResult),
  });
}

const coarseWinner = selectByTuningLoss(coarseResults);
const refinementConfigs = deduplicateConfigs([
  createConfig(
    `${coarseWinner.config.id}-min5`,
    coarseWinner.config.statePriorStrength,
    coarseWinner.config.actionPriorStrength,
    5,
    coarseWinner.config.finalOutcomeWeight,
  ),
  createConfig(
    `${coarseWinner.config.id}-w010`,
    coarseWinner.config.statePriorStrength,
    coarseWinner.config.actionPriorStrength,
    coarseWinner.config.minimumObservations,
    0.1,
  ),
  createConfig(
    `${coarseWinner.config.id}-w000-current-fallback`,
    coarseWinner.config.statePriorStrength,
    coarseWinner.config.actionPriorStrength,
    coarseWinner.config.minimumObservations,
    0,
  ),
]).filter(
  (config) => !coarseResults.some((result) => result.config.fingerprint === config.fingerprint),
);

const refinementResults = [];
for (const config of refinementConfigs) {
  refinementResults.push(await runValueConfig(config));
  await saveJson('20-refinement-progress.json', {
    completedAt: new Date().toISOString(),
    coarseWinner: summarizeValueResult(coarseWinner),
    results: refinementResults.map(summarizeValueResult),
  });
}

const allResults = [...coarseResults, ...refinementResults];
const winner = selectByTuningLoss(allResults);

runNode([
  join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'scripts/analyze-recommendation-v6-shrinkage.mjs'),
  storageHostPath(winner.valueDirectory, 'model.json'),
  join(resultDirectory, '30-winner-shrinkage.json'),
]);

const policyResult = await runPolicy(winner);

const summary = {
  completedAt: new Date().toISOString(),
  selectionProtocol: {
    metric: 'evaluation.tuning.selection.tuningLoss',
    testUsedForSelection: false,
    winnerFingerprint: winner.config.fingerprint,
  },
  baseline: allResults.find((result) => result.config.id.startsWith('coarse-s100-a100'))
    ? summarizeValueResult(
        allResults.find((result) => result.config.id.startsWith('coarse-s100-a100')),
      )
    : undefined,
  coarse: coarseResults.map(summarizeValueResult),
  refinement: refinementResults.map(summarizeValueResult),
  rankingByTuningLoss: [...allResults]
    .sort(compareByTuningLoss)
    .map(summarizeValueResult),
  winner: summarizeValueResult(winner),
  policy: {
    outputDirectory: policyResult.outputDirectory,
    manifest: policyResult.manifest,
    audit: policyResult.audit,
    evaluation: policyResult.evaluation,
  },
  releaseDecision: {
    productionRolloutAuthorized: false,
    reason:
      'This is an offline diagnostic sweep. Production remains unchanged until a separately reviewed candidate passes all untouched-test, OPE, shadow, and safety gates.',
  },
};
await saveJson('99-summary.json', summary);
console.log(JSON.stringify(summary, undefined, 2));

async function runValueConfig(config) {
  const valueDirectory = `${valueRoot}/${config.id}-${config.fingerprint.slice(0, 12)}`;
  await configureApi({ valueDirectory });
  await waitForApi(valueEndpoint + '/status', 20 * 60_000);

  let status = await requestJson('GET', valueEndpoint + '/status');
  if (status.state !== 'COMPLETE') {
    if (status.state === 'FAILED') {
      throw new Error(`${config.id} loaded a failed Value V6 state: ${String(status.error)}`);
    }
    status = await requestJson('POST', valueEndpoint + '/start', {
      trainFraction: 0.7,
      tuningFraction: 0.15,
      statePriorStrength: config.statePriorStrength,
      actionPriorStrength: config.actionPriorStrength,
      minimumObservations: config.minimumObservations,
      maximumAbsoluteStateResidual: 1,
      maximumAbsoluteActionResidual: 1,
      actionResidualScales: config.actionResidualScales,
      finalOutcomeWeight: config.finalOutcomeWeight,
      expectedSourceSha256: datasetSha256,
    });
    status = await waitForStage(config.id, valueEndpoint, 360 * 60_000);
  }

  const manifest = await requestJson('GET', valueEndpoint + '/manifest');
  const audit = await requestJson('GET', valueEndpoint + '/audit');
  const evaluation = await requestJson('GET', valueEndpoint + '/evaluation');
  const model = await requestJson('GET', valueEndpoint + '/model');
  assertTrue(audit.passed === true, `${config.id} Value V6 audit failed.`);
  assertTrue(
    requiredSha(manifest?.source?.artifactSha256, `${config.id} source SHA-256`) ===
      datasetSha256,
    `${config.id} source lineage mismatch.`,
  );
  assertTrue(
    Number(model?.options?.statePriorStrength) === config.statePriorStrength &&
      Number(model?.options?.actionPriorStrength) === config.actionPriorStrength &&
      Number(model?.options?.minimumObservations) === config.minimumObservations,
    `${config.id} model options do not match the requested sweep configuration.`,
  );
  assertTrue(
    Number(model?.targetComposition?.finalOutcomeWeight) === config.finalOutcomeWeight,
    `${config.id} final outcome weight does not match the requested configuration.`,
  );

  const result = {
    config,
    valueDirectory,
    status,
    manifest,
    audit,
    evaluation,
    model,
  };
  await saveJson(`value-${config.id}-${config.fingerprint.slice(0, 12)}.json`, {
    config,
    valueDirectory,
    status,
    manifest,
    audit,
    evaluation,
    modelSummary: {
      modelVersion: model.modelVersion,
      modelKind: model.modelKind,
      actionResidualScale: model.actionResidualScale,
      options: model.options,
      targetComposition: model.targetComposition,
    },
  });
  return result;
}

async function runPolicy(valueResult) {
  const outputDirectory = `${policyRoot}/${valueResult.config.id}-${valueResult.config.fingerprint.slice(0, 12)}`;
  await configureApi({
    valueDirectory: valueResult.valueDirectory,
    policyDirectory: outputDirectory,
  });
  await waitForApi(policyEndpoint + '/status', 20 * 60_000);

  const valuePredictionSha256 = requiredSha(
    valueResult.manifest?.artifacts?.predictionEvaluation?.sha256,
    'Winner prediction SHA-256',
  );
  const valueModelSha256 = requiredSha(
    valueResult.manifest?.artifacts?.model?.sha256,
    'Winner model SHA-256',
  );

  let status = await requestJson('GET', policyEndpoint + '/status');
  if (status.state !== 'COMPLETE') {
    if (status.state === 'FAILED') {
      throw new Error(`Policy V6 loaded a failed state: ${String(status.error)}`);
    }
    await requestJson('POST', policyEndpoint + '/start', {
      behaviorTemperature: 1,
      targetTemperature: 1,
      targetAdvantageWeight: 1,
      minBehaviorProbability: 0.01,
      maxImportanceWeight: 10,
      bootstrapReplicates: 1000,
      bootstrapSeed: 20260726,
      maxCandidateActions: 128,
      expectedBehavioralModelSha256: behavioralModelSha256,
      expectedValuePredictionSha256: valuePredictionSha256,
      expectedValueModelSha256: valueModelSha256,
    });
    status = await waitForStage('policy-winner', policyEndpoint, 240 * 60_000);
  }

  const manifest = await requestJson('GET', policyEndpoint + '/manifest');
  const audit = await requestJson('GET', policyEndpoint + '/audit');
  const evaluation = await requestJson('GET', policyEndpoint + '/evaluation');
  assertTrue(audit.passed === true, 'Winner Policy V6 audit failed.');
  const result = { outputDirectory, status, manifest, audit, evaluation };
  await saveJson('40-winner-policy.json', result);
  return result;
}

async function configureApi({ valueDirectory, policyDirectory }) {
  const normalizedPolicyDirectory =
    policyDirectory ?? `${policyRoot}/unused-${createHash('sha256').update(valueDirectory).digest('hex').slice(0, 12)}`;
  const override = `services:\n  api:\n    environment:\n      DEADLOCK_TIMELINE_COLLECTOR_ENABLED: "false"\n      DEADLOCK_RECOMMENDATION_VALUE_V6_SOURCE_DIR: ${datasetDirectory}\n      DEADLOCK_RECOMMENDATION_VALUE_V6_TRAINING_DIR: ${valueDirectory}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_BEHAVIORAL_DIR: ${behavioralDirectory}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_VALUE_DIR: ${valueDirectory}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_OUTPUT_DIR: ${normalizedPolicyDirectory}\n      NODE_OPTIONS: --max-old-space-size=8192\n`;
  await writeFile(overridePath, override, 'utf8');
  runCompose([
    '-f',
    join(deployRepository, 'docker-compose.yml'),
    '-f',
    overridePath,
    'up',
    '-d',
    '--force-recreate',
    '--no-deps',
    'api',
  ]);
}

async function waitForStage(name, endpoint, timeoutMs) {
  const startedAt = Date.now();
  let lastLogAt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    const status = await requestJson('GET', endpoint + '/status');
    if (status.state === 'COMPLETE') {
      return status;
    }
    if (status.state === 'FAILED') {
      throw new Error(`${name} failed: ${String(status.error ?? 'unknown error')}`);
    }
    if (Date.now() - lastLogAt >= 60_000) {
      console.log(`[${name}] ${JSON.stringify(status)}`);
      lastLogAt = Date.now();
    }
    await sleep(10_000);
  }
  throw new Error(`${name} exceeded ${Math.round(timeoutMs / 60_000)} minutes.`);
}

async function waitForApi(path, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await requestJson('GET', path);
      return;
    } catch {
      await sleep(5_000);
    }
  }
  throw new Error(`API did not become ready at ${path}.`);
}

async function requestJson(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(apiBaseUrl + path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    const value = responseText ? JSON.parse(responseText) : {};
    if (!response.ok) {
      throw new Error(`${method} ${path} failed with ${response.status}: ${responseText}`);
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function createConfig(id, statePriorStrength, actionPriorStrength, minimumObservations, finalOutcomeWeight) {
  const options = {
    statePriorStrength,
    actionPriorStrength,
    minimumObservations,
    finalOutcomeWeight,
    actionResidualScales,
  };
  return {
    id,
    ...options,
    fingerprint: createHash('sha256').update(JSON.stringify(options)).digest('hex'),
  };
}

function deduplicateConfigs(configs) {
  const result = new Map();
  for (const config of configs) {
    result.set(config.fingerprint, config);
  }
  return [...result.values()];
}

function selectByTuningLoss(results) {
  assertTrue(results.length > 0, 'Cannot select a sweep winner without results.');
  return [...results].sort(compareByTuningLoss)[0];
}

function compareByTuningLoss(left, right) {
  return tuningLoss(left) - tuningLoss(right) || left.config.id.localeCompare(right.config.id);
}

function tuningLoss(result) {
  const value = Number(result.evaluation?.tuning?.selection?.tuningLoss);
  assertTrue(Number.isFinite(value), `${result.config.id} tuning loss is missing.`);
  return value;
}

function summarizeValueResult(result) {
  return {
    config: result.config,
    valueDirectory: result.valueDirectory,
    tuning: result.evaluation?.tuning,
    test: result.evaluation?.test,
    releaseGate: result.evaluation?.releaseGate,
    modelSha256: result.manifest?.artifacts?.model?.sha256,
    predictionSha256: result.manifest?.artifacts?.predictionEvaluation?.sha256,
    auditPassed: result.audit?.passed === true,
    selectionScore: tuningLoss(result),
    selectionScoreSource: 'tuning.selection.tuningLoss',
  };
}

function resolveStorageVolumeRoot() {
  const value = commandOutput('sudo', [
    'docker',
    'volume',
    'inspect',
    'deadlock_dynamo_helper_deadlock-storage',
    '--format',
    '{{ .Mountpoint }}',
  ]).trim();
  assertTrue(value.startsWith('/'), `Invalid storage volume root: ${value}`);
  return value;
}

function readVolumeJson(containerDirectory, fileName) {
  return JSON.parse(commandOutput('sudo', ['cat', storageHostPath(containerDirectory, fileName)]));
}

function storageHostPath(containerDirectory, fileName) {
  const prefix = '/app/apps/api/storage/';
  assertTrue(
    containerDirectory.startsWith(prefix),
    `Storage directory must start with ${prefix}: ${containerDirectory}`,
  );
  return join(volumeRoot, containerDirectory.slice(prefix.length), fileName);
}

function existsWithSudo(path) {
  try {
    execFileSync('sudo', ['test', '-f', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCompose(args) {
  execFileSync('sudo', ['docker', 'compose', ...args], {
    cwd: deployRepository,
    stdio: 'inherit',
    timeout: 30 * 60_000,
  });
}

function runNode(args) {
  execFileSync(process.execPath, args, {
    stdio: 'inherit',
    timeout: 30 * 60_000,
  });
}

function commandOutput(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 30 * 60_000,
    maxBuffer: 512 * 1024 * 1024,
  });
}

async function saveJson(fileName, value) {
  await writeFile(join(resultDirectory, fileName), `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

function requiredSha(value, name) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  assertTrue(/^[a-f0-9]{64}$/.test(normalized), `${name} is missing or invalid.`);
  return normalized;
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
