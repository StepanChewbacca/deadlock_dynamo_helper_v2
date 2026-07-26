import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository = '/home/ubuntu/apps/deadlock_dynamo_helper';
const expectedCommit = '9590df07f7cb62db8ddae03794f9ba84339c5851';
const apiBaseUrl = 'http://127.0.0.1:3000';
const resultDirectory = join(
  process.env.GITHUB_WORKSPACE ?? process.cwd(),
  'recommendation-v6-full-crawler-result',
);
const overridePath = '/tmp/recommendation-v6-full-crawler.override.yml';
const lockPath = '/tmp/recommendation-v6-full-crawler.lock';
const completedPath = '/tmp/recommendation-v6-full-crawler.completed';

const directories = {
  sourceV4:
    '/app/apps/api/storage/recommendation-decision-dataset-v4-full-crawler-v2-20260724',
  behavioral:
    '/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-v2-20260724',
  timeline: '/app/apps/api/storage/match-timeline-events-v1',
  datasetV5:
    '/app/apps/api/storage/recommendation-decision-dataset-v5-full-crawler-20260726',
  valueV6:
    '/app/apps/api/storage/recommendation-value-v6-full-crawler-20260726',
  policyV6:
    '/app/apps/api/storage/recommendation-policy-v6-full-crawler-20260726',
};

const endpoints = {
  datasetV5: '/deadlock/analysis/recommendation-decision-dataset-v5',
  valueV6: '/deadlock/analysis/recommendation-value-v6-training',
  policyV6: '/deadlock/analysis/recommendation-policy-v6-evaluation',
  telemetry: '/deadlock/analysis/recommendation-telemetry/status',
};

await mkdir(resultDirectory, { recursive: true });

if (await exists(completedPath)) {
  console.log('Recommendation V6 full-crawler cycle already completed; skipping duplicate run.');
  process.exit(0);
}

try {
  await mkdir(lockPath);
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'EEXIST') {
    console.log('Another Recommendation V6 full-crawler cycle is active; skipping duplicate run.');
    process.exit(0);
  }
  throw error;
}

