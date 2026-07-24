import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository = '/home/ubuntu/apps/deadlock_dynamo_helper';
const expectedCommit = 'bf9bfaf99715a0f9bb54d2caa3b0c3b4b7abf066';
const apiBaseUrl = 'http://127.0.0.1:3000';
const resultDirectory = join(
  process.env.GITHUB_WORKSPACE ?? process.cwd(),
  'full-crawler-recommendation-cycle-result',
);
const overridePath = '/tmp/full-crawler-recommendation-cycle.override.yml';

const directories = {
  dataset: '/app/apps/api/storage/build-decision-dataset-v3-full-crawler-20260724',
  contextualTraining:
    '/app/apps/api/storage/contextual-v3-training-full-crawler-20260724',
  contextualCandidates:
    '/app/apps/api/storage/contextual-v3-candidate-evaluation-full-crawler-20260724',
  bootstrap:
    '/app/apps/api/storage/recommendation-decision-dataset-v4-full-crawler-20260724',
  behavioral:
    '/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-20260724',
  value: '/app/apps/api/storage/recommendation-value-v4-full-crawler-20260724',
  policy: '/app/apps/api/storage/recommendation-policy-v4-full-crawler-20260724',
};

const endpoints = {
  dataset: '/deadlock/analysis/build-decision-dataset-v3',
  contextualTraining: '/deadlock/analysis/contextual-v3-training',
  contextualCandidates:
    '/deadlock/analysis/contextual-v3-candidate-evaluation',
  bootstrap:
    '/deadlock/analysis/recommendation-decision-dataset-v4-historical-bootstrap',
  behavioral: '/deadlock/analysis/recommendation-behavioral-v4-training',
  value: '/deadlock/analysis/recommendation-value-v4-training',
  policy: '/deadlock/analysis/recommendation-policy-v4-evaluation',
  telemetry: '/deadlock/analysis/recommendation-telemetry/status',
};

