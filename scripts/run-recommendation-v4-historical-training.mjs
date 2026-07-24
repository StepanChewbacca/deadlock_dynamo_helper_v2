import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository = '/home/ubuntu/apps/deadlock_dynamo_helper';
const expectedCommit = '64c25ebcb0b43e5546d8be70570631a9f57e94fe';
const apiBaseUrl = 'http://127.0.0.1:3000';
const resultDirectory = join(
  process.env.GITHUB_WORKSPACE ?? process.cwd(),
  'recommendation-v4-historical-training-result',
);
const overridePath = '/tmp/recommendation-v4-historical-training.override.yml';

const endpoints = {
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
  await configureHistoricalApi();
  await waitForApi(endpoints.bootstrap + '/status', 20 * 60_000);
  await verifyHistoricalEnvironment();

  const bootstrap = await runStage({
    name: 'bootstrap',
    endpoint: endpoints.bootstrap,
    body: {},
    timeoutMs: 90 * 60_000,
  });
  const bootstrapManifest = await readArtifact(
    'bootstrap-manifest',
    endpoints.bootstrap + '/manifest',
  );
  const bootstrapAudit = await readArtifact(
    'bootstrap-audit',
    endpoints.bootstrap + '/audit',
  );
  assertTrue(bootstrapAudit.passed === true, 'Historical bootstrap audit failed.');
  const datasetSha256 = requiredString(bootstrapManifest, [
    'artifact',
    'sha256',
  ]);
  const datasetRowCount = requiredPositiveInteger(bootstrapManifest, [
    'artifact',
    'rowCount',
  ]);

  const behavioral = await runStage({
    name: 'behavioral',
    endpoint: endpoints.behavioral,
    body: { expectedSourceSha256: datasetSha256 },
    timeoutMs: 90 * 60_000,
  });
  const behavioralManifest = await readArtifact(
    'behavioral-manifest',
    endpoints.behavioral + '/manifest',
  );
  const behavioralAudit = await readArtifact(
    'behavioral-audit',
    endpoints.behavioral + '/audit',
  );
  const behavioralEvaluation = await readArtifact(
    'behavioral-evaluation',
    endpoints.behavioral + '/evaluation',
  );
  assertTrue(behavioralAudit.passed === true, 'Behavioral V4 audit failed.');
  const behavioralModelSha256 = requiredString(behavioralManifest, [
    'artifacts',
    'model',
    'sha256',
  ]);

  const value = await runStage({
    name: 'value',
    endpoint: endpoints.value,
    body: { expectedSourceSha256: datasetSha256 },
    timeoutMs: 90 * 60_000,
  });
  const valueManifest = await readArtifact(
    'value-manifest',
    endpoints.value + '/manifest',
  );
  const valueAudit = await readArtifact(
    'value-audit',
    endpoints.value + '/audit',
  );
  const valueEvaluation = await readArtifact(
    'value-evaluation',
    endpoints.value + '/evaluation',
  );
  assertTrue(valueAudit.passed === true, 'Value V4 audit failed.');
  const valueModelSha256 = requiredString(valueManifest, [
    'artifacts',
    'model',
    'sha256',
  ]);

  const policy = await runStage({
    name: 'policy',
    endpoint: endpoints.policy,
    body: {
      expectedDatasetSha256: datasetSha256,
      expectedBehavioralModelSha256: behavioralModelSha256,
      expectedValueModelSha256: valueModelSha256,
      bootstrapReplicates: 1000,
      bootstrapSeed: 20260724,
    },
    timeoutMs: 70 * 60_000,
  });
  const policyManifest = await readArtifact(
    'policy-manifest',
    endpoints.policy + '/manifest',
  );
  const policyAudit = await readArtifact(
    'policy-audit',
    endpoints.policy + '/audit',
  );
  const policyEvaluation = await readArtifact(
    'policy-evaluation',
    endpoints.policy + '/evaluation',
  );
  assertTrue(policyAudit.passed === true, 'Policy V4 audit failed.');

  await saveJson('00-summary.json', {
    completedAt: new Date().toISOString(),
    expectedCommit,
    dataset: {
      sha256: datasetSha256,
      rowCount: datasetRowCount,
      status: bootstrap,
      sourceKind: bootstrapManifest.datasetSourceKind,
    },
    behavioral: {
      status: behavioral,
      modelSha256: behavioralModelSha256,
      releaseGate: nestedValue(behavioralEvaluation, ['releaseGate']),
    },
    value: {
      status: value,
      modelSha256: valueModelSha256,
      releaseGate: nestedValue(valueEvaluation, ['releaseGate']),
    },
    policy: {
      status: policy,
      releaseGate: nestedValue(policyEvaluation, ['releaseGate']),
      productionRolloutAuthorized:
        policyManifest.productionRolloutAuthorized ?? false,
    },
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
    await saveJson('98-restore-failure.json', {
      failedAt: new Date().toISOString(),
      error: getErrorMessage(restoreError),
    });
    failure ??= restoreError;
  }
}

if (failure) {
  throw failure;
}

async function runStage({ name, endpoint, body, timeoutMs }) {
  const initialStatus = await requestJson('GET', endpoint + '/status');
  await saveJson(`${name}-00-before-status.json`, initialStatus);
  const startResponse = await requestJson('POST', endpoint + '/start', body);
  await saveJson(`${name}-01-start-response.json`, startResponse);
  const startedAt = Date.now();
  let lastProgressLogAt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    const status = await requestJson('GET', endpoint + '/status');
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

async function configureHistoricalApi() {
  const override = `services:\n  api:\n    environment:\n      DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_OUTPUT_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR: /app/apps/api/storage/recommendation-behavioral-v4-training-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR: /app/apps/api/storage/recommendation-value-v4-training-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR: /app/apps/api/storage/recommendation-behavioral-v4-training-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR: /app/apps/api/storage/recommendation-value-v4-training-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR: /app/apps/api/storage/recommendation-policy-v4-evaluation-historical-bootstrap\n`;
  await writeFile(overridePath, override, 'utf8');
  runSudoDockerCompose([
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

async function verifyHistoricalEnvironment() {
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
    'sh',
    '-lc',
    "env | sort | grep '^DEADLOCK_RECOMMENDATION_.*V4'",
  ]);
  await writeFile(join(resultDirectory, 'historical-environment.txt'), output, 'utf8');
  const requiredValues = [
    'DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR=/app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap',
    'DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR=/app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap',
    'DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR=/app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap',
  ];
  for (const value of requiredValues) {
    assertTrue(output.includes(value), `Historical API environment is missing ${value}.`);
  }
}

async function restoreProductionApi() {
  runSudoDockerCompose([
    '-f',
    join(deployRepository, 'docker-compose.yml'),
    'up',
    '-d',
    '--force-recreate',
    '--no-deps',
    'api',
  ]);
  await waitForApi(endpoints.telemetry, 15 * 60_000);
  const telemetry = await requestJson('GET', endpoints.telemetry);
  await saveJson('97-restored-telemetry-status.json', telemetry);
  assertTrue(telemetry.state === 'READY', 'Production telemetry was not READY after restore.');
  await rm(overridePath, { force: true });
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
  throw new Error(`API endpoint ${path} did not become ready.`);
}

async function requestJson(method, path, body) {
  const response = await fetch(apiBaseUrl + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} returned invalid JSON: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(value)}`);
  }
  return value;
}

function runSudoDockerCompose(args) {
  execFileSync('sudo', ['docker', 'compose', ...args], {
    cwd: deployRepository,
    encoding: 'utf8',
    stdio: 'inherit',
  });
}

function commandOutput(command, args) {
  return execFileSync(command, args, {
    cwd: deployRepository,
    encoding: 'utf8',
  });
}

async function saveJson(fileName, value) {
  await writeFile(
    join(resultDirectory, fileName),
    `${JSON.stringify(value, undefined, 2)}\n`,
    'utf8',
  );
}

function requiredString(value, path) {
  const result = nestedValue(value, path);
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error(`Required string ${path.join('.')} is missing.`);
  }
  return result;
}

function requiredPositiveInteger(value, path) {
  const result = Number(nestedValue(value, path));
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error(`Required positive integer ${path.join('.')} is missing.`);
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