let failure;
let succeeded = false;
try {
  await waitForDeployment();
  const volumeRoot = resolveStorageVolumeRoot();
  await inspectRequiredSources(volumeRoot);
  await prepareCleanOutputDirectories(volumeRoot);
  await configureApi();
  await waitForApi(endpoints.datasetV5 + '/status', 20 * 60_000);
  await saveEnvironment();

  const sourceManifest = readVolumeJson(
    volumeRoot,
    directories.sourceV4,
    'manifest.json',
  );
  const sourceAudit = readVolumeJson(
    volumeRoot,
    directories.sourceV4,
    'audit.json',
  );
  const behavioralManifest = readVolumeJson(
    volumeRoot,
    directories.behavioral,
    'manifest.json',
  );
  const behavioralAudit = readVolumeJson(
    volumeRoot,
    directories.behavioral,
    'audit.json',
  );
  assertTrue(sourceAudit.passed === true, 'Source Recommendation Dataset V4 audit failed.');
  assertTrue(behavioralAudit.passed === true, 'Existing Behavioral V4 audit failed.');
  const sourceSha256 = requiredString(sourceManifest, ['artifact', 'sha256']);
  const behavioralModelSha256 = requiredString(behavioralManifest, [
    'artifacts',
    'model',
    'sha256',
  ]);

  await saveJson('00-inputs.json', {
    expectedCommit,
    directories,
    source: {
      datasetVersion: sourceManifest.datasetVersion,
      rowCount: sourceManifest?.artifact?.rowCount,
      sha256: sourceSha256,
      auditPassed: sourceAudit.passed,
    },
    behavioral: {
      modelVersion: behavioralManifest.modelVersion,
      modelSha256: behavioralModelSha256,
      releaseGatePassed: behavioralManifest.releaseGatePassed,
      auditPassed: behavioralAudit.passed,
    },
  });

  const datasetStatus = await runStage({
    name: '01-dataset-v5',
    endpoint: endpoints.datasetV5,
    body: {
      expectedSourceSha256: sourceSha256,
      partitionCount: 128,
      snapshotStalenessS: 120,
      resume: false,
    },
    timeoutMs: 360 * 60_000,
  });
  const datasetManifest = await readArtifact(
    '01-dataset-v5-manifest',
    endpoints.datasetV5 + '/manifest',
  );
  const datasetAudit = await readArtifact(
    '01-dataset-v5-audit',
    endpoints.datasetV5 + '/audit',
  );
  const sourceAvailability = await readArtifact(
    '01-dataset-v5-source-availability',
    endpoints.datasetV5 + '/source-availability',
  );
  assertTrue(datasetAudit.passed === true, 'Recommendation Dataset V5.3 audit failed.');
  assertTrue(
    datasetManifest.datasetVersion === 'RECOMMENDATION_DECISION_DATASET_V5_3',
    `Unexpected Recommendation Dataset V5 version: ${datasetManifest.datasetVersion}`,
  );
  const datasetSha256 = requiredString(datasetManifest, ['artifact', 'sha256']);

  const valueStatus = await runStage({
    name: '02-value-v6',
    endpoint: endpoints.valueV6,
    body: {
      trainFraction: 0.7,
      tuningFraction: 0.15,
      statePriorStrength: 100,
      actionPriorStrength: 100,
      minimumObservations: 20,
      maximumAbsoluteStateResidual: 1,
      maximumAbsoluteActionResidual: 1,
      actionResidualScales: [0, 0.25, 0.5, 0.75, 1],
      finalOutcomeWeight: 0.25,
      expectedSourceSha256: datasetSha256,
    },
    timeoutMs: 360 * 60_000,
  });
  const valueManifest = await readArtifact(
    '02-value-v6-manifest',
    endpoints.valueV6 + '/manifest',
  );
  const valueAudit = await readArtifact(
    '02-value-v6-audit',
    endpoints.valueV6 + '/audit',
  );
  const valueEvaluation = await readArtifact(
    '02-value-v6-evaluation',
    endpoints.valueV6 + '/evaluation',
  );
  const valueModel = await readArtifact(
    '02-value-v6-model',
    endpoints.valueV6 + '/model',
  );
  assertTrue(valueAudit.passed === true, 'Recommendation Value V6 audit failed.');
  const valuePredictionSha256 = requiredString(valueManifest, [
    'artifacts',
    'predictionEvaluation',
    'sha256',
  ]);
  const valueModelSha256 = requiredString(valueManifest, [
    'artifacts',
    'model',
    'sha256',
  ]);

  const policyStatus = await runStage({
    name: '03-policy-v6',
    endpoint: endpoints.policyV6,
    body: {
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
    },
    timeoutMs: 240 * 60_000,
  });
  const policyManifest = await readArtifact(
    '03-policy-v6-manifest',
    endpoints.policyV6 + '/manifest',
  );
  const policyAudit = await readArtifact(
    '03-policy-v6-audit',
    endpoints.policyV6 + '/audit',
  );
  const policyEvaluation = await readArtifact(
    '03-policy-v6-evaluation',
    endpoints.policyV6 + '/evaluation',
  );
  assertTrue(policyAudit.passed === true, 'Recommendation Policy V6 audit failed.');

  await saveJson('00-summary.json', {
    completedAt: new Date().toISOString(),
    expectedCommit,
    directories,
    datasetV5: {
      status: datasetStatus,
      manifest: datasetManifest,
      audit: datasetAudit,
      sourceAvailability,
    },
    valueV6: {
      status: valueStatus,
      modelKind: valueModel.modelKind,
      releaseGate: valueEvaluation.releaseGate,
      test: valueEvaluation.test,
      modelSha256: valueModelSha256,
      predictionSha256: valuePredictionSha256,
    },
    policyV6: {
      status: policyStatus,
      manifest: policyManifest,
      releaseGate: policyEvaluation.releaseGate,
      estimators: policyEvaluation.estimators,
      bootstrap: policyEvaluation.bootstrap,
      coverage: policyEvaluation.coverage,
      diagnostics: policyEvaluation.diagnostics,
    },
  });

  succeeded = true;
  await writeFile(completedPath, `${new Date().toISOString()}\n`, 'utf8');
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
  await rm(lockPath, { recursive: true, force: true });
  if (!succeeded) {
    await rm(completedPath, { force: true });
  }
}

if (failure) {
  throw failure;
}