await mkdir(resultDirectory, { recursive: true });
let failure;
try {
  await waitForDeployment();
  await prepareIsolatedDirectories();
  await configureApi();
  await waitForApi(endpoints.dataset + '/status', 20 * 60_000);
  await saveEnvironment();

  const datasetStatus = await runStage({
    name: '01-dataset',
    endpoint: endpoints.dataset,
    body: { batchSize: 250, includeSellActions: false },
    timeoutMs: 180 * 60_000,
  });
  const datasetManifest = await readArtifact(
    '01-dataset-manifest',
    endpoints.dataset + '/manifest',
  );
  const datasetAudit = await readArtifact(
    '01-dataset-audit',
    endpoints.dataset + '/audit',
  );
  assertTrue(datasetAudit.passed === true, 'Full crawler dataset audit failed.');
  assertTrue(
    datasetManifest?.source?.excludedByLimitMatchCount === 0,
    'The production dataset unexpectedly excluded matches by limit.',
  );
  const contextualSourceSha256 = requiredString(datasetManifest, [
    'artifact',
    'sha256',
  ]);

  const trainingStatus = await runStage({
    name: '02-contextual-training',
    endpoint: endpoints.contextualTraining,
    body: {
      trainFraction: 0.7,
      candidateLimit: 100,
      expectedSourceSha256: contextualSourceSha256,
    },
    timeoutMs: 120 * 60_000,
  });
  const trainingManifest = await readArtifact(
    '02-contextual-training-manifest',
    endpoints.contextualTraining + '/manifest',
  );
  const trainingAudit = await readArtifact(
    '02-contextual-training-audit',
    endpoints.contextualTraining + '/audit',
  );
  const trainingEvaluation = await readArtifact(
    '02-contextual-training-evaluation',
    endpoints.contextualTraining + '/evaluation',
  );
  assertTrue(trainingAudit.passed === true, 'Contextual training audit failed.');

  const candidateStatus = await runStage({
    name: '03-contextual-candidates',
    endpoint: endpoints.contextualCandidates,
    body: { candidateLimit: 100 },
    timeoutMs: 90 * 60_000,
  });
  const candidateManifest = await readArtifact(
    '03-contextual-candidates-manifest',
    endpoints.contextualCandidates + '/manifest',
  );
  const candidateAudit = await readArtifact(
    '03-contextual-candidates-audit',
    endpoints.contextualCandidates + '/audit',
  );
  const candidateEvaluation = await readArtifact(
    '03-contextual-candidates-evaluation',
    endpoints.contextualCandidates + '/evaluation',
  );
  assertTrue(candidateAudit.passed === true, 'Candidate evaluation audit failed.');
  assertTrue(
    candidateManifest.evaluationReleaseGatePassed === true,
    'Candidate evaluation release gate failed.',
  );

  const validationSha256 = requiredString(trainingManifest, [
    'artifacts',
    'validation',
    'sha256',
  ]);
  const candidateSha256 = requiredString(candidateManifest, [
    'artifacts',
    'candidates',
    'sha256',
  ]);

  const bootstrapStatus = await runStage({
    name: '04-bootstrap',
    endpoint: endpoints.bootstrap,
    body: {
      expectedValidationSha256: validationSha256,
      expectedCandidateSha256: candidateSha256,
    },
    timeoutMs: 90 * 60_000,
  });
  const bootstrapManifest = await readArtifact(
    '04-bootstrap-manifest',
    endpoints.bootstrap + '/manifest',
  );
  const bootstrapAudit = await readArtifact(
    '04-bootstrap-audit',
    endpoints.bootstrap + '/audit',
  );
  assertTrue(bootstrapAudit.passed === true, 'Recommendation bootstrap audit failed.');
  const recommendationDatasetSha256 = requiredString(bootstrapManifest, [
    'artifact',
    'sha256',
  ]);

  const behavioralStatus = await runStage({
    name: '05-behavioral',
    endpoint: endpoints.behavioral,
    body: { expectedSourceSha256: recommendationDatasetSha256 },
    timeoutMs: 90 * 60_000,
  });
  const behavioralManifest = await readArtifact(
    '05-behavioral-manifest',
    endpoints.behavioral + '/manifest',
  );
  const behavioralAudit = await readArtifact(
    '05-behavioral-audit',
    endpoints.behavioral + '/audit',
  );
  const behavioralEvaluation = await readArtifact(
    '05-behavioral-evaluation',
    endpoints.behavioral + '/evaluation',
  );
  assertTrue(behavioralAudit.passed === true, 'Behavioral V4 audit failed.');
  const behavioralModelSha256 = requiredString(behavioralManifest, [
    'artifacts',
    'model',
    'sha256',
  ]);

  const valueStatus = await runStage({
    name: '06-value',
    endpoint: endpoints.value,
    body: {
      trainFraction: 0.8,
      priorStrength: 100,
      minContextObservations: 20,
      calibrationBinCount: 10,
      expectedSourceSha256: recommendationDatasetSha256,
    },
    timeoutMs: 120 * 60_000,
  });
  const valueManifest = await readArtifact(
    '06-value-manifest',
    endpoints.value + '/manifest',
  );
  const valueAudit = await readArtifact(
    '06-value-audit',
    endpoints.value + '/audit',
  );
  const valueEvaluation = await readArtifact(
    '06-value-evaluation',
    endpoints.value + '/evaluation',
  );
  assertTrue(valueAudit.passed === true, 'Value V4 audit failed.');
  const valueModelSha256 = requiredString(valueManifest, [
    'artifacts',
    'model',
    'sha256',
  ]);

  const behavioralGatePassed =
    nestedValue(behavioralEvaluation, ['releaseGate', 'passed']) === true;
  const valueGatePassed =
    nestedValue(valueEvaluation, ['releaseGate', 'passed']) === true;

  let policySummary = {
    skipped: true,
    reasons: [
      ...(behavioralGatePassed ? [] : ['BEHAVIORAL_RELEASE_GATE_FAILED']),
      ...(valueGatePassed ? [] : ['VALUE_RELEASE_GATE_FAILED']),
    ],
  };
  if (behavioralGatePassed && valueGatePassed) {
    const policyStatus = await runStage({
      name: '07-policy',
      endpoint: endpoints.policy,
      body: {
        expectedDatasetSha256: recommendationDatasetSha256,
        expectedBehavioralModelSha256: behavioralModelSha256,
        expectedValueModelSha256: valueModelSha256,
        bootstrapReplicates: 1000,
        bootstrapSeed: 20260724,
      },
      timeoutMs: 90 * 60_000,
    });
    const policyManifest = await readArtifact(
      '07-policy-manifest',
      endpoints.policy + '/manifest',
    );
    const policyAudit = await readArtifact(
      '07-policy-audit',
      endpoints.policy + '/audit',
    );
    const policyEvaluation = await readArtifact(
      '07-policy-evaluation',
      endpoints.policy + '/evaluation',
    );
    assertTrue(policyAudit.passed === true, 'Policy V4 audit failed.');
    policySummary = {
      skipped: false,
      status: policyStatus,
      manifest: policyManifest,
      audit: policyAudit,
      evaluation: policyEvaluation,
    };
  }

  await saveJson('00-summary.json', {
    completedAt: new Date().toISOString(),
    expectedCommit,
    directories,
    dataset: {
      status: datasetStatus,
      totalAvailableMatchCount: datasetManifest.source.totalAvailableMatchCount,
      selectedMatchCount: datasetManifest.source.selectedMatchCount,
      matchCountWithRows: datasetAudit.source.matchCountWithRows,
      rowCount: datasetManifest.artifact.rowCount,
      sha256: contextualSourceSha256,
      snapshotCrawledAt: datasetManifest.source.snapshotCrawledAt,
    },
    contextualTraining: {
      status: trainingStatus,
      split: trainingManifest.split,
      releaseGate: trainingEvaluation.releaseGate,
    },
    contextualCandidates: {
      status: candidateStatus,
      releaseGate: candidateEvaluation.releaseGate,
      coverage: candidateEvaluation.candidateCoverageRate,
    },
    recommendationDataset: {
      status: bootstrapStatus,
      rowCount: bootstrapManifest.artifact.rowCount,
      matchCount: bootstrapAudit.source.matchCount,
      sha256: recommendationDatasetSha256,
    },
    behavioral: {
      status: behavioralStatus,
      modelSha256: behavioralModelSha256,
      releaseGate: behavioralEvaluation.releaseGate,
    },
    value: {
      status: valueStatus,
      modelSha256: valueModelSha256,
      releaseGate: valueEvaluation.releaseGate,
    },
    policy: policySummary,
  });
} catch (error) {
  failure = error;
  await saveJson('99-failure.json', {
    failedAt: new Date().toISOString(),
    error: getErrorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
} finally {
  try {
    await restoreProductionApi();
  } catch (restoreError) {
    failure ??= restoreError;
    await saveJson('98-restore-failure.json', {
      failedAt: new Date().toISOString(),
      error: getErrorMessage(restoreError),
    });
  }
}

if (failure) {
  throw failure;
}

async function prepareIsolatedDirectories() {
  const volumeRoot = resolveStorageVolumeRoot();
  const sourceTraining = join(volumeRoot, 'contextual-v3-training');
  const isolatedTraining = join(
    volumeRoot,
    'contextual-v3-training-full-crawler-20260724',
  );
  commandOutput('sudo', ['mkdir', '-p', isolatedTraining]);
  const copy = spawnSync(
    'sudo',
    ['cp', '-a', `${sourceTraining}/.`, isolatedTraining],
    { encoding: 'utf8', timeout: 10 * 60_000 },
  );
  if (copy.status !== 0) {
    throw new Error(`Failed to seed the isolated training directory: ${copy.stderr}`);
  }
  await saveJson('storage-volume.json', { volumeRoot, directories });
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
  if (!value.startsWith('/')) {
    throw new Error(`Invalid deadlock storage mountpoint: ${value}`);
  }
  return value;
}

async function configureApi() {
  const override = `services:\n  api:\n    environment:\n      DEADLOCK_BUILD_DECISION_DATASET_V3_STORAGE_DIR: ${directories.dataset}\n      DEADLOCK_CONTEXTUAL_V3_SOURCE_DIR: ${directories.dataset}\n      DEADLOCK_CONTEXTUAL_V3_TRAINING_DIR: ${directories.contextualTraining}\n      DEADLOCK_CONTEXTUAL_V3_CANDIDATE_EVALUATION_DIR: ${directories.contextualCandidates}\n      DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_TRAINING_DIR: ${directories.contextualTraining}\n      DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_CANDIDATE_DIR: ${directories.contextualCandidates}\n      DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_OUTPUT_DIR: ${directories.bootstrap}\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR: ${directories.bootstrap}\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR: ${directories.behavioral}\n      DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR: ${directories.bootstrap}\n      DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR: ${directories.value}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR: ${directories.bootstrap}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR: ${directories.behavioral}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR: ${directories.value}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR: ${directories.policy}\n`;
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

async function restoreProductionApi() {
  runCompose([
    '-f',
    join(deployRepository, 'docker-compose.yml'),
    'up',
    '-d',
    '--force-recreate',
    '--no-deps',
    'api',
  ]);
  await rm(overridePath, { force: true });
  await waitForApi(endpoints.telemetry, 15 * 60_000);
  await saveJson(
    '97-restored-telemetry-status.json',
    await requestJson('GET', endpoints.telemetry),
  );
}

async function runStage({ name, endpoint, body, timeoutMs }) {
  let status = await requestJson('GET', endpoint + '/status');
  await saveJson(`${name}-00-before-status.json`, status);
  if (status.state === 'COMPLETE') {
    return status;
  }
  if (status.state !== 'RUNNING') {
    status = await requestJson('POST', endpoint + '/start', body);
    await saveJson(`${name}-01-start-response.json`, status);
  }
  const startedAt = Date.now();
  let lastProgressLogAt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    status = await requestJson('GET', endpoint + '/status');
    await saveJson(`${name}-02-status.json`, status);
    if (status.state === 'COMPLETE') {
      return status;
    }
    if (status.state === 'FAILED') {
      throw new Error(`${name} failed: ${String(status.error ?? 'unknown error')}`);
    }
    if (Date.now() - lastProgressLogAt >= 60_000) {
      console.log(`[${name}] ${JSON.stringify(status)}`);
      lastProgressLogAt = Date.now();
    }
    await sleep(10_000);
  }
  throw new Error(`${name} exceeded its ${Math.round(timeoutMs / 60_000)} minute timeout.`);
}

async function readArtifact(name, path) {
  const value = await requestJson('GET', path);
  await saveJson(`${name}.json`, value);
  return value;
}

async function waitForDeployment() {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= 60 * 60_000) {
    const currentCommit = commandOutput('git', [
      '-C',
      deployRepository,
      'rev-parse',
      'HEAD',
    ]).trim();
    const ancestor = spawnSync(
      'git',
      [
        '-C',
        deployRepository,
        'merge-base',
        '--is-ancestor',
        expectedCommit,
        currentCommit,
      ],
      { encoding: 'utf8' },
    );
    if (ancestor.status === 0) {
      await saveJson('deploy.json', {
        expectedCommit,
        deployedCommit: currentCommit,
      });
      return;
    }
    await sleep(15_000);
  }
  throw new Error(`Production did not deploy ${expectedCommit} within one hour.`);
}

async function saveEnvironment() {
  const output = commandOutput('sudo', [
    'docker',
    'compose',
    '-f',
    join(deployRepository, 'docker-compose.yml'),
    '-f',
    overridePath,
    'exec',
    '-T',
    'api',
    'env',
  ]);
  const relevant = output
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('DEADLOCK_BUILD_DECISION_') ||
        line.startsWith('DEADLOCK_CONTEXTUAL_V3_') ||
        line.startsWith('DEADLOCK_RECOMMENDATION_'),
    )
    .sort()
    .join('\n');
  await writeFile(join(resultDirectory, 'environment.txt'), `${relevant}\n`, 'utf8');
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
    const text = await response.text();
    let value;
    try {
      value = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${method} ${path} returned non-JSON status ${response.status}.`);
    }
    if (!response.ok) {
      throw new Error(
        `${method} ${path} failed with ${response.status}: ${JSON.stringify(value)}`,
      );
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function runCompose(args) {
  const result = spawnSync('sudo', ['docker', 'compose', ...args], {
    encoding: 'utf8',
    timeout: 20 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `sudo docker compose ${args.join(' ')} failed: ${result.stderr || result.stdout}`,
    );
  }
}

function commandOutput(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 10 * 60_000,
  });
}

async function saveJson(name, value) {
  await writeFile(
    join(resultDirectory, name),
    `${JSON.stringify(value, undefined, 2)}\n`,
    'utf8',
  );
}

function requiredString(value, path) {
  const result = nestedValue(value, path);
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`Required string is missing at ${path.join('.')}.`);
  }
  return result;
}

function nestedValue(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
