const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_PIPELINE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DIAGNOSTIC_MAX_ROWS = 10000;

const config = {
  apiBaseUrl: requiredString('API_BASE_URL').replace(/\/+$/, ''),
  snapshotId: requiredString('SNAPSHOT_ID'),
  generatorVersion: requiredString('CANDIDATE_GENERATOR_VERSION'),
  policyVersion: requiredString('CANDIDATE_POLICY_VERSION'),
  catalogVersionId: requiredInteger('CATALOG_VERSION_ID'),
  trainingWindowStart: requiredString('TRAINING_WINDOW_START'),
  trainingWindowEnd: requiredString('TRAINING_WINDOW_END'),
  tuningStart: requiredString('TUNING_START'),
  futureTestStart: requiredString('FUTURE_TEST_START'),
  diagnosticMaxRows: optionalInteger(
    'DIAGNOSTIC_MAX_ROWS',
    DEFAULT_DIAGNOSTIC_MAX_ROWS,
  ),
  pollIntervalMs: optionalInteger(
    'PIPELINE_POLL_INTERVAL_MS',
    DEFAULT_POLL_INTERVAL_MS,
  ),
  pipelineTimeoutMs: optionalInteger(
    'PIPELINE_TIMEOUT_MS',
    DEFAULT_PIPELINE_TIMEOUT_MS,
  ),
  expectedSnapshotSourceSha256: optionalString(
    'EXPECTED_SNAPSHOT_SOURCE_SHA256',
  ),
  expectedV6ModelSha256: optionalString('EXPECTED_V6_MODEL_SHA256'),
  replayPartitionCount: optionalInteger('REPLAY_PARTITION_COUNT'),
  replaySnapshotStalenessS: optionalInteger('REPLAY_SNAPSHOT_STALENESS_S'),
  datasetSnapshotStalenessS: optionalInteger(
    'DATASET_DECISION_SNAPSHOT_STALENESS_S',
  ),
};

await main();

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`Recommendation V8 real-data pipeline started at ${startedAt}.`);

  const snapshotRegistry = await ensureCandidateSnapshot();
  const replay = await runHistoricalReplay();
  const dataset = await runDatasetV6(replay.manifest);
  const behavioral = await runBehavioralV5(dataset.manifest);
  const diagnostic = await runValueV8Diagnostic(
    dataset.manifest,
    behavioral.manifest,
  );
  const baseline = await runFrozenV6Baseline(dataset.manifest);
  const fullEvaluation = await runValueV8FullEvaluation({
    datasetManifest: dataset.manifest,
    behavioralManifest: behavioral.manifest,
    baselineManifest: baseline.manifest,
  });
  const shadowStatus = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8/passive-shadow/status',
  );

  assertEqual(
    fullEvaluation.status.randomizedCanaryAuthorized,
    false,
    'Full Value V8 unexpectedly authorized randomized canary.',
  );
  assertEqual(
    fullEvaluation.audit.randomizedCanaryAuthorized,
    false,
    'Full Value V8 audit unexpectedly authorized randomized canary.',
  );
  assertEqual(
    shadowStatus.randomizedCanaryAuthorized,
    false,
    'Passive shadow status unexpectedly authorized randomized canary.',
  );

  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    snapshotId: config.snapshotId,
    snapshotCount: snapshotRegistry.snapshots.length,
    replay: summarizeStatus(replay.status),
    datasetV6: summarizeStatus(dataset.status),
    behavioralV5: summarizeStatus(behavioral.status),
    valueV8Diagnostic: summarizeStatus(diagnostic.status),
    frozenV6Baseline: summarizeStatus(baseline.status),
    valueV8FullEvaluation: summarizeStatus(fullEvaluation.status),
    releaseGatePassed: fullEvaluation.status.releaseGatePassed,
    passiveShadowAuthorized: fullEvaluation.status.passiveShadowAuthorized,
    passiveShadowActivatedByRunner: false,
    randomizedCanaryAuthorized: false,
  };

  console.log(JSON.stringify(report, null, 2));
}

async function ensureCandidateSnapshot() {
  const registryPath =
    '/deadlock/analysis/recommendation-candidate-generator-snapshots/registry';
  let registry = await requestJson('GET', registryPath);
  assertArray(registry.snapshots, 'Candidate snapshot registry has no snapshots array.');

  if (registry.snapshots.some((snapshot) => snapshot.snapshotId === config.snapshotId)) {
    console.log(`Candidate snapshot ${config.snapshotId} already exists. Reusing it.`);
    return registry;
  }

  const body = compactObject({
    snapshotId: config.snapshotId,
    generatorVersion: config.generatorVersion,
    policyVersion: config.policyVersion,
    catalogVersionId: config.catalogVersionId,
    trainingWindowStart: config.trainingWindowStart,
    trainingWindowEnd: config.trainingWindowEnd,
    expectedSourceSha256: config.expectedSnapshotSourceSha256,
  });

  await startAndWait({
    name: 'Candidate generator snapshot',
    startPath:
      '/deadlock/analysis/recommendation-candidate-generator-snapshots/start',
    statusPath:
      '/deadlock/analysis/recommendation-candidate-generator-snapshots/status',
    body,
  });

  registry = await requestJson('GET', registryPath);
  assertArray(registry.snapshots, 'Candidate snapshot registry has no snapshots array.');
  assertTrue(
    registry.snapshots.some((snapshot) => snapshot.snapshotId === config.snapshotId),
    `Candidate snapshot ${config.snapshotId} was not persisted in the registry.`,
  );
  return registry;
}