async function inspectRequiredSources(volumeRoot) {
  const checks = [
    [directories.sourceV4, 'dataset.ndjson'],
    [directories.sourceV4, 'manifest.json'],
    [directories.sourceV4, 'audit.json'],
    [directories.behavioral, 'validation.ndjson'],
    [directories.behavioral, 'model.json'],
    [directories.behavioral, 'manifest.json'],
    [directories.behavioral, 'audit.json'],
  ];
  const results = checks.map(([directory, fileName]) => {
    const hostPath = storageHostPath(volumeRoot, directory, fileName);
    const present = commandSucceeded('sudo', ['test', '-f', hostPath]);
    assertTrue(present, `Required source artifact is missing: ${directory}/${fileName}`);
    const sizeBytes = Number(commandOutput('sudo', ['stat', '-c', '%s', hostPath]).trim());
    return { directory, fileName, hostPath, sizeBytes };
  });
  const timelineHostPath = storageHostPath(volumeRoot, directories.timeline);
  const timelinePresent = commandSucceeded('sudo', ['test', '-d', timelineHostPath]);
  assertTrue(timelinePresent, `Timeline directory is missing: ${directories.timeline}`);
  const timelineEntryCount = Number(
    commandOutput('sudo', [
      'find',
      timelineHostPath,
      '-type',
      'f',
      '-maxdepth',
      '2',
      '-printf',
      '.',
    ]).length,
  );
  await saveJson('storage-sources.json', {
    volumeRoot,
    artifacts: results,
    timeline: {
      directory: directories.timeline,
      hostPath: timelineHostPath,
      present: timelinePresent,
      approximateFileCount: timelineEntryCount,
    },
  });
}

async function prepareCleanOutputDirectories(volumeRoot) {
  const outputDirectories = [
    directories.datasetV5,
    directories.valueV6,
    directories.policyV6,
  ];
  for (const directory of outputDirectories) {
    const hostPath = storageHostPath(volumeRoot, directory);
    commandOutput('sudo', ['rm', '-rf', hostPath]);
    commandOutput('sudo', ['mkdir', '-p', hostPath]);
  }
  await saveJson('storage-outputs.json', {
    volumeRoot,
    clearedDirectories: outputDirectories,
  });
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
  const override = `services:\n  api:\n    environment:\n      DEADLOCK_RECOMMENDATION_DECISION_DATASET_V5_SOURCE_DIR: ${directories.sourceV4}\n      DEADLOCK_TIMELINE_STORAGE_DIR: ${directories.timeline}\n      DEADLOCK_RECOMMENDATION_DECISION_DATASET_V5_DIR: ${directories.datasetV5}\n      DEADLOCK_RECOMMENDATION_VALUE_V6_SOURCE_DIR: ${directories.datasetV5}\n      DEADLOCK_RECOMMENDATION_VALUE_V6_TRAINING_DIR: ${directories.valueV6}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_BEHAVIORAL_DIR: ${directories.behavioral}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_VALUE_DIR: ${directories.valueV6}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_OUTPUT_DIR: ${directories.policyV6}\n`;
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
  assertTrue(
    status.state !== 'COMPLETE',
    `${name} unexpectedly started with a completed artifact in a clean directory.`,
  );
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
    .filter((line) => line.startsWith('DEADLOCK_RECOMMENDATION_') || line.startsWith('DEADLOCK_TIMELINE_'))
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
    const responseText = await response.text();
    let value;
    try {
      value = responseText ? JSON.parse(responseText) : {};
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

function readVolumeJson(volumeRoot, containerDirectory, fileName) {
  const hostPath = storageHostPath(volumeRoot, containerDirectory, fileName);
  return JSON.parse(commandOutput('sudo', ['cat', hostPath]));
}

function storageHostPath(volumeRoot, containerDirectory, fileName) {
  const prefix = '/app/apps/api/storage/';
  assertTrue(
    containerDirectory.startsWith(prefix),
    `Storage directory must start with ${prefix}: ${containerDirectory}`,
  );
  const relative = containerDirectory.slice(prefix.length);
  return fileName ? join(volumeRoot, relative, fileName) : join(volumeRoot, relative);
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
    timeout: 20 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function commandSucceeded(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' }).status === 0;
}

async function saveJson(name, value) {
  await writeFile(
    join(resultDirectory, name),
    `${JSON.stringify(value, undefined, 2)}\n`,
    'utf8',
  );
}

function requiredString(value, path) {
  const resolved = nestedValue(value, path);
  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new Error(`Expected non-empty string at ${path.join('.')}.`);
  }
  return resolved;
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