async function runHistoricalReplay() {
  const status = await startAndWait({
    name: 'Historical replay',
    startPath: '/deadlock/analysis/recommendation-historical-pro-replay/start',
    statusPath: '/deadlock/analysis/recommendation-historical-pro-replay/status',
    body: compactObject({
      partitionCount: config.replayPartitionCount,
      snapshotStalenessS: config.replaySnapshotStalenessS,
      resume: true,
    }),
  });

  assertTrue(status.auditPassed, 'Historical replay audit did not pass.');
  const manifest = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-historical-pro-replay/manifest',
  );
  const audit = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-historical-pro-replay/audit',
  );
  assertTrue(
    manifest.trainingArtifactEligible,
    'Historical replay manifest is not training eligible.',
  );
  assertTrue(
    audit.trainingArtifactEligible,
    'Historical replay audit is not training eligible.',
  );
  return { status, manifest, audit };
}

async function runDatasetV6(replayManifest) {
  const status = await startAndWait({
    name: 'Dataset V6',
    startPath: '/deadlock/analysis/recommendation-pro-decision-dataset-v6/start',
    statusPath: '/deadlock/analysis/recommendation-pro-decision-dataset-v6/status',
    body: compactObject({
      tuningStart: config.tuningStart,
      futureTestStart: config.futureTestStart,
      expectedReplaySha256: readString(
        replayManifest,
        ['artifact', 'sha256'],
        'Historical replay artifact SHA-256',
      ),
      expectedSnapshotRegistrySha256: readString(
        replayManifest,
        ['candidateGeneratorSnapshots', 'registrySha256'],
        'Candidate snapshot registry SHA-256',
      ),
      decisionSnapshotStalenessS: config.datasetSnapshotStalenessS,
    }),
  });

  assertTrue(status.auditPassed, 'Dataset V6 audit did not pass.');
  assertTrue(
    status.trainingArtifactEligible,
    'Dataset V6 is not training eligible.',
  );
  const manifest = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-pro-decision-dataset-v6/manifest',
  );
  const audit = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-pro-decision-dataset-v6/audit',
  );
  assertTrue(manifest.auditPassed, 'Dataset V6 manifest audit flag is false.');
  assertTrue(
    manifest.trainingArtifactEligible,
    'Dataset V6 manifest is not training eligible.',
  );
  return { status, manifest, audit };
}

async function runBehavioralV5(datasetManifest) {
  const status = await startAndWait({
    name: 'Behavioral V5',
    startPath: '/deadlock/analysis/recommendation-behavioral-v5-training/start',
    statusPath: '/deadlock/analysis/recommendation-behavioral-v5-training/status',
    body: {
      expectedSourceSha256: datasetArtifactSha(datasetManifest),
    },
  });

  assertTrue(status.releaseGatePassed, 'Behavioral V5 release gate did not pass.');
  assertTrue(
    status.trainingArtifactEligible,
    'Behavioral V5 artifact is not training eligible.',
  );
  const manifest = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-behavioral-v5-training/manifest',
  );
  const audit = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-behavioral-v5-training/audit',
  );
  const evaluation = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-behavioral-v5-training/evaluation',
  );
  return { status, manifest, audit, evaluation };
}

async function runValueV8Diagnostic(datasetManifest, behavioralManifest) {
  const propensitySha256 = findArtifactSha(
    behavioralManifest,
    'propensities.ndjson',
  );
  const status = await startAndWait({
    name: 'Value V8 diagnostic',
    startPath: '/deadlock/analysis/recommendation-value-v8-diagnostic/start',
    statusPath: '/deadlock/analysis/recommendation-value-v8-diagnostic/status',
    body: compactObject({
      maxRows: config.diagnosticMaxRows,
      expectedDatasetSha256: datasetArtifactSha(datasetManifest),
      expectedBehavioralPropensitySha256: propensitySha256,
    }),
  });

  assertTrue(
    status.diagnosticGatePassed,
    'Value V8 diagnostic gate did not pass.',
  );
  assertTrue(
    status.fullTrainingRecommended,
    'Value V8 diagnostic did not recommend full training.',
  );
  const manifest = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-diagnostic/manifest',
  );
  const audit = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-diagnostic/audit',
  );
  const evaluation = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-diagnostic/evaluation',
  );
  assertEqual(
    audit.futureTestUsed,
    false,
    'Value V8 diagnostic used FUTURE_TEST.',
  );
  return { status, manifest, audit, evaluation };
}

async function runFrozenV6Baseline(datasetManifest) {
  const status = await startAndWait({
    name: 'Frozen V6 baseline',
    startPath:
      '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/start',
    statusPath:
      '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/status',
    body: compactObject({
      expectedDatasetSha256: datasetArtifactSha(datasetManifest),
      expectedModelSha256: config.expectedV6ModelSha256,
    }),
  });

  const manifest = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/manifest',
  );
  const audit = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/audit',
  );
  assertTrue(audit.passed, 'Frozen V6 baseline audit did not pass.');
  assertEqual(
    audit.trainingPerformed,
    false,
    'Frozen V6 baseline unexpectedly performed training.',
  );
  return { status, manifest, audit };
}

async function runValueV8FullEvaluation({
  datasetManifest,
  behavioralManifest,
  baselineManifest,
}) {
  const status = await startAndWait({
    name: 'Full Value V8 evaluation',
    startPath: '/deadlock/analysis/recommendation-value-v8-full-evaluation/start',
    statusPath: '/deadlock/analysis/recommendation-value-v8-full-evaluation/status',
    body: compactObject({
      expectedDatasetSha256: datasetArtifactSha(datasetManifest),
      expectedBehavioralPropensitySha256: findArtifactSha(
        behavioralManifest,
        'propensities.ndjson',
      ),
      expectedBaselineSha256: findArtifactSha(
        baselineManifest,
        'predictions.ndjson',
      ),
    }),
  });

  assertTrue(status.releaseGatePassed, 'Full Value V8 release gate did not pass.');
  assertTrue(
    status.passiveShadowAuthorized,
    'Full Value V8 did not authorize passive shadow.',
  );
  assertEqual(
    status.randomizedCanaryAuthorized,
    false,
    'Full Value V8 unexpectedly authorized randomized canary.',
  );
  const manifest = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-full-evaluation/manifest',
  );
  const audit = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-full-evaluation/audit',
  );
  const evaluation = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-full-evaluation/evaluation',
  );
  assertTrue(audit.passed, 'Full Value V8 audit did not pass.');
  assertTrue(audit.releaseGatePassed, 'Full Value V8 audit release gate is false.');
  assertTrue(
    audit.passiveShadowAuthorized,
    'Full Value V8 audit did not authorize passive shadow.',
  );
  return { status, manifest, audit, evaluation };
}

async function startAndWait({ name, startPath, statusPath, body }) {
  console.log(`${name}: starting.`);
  await requestJson('POST', startPath, body);
  const deadline = Date.now() + config.pipelineTimeoutMs;
  let lastPhase;

  while (Date.now() < deadline) {
    const status = await requestJson('GET', statusPath);
    if (status.phase !== lastPhase) {
      console.log(`${name}: ${status.state}/${status.phase}.`);
      lastPhase = status.phase;
    }
    if (status.state === 'COMPLETE') {
      return status;
    }
    if (status.state === 'FAILED') {
      throw new Error(`${name} failed: ${status.error || 'unknown error'}`);
    }
    await sleep(config.pollIntervalMs);
  }

  throw new Error(`${name} exceeded PIPELINE_TIMEOUT_MS.`);
}

async function requestJson(method, path, body) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let value;
  try {
    value = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} returned invalid JSON: ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path} returned ${response.status}: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function datasetArtifactSha(manifest) {
  return readString(manifest, ['artifact', 'sha256'], 'Dataset V6 artifact SHA-256');
}

function findArtifactSha(value, expectedFileName) {
  const found = findArtifact(value, expectedFileName);
  if (!found || typeof found.sha256 !== 'string' || found.sha256.length === 0) {
    throw new Error(`Artifact ${expectedFileName} has no SHA-256 descriptor.`);
  }
  return found.sha256;
}

function findArtifact(value, expectedFileName) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (value.fileName === expectedFileName) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findArtifact(child, expectedFileName);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function readString(value, path, label) {
  let current = value;
  for (const key of path) {
    current = current?.[key];
  }
  if (typeof current !== 'string' || current.length === 0) {
    throw new Error(`${label} is missing.`);
  }
  return current;
}

function summarizeStatus(status) {
  return {
    state: status.state,
    phase: status.phase,
    sourceRowCount: status.sourceRowCount,
    outputRowCount: status.outputRowCount,
    predictionRowCount: status.predictionRowCount,
    releaseGatePassed: status.releaseGatePassed,
    passiveShadowAuthorized: status.passiveShadowAuthorized,
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function assertArray(value, message) {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }
}

function assertTrue(value, message) {
  if (value !== true) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${String(expected)}, received ${String(actual)}.`);
  }
}

function requiredString(name) {
  const value = optionalString(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function optionalString(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requiredInteger(name) {
  const value = optionalInteger(name);
  if (value === undefined) {
    throw new Error(`Missing required integer environment variable ${name}.`);
  }
  return value;
}

function optionalInteger(name, fallback) {
  const raw = optionalString(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
