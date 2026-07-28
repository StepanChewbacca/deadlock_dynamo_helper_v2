const config = loadConfig();

await runPipeline();

async function runPipeline() {
  const startedAt = new Date().toISOString();
  console.log(`Recommendation V8 pipeline started at ${startedAt}.`);

  const registry = await ensureCandidateSnapshot();
  const replay = await runHistoricalReplay();
  const dataset = await runDatasetV6(replay.manifest);
  const behavioral = await runBehavioralV5(dataset.manifest);
  const diagnostic = await runValueV8Diagnostic(
    dataset.manifest,
    behavioral.manifest,
  );
  const baseline = await runFrozenV6Baseline(dataset.manifest);
  const fullEvaluation = await runFullValueV8({
    datasetManifest: dataset.manifest,
    behavioralManifest: behavioral.manifest,
    baselineManifest: baseline.manifest,
  });
  const shadow = await get(
    '/deadlock/analysis/recommendation-value-v8/passive-shadow/status',
  );

  assertFalse(
    fullEvaluation.status.randomizedCanaryAuthorized,
    'Full Value V8 status authorized randomized canary.',
  );
  assertFalse(
    fullEvaluation.audit.randomizedCanaryAuthorized,
    'Full Value V8 audit authorized randomized canary.',
  );
  assertFalse(
    shadow.randomizedCanaryAuthorized,
    'Passive shadow status authorized randomized canary.',
  );

  console.log(
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        snapshotId: config.snapshotId,
        snapshotCount: registry.snapshots.length,
        replay: summarize(replay.status),
        datasetV6: summarize(dataset.status),
        behavioralV5: summarize(behavioral.status),
        valueV8Diagnostic: summarize(diagnostic.status),
        frozenV6Baseline: summarize(baseline.status),
        fullValueV8: summarize(fullEvaluation.status),
        releaseGatePassed: true,
        passiveShadowAuthorized: true,
        passiveShadowActivatedByRunner: false,
        randomizedCanaryAuthorized: false,
      },
      null,
      2,
    ),
  );
}

async function ensureCandidateSnapshot() {
  const registryPath =
    '/deadlock/analysis/recommendation-candidate-generator-snapshots/registry';
  let registry = await get(registryPath);
  assertSnapshots(registry);

  if (registry.snapshots.some((entry) => entry.snapshotId === config.snapshotId)) {
    console.log(`Candidate snapshot ${config.snapshotId} already exists.`);
    return registry;
  }

  await runStage({
    name: 'Candidate snapshot',
    startPath:
      '/deadlock/analysis/recommendation-candidate-generator-snapshots/start',
    statusPath:
      '/deadlock/analysis/recommendation-candidate-generator-snapshots/status',
    body: compact({
      snapshotId: config.snapshotId,
      generatorVersion: config.generatorVersion,
      policyVersion: config.policyVersion,
      catalogVersionId: config.catalogVersionId,
      trainingWindowStart: config.trainingWindowStart,
      trainingWindowEnd: config.trainingWindowEnd,
      expectedSourceSha256: config.expectedSnapshotSourceSha256,
    }),
  });

  registry = await get(registryPath);
  assertSnapshots(registry);
  assertTrue(
    registry.snapshots.some((entry) => entry.snapshotId === config.snapshotId),
    `Candidate snapshot ${config.snapshotId} is missing after export.`,
  );
  return registry;
}

async function runHistoricalReplay() {
  const status = await runStage({
    name: 'Historical replay',
    startPath: '/deadlock/analysis/recommendation-historical-pro-replay/start',
    statusPath: '/deadlock/analysis/recommendation-historical-pro-replay/status',
    body: compact({
      partitionCount: config.replayPartitionCount,
      snapshotStalenessS: config.replaySnapshotStalenessS,
      resume: true,
    }),
  });
  assertTrue(status.auditPassed, 'Historical replay audit failed.');

  const manifest = await get(
    '/deadlock/analysis/recommendation-historical-pro-replay/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-historical-pro-replay/audit',
  );
  assertTrue(manifest.auditPassed, 'Historical replay manifest audit flag is false.');
  assertTrue(
    manifest.trainingArtifactEligible,
    'Historical replay manifest is not training eligible.',
  );
  assertTrue(audit.passed, 'Historical replay structural audit failed.');
  assertTrue(
    audit.trainingArtifactEligible,
    'Historical replay audit is not training eligible.',
  );
  assertFalse(
    manifest.featureContract.userLiveUsedAsInput,
    'Historical replay used USER_LIVE input.',
  );
  assertFalse(
    manifest.featureContract.observedActionInjectedIntoCandidates,
    'Historical replay injected the observed action into candidates.',
  );
  return { status, manifest, audit };
}

async function runDatasetV6(replayManifest) {
  const status = await runStage({
    name: 'Dataset V6',
    startPath: '/deadlock/analysis/recommendation-pro-decision-dataset-v6/start',
    statusPath: '/deadlock/analysis/recommendation-pro-decision-dataset-v6/status',
    body: compact({
      tuningStart: config.tuningStart,
      futureTestStart: config.futureTestStart,
      expectedReplaySha256: requiredPath(
        replayManifest,
        ['artifact', 'sha256'],
        'Historical replay SHA-256',
      ),
      expectedSnapshotRegistrySha256: requiredPath(
        replayManifest,
        ['candidateGeneratorSnapshots', 'registrySha256'],
        'Snapshot registry SHA-256',
      ),
      decisionSnapshotStalenessS: config.datasetSnapshotStalenessS,
    }),
  });
  assertTrue(status.auditPassed, 'Dataset V6 audit failed.');
  assertTrue(status.trainingArtifactEligible, 'Dataset V6 is not training eligible.');

  const manifest = await get(
    '/deadlock/analysis/recommendation-pro-decision-dataset-v6/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-pro-decision-dataset-v6/audit',
  );
  assertTrue(manifest.auditPassed, 'Dataset V6 manifest audit flag is false.');
  assertTrue(
    manifest.trainingArtifactEligible,
    'Dataset V6 manifest is not training eligible.',
  );
  assertTrue(audit.passed, 'Dataset V6 structural audit failed.');
  assertTrue(
    audit.trainingArtifactEligible,
    'Dataset V6 audit is not training eligible.',
  );
  assertFalse(
    manifest.featureContract.userLiveUsedAsInput,
    'Dataset V6 used USER_LIVE input.',
  );
  assertFalse(
    manifest.featureContract.futureTestEligibleForSelection,
    'Dataset V6 made FUTURE_TEST eligible for selection.',
  );
  return { status, manifest, audit };
}

async function runBehavioralV5(datasetManifest) {
  const status = await runStage({
    name: 'Behavioral V5',
    startPath: '/deadlock/analysis/recommendation-behavioral-v5-training/start',
    statusPath: '/deadlock/analysis/recommendation-behavioral-v5-training/status',
    body: {
      expectedSourceSha256: datasetSha(datasetManifest),
    },
  });
  assertTrue(status.releaseGatePassed, 'Behavioral V5 release gate failed.');
  assertTrue(
    status.trainingArtifactEligible,
    'Behavioral V5 artifact is not training eligible.',
  );

  const manifest = await get(
    '/deadlock/analysis/recommendation-behavioral-v5-training/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-behavioral-v5-training/audit',
  );
  const evaluation = await get(
    '/deadlock/analysis/recommendation-behavioral-v5-training/evaluation',
  );
  assertTrue(audit.passed, 'Behavioral V5 audit failed.');
  assertTrue(
    audit.trainingArtifactEligible,
    'Behavioral V5 audit is not training eligible.',
  );
  return { status, manifest, audit, evaluation };
}

async function runValueV8Diagnostic(datasetManifest, behavioralManifest) {
  const status = await runStage({
    name: 'Value V8 diagnostic',
    startPath: '/deadlock/analysis/recommendation-value-v8-diagnostic/start',
    statusPath: '/deadlock/analysis/recommendation-value-v8-diagnostic/status',
    body: {
      maxRows: config.diagnosticMaxRows,
      expectedDatasetSha256: datasetSha(datasetManifest),
      expectedBehavioralPropensitySha256: artifactSha(
        behavioralManifest,
        'propensities.ndjson',
      ),
    },
  });
  assertTrue(status.diagnosticGatePassed, 'Value V8 diagnostic gate failed.');
  assertTrue(
    status.fullTrainingRecommended,
    'Value V8 diagnostic did not recommend full training.',
  );

  const manifest = await get(
    '/deadlock/analysis/recommendation-value-v8-diagnostic/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-value-v8-diagnostic/audit',
  );
  const evaluation = await get(
    '/deadlock/analysis/recommendation-value-v8-diagnostic/evaluation',
  );
  assertTrue(audit.passed, 'Value V8 diagnostic audit failed.');
  assertTrue(
    audit.diagnosticArtifactEligible,
    'Value V8 diagnostic artifact is not eligible.',
  );
  assertTrue(
    audit.fullTrainingRecommended,
    'Value V8 diagnostic audit did not recommend full training.',
  );
  assertFalse(
    audit.leakage.futureTestUsedForTraining,
    'Value V8 diagnostic used FUTURE_TEST for training.',
  );
  assertFalse(
    audit.leakage.futureTestUsedForSelection,
    'Value V8 diagnostic used FUTURE_TEST for selection.',
  );
  assertFalse(manifest.futureTestUsed, 'Value V8 diagnostic manifest used FUTURE_TEST.');
  assertFalse(
    evaluation.futureTest.evaluated,
    'Value V8 diagnostic evaluated FUTURE_TEST.',
  );
  return { status, manifest, audit, evaluation };
}

async function runFrozenV6Baseline(datasetManifest) {
  const status = await runStage({
    name: 'Frozen V6 baseline',
    startPath:
      '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/start',
    statusPath:
      '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/status',
    body: compact({
      expectedDatasetSha256: datasetSha(datasetManifest),
      expectedModelSha256: config.expectedV6ModelSha256,
    }),
  });

  const manifest = await get(
    '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-v6-short-only-dataset-v6-baseline/audit',
  );
  assertTrue(audit.passed, 'Frozen V6 baseline audit failed.');
  assertFalse(audit.trainingPerformed, 'Frozen V6 baseline performed training.');
  assertTrue(audit.frozen, 'V6 baseline is not marked frozen.');
  return { status, manifest, audit };
}

async function runFullValueV8({
  datasetManifest,
  behavioralManifest,
  baselineManifest,
}) {
  const status = await runStage({
    name: 'Full Value V8',
    startPath: '/deadlock/analysis/recommendation-value-v8-full-evaluation/start',
    statusPath: '/deadlock/analysis/recommendation-value-v8-full-evaluation/status',
    body: {
      expectedDatasetSha256: datasetSha(datasetManifest),
      expectedBehavioralPropensitySha256: artifactSha(
        behavioralManifest,
        'propensities.ndjson',
      ),
      expectedBaselineSha256: artifactSha(
        baselineManifest,
        'predictions.ndjson',
      ),
    },
  });
  assertTrue(status.releaseGatePassed, 'Full Value V8 release gate failed.');
  assertTrue(
    status.passiveShadowAuthorized,
    'Full Value V8 did not authorize passive shadow.',
  );
  assertFalse(
    status.randomizedCanaryAuthorized,
    'Full Value V8 authorized randomized canary.',
  );

  const manifest = await get(
    '/deadlock/analysis/recommendation-value-v8-full-evaluation/manifest',
  );
  const audit = await get(
    '/deadlock/analysis/recommendation-value-v8-full-evaluation/audit',
  );
  const evaluation = await get(
    '/deadlock/analysis/recommendation-value-v8-full-evaluation/evaluation',
  );
  assertTrue(audit.passed, 'Full Value V8 audit failed.');
  assertTrue(audit.releaseGatePassed, 'Full Value V8 audit release gate failed.');
  assertTrue(
    audit.passiveShadowAuthorized,
    'Full Value V8 audit did not authorize passive shadow.',
  );
  assertFalse(
    audit.randomizedCanaryAuthorized,
    'Full Value V8 audit authorized randomized canary.',
  );
  assertTrue(manifest.releaseGatePassed, 'Full Value V8 manifest gate failed.');
  assertTrue(
    manifest.passiveShadowAuthorized,
    'Full Value V8 manifest did not authorize passive shadow.',
  );
  assertFalse(
    manifest.randomizedCanaryAuthorized,
    'Full Value V8 manifest authorized randomized canary.',
  );
  return { status, manifest, audit, evaluation };
}

async function runStage({ name, startPath, statusPath, body }) {
  console.log(`${name}: starting.`);
  await post(startPath, body);
  const deadline = Date.now() + config.pipelineTimeoutMs;
  let previousPhase;

  while (Date.now() < deadline) {
    const status = await get(statusPath);
    if (status.phase !== previousPhase) {
      console.log(`${name}: ${status.state}/${status.phase}.`);
      previousPhase = status.phase;
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

function loadConfig() {
  return {
    apiBaseUrl: requiredString('API_BASE_URL').replace(/\/+$/, ''),
    snapshotId: requiredString('SNAPSHOT_ID'),
    generatorVersion: requiredString('CANDIDATE_GENERATOR_VERSION'),
    policyVersion: requiredString('CANDIDATE_POLICY_VERSION'),
    catalogVersionId: requiredInteger('CATALOG_VERSION_ID'),
    trainingWindowStart: requiredString('TRAINING_WINDOW_START'),
    trainingWindowEnd: requiredString('TRAINING_WINDOW_END'),
    tuningStart: requiredString('TUNING_START'),
    futureTestStart: requiredString('FUTURE_TEST_START'),
    diagnosticMaxRows: optionalInteger('DIAGNOSTIC_MAX_ROWS', 10000),
    pollIntervalMs: optionalInteger('PIPELINE_POLL_INTERVAL_MS', 5000),
    pipelineTimeoutMs: optionalInteger(
      'PIPELINE_TIMEOUT_MS',
      24 * 60 * 60 * 1000,
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
}

async function get(path) {
  return request('GET', path);
}

async function post(path, body) {
  return request('POST', path, body);
}

async function request(method, path, body) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${method} ${path} returned invalid JSON.`);
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${path} returned ${response.status}: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function datasetSha(manifest) {
  return requiredPath(manifest, ['artifact', 'sha256'], 'Dataset V6 SHA-256');
}

function artifactSha(value, fileName) {
  const descriptor = findArtifact(value, fileName);
  if (!descriptor || typeof descriptor.sha256 !== 'string') {
    throw new Error(`Artifact descriptor for ${fileName} is missing.`);
  }
  return descriptor.sha256;
}

function findArtifact(value, fileName) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (value.fileName === fileName) {
    return value;
  }
  for (const child of Object.values(value)) {
    const found = findArtifact(child, fileName);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function requiredPath(value, path, label) {
  let current = value;
  for (const key of path) {
    current = current?.[key];
  }
  if (typeof current !== 'string' || current.length === 0) {
    throw new Error(`${label} is missing.`);
  }
  return current;
}

function summarize(status) {
  return compact({
    state: status.state,
    phase: status.phase,
    sourceRowCount: status.sourceRowCount,
    outputRowCount: status.outputRowCount,
    predictionRowCount: status.predictionRowCount,
    trainDecisionCount: status.trainDecisionCount,
    tuningDecisionCount: status.tuningDecisionCount,
    futureTestDecisionCount: status.futureTestDecisionCount,
    releaseGatePassed: status.releaseGatePassed,
    passiveShadowAuthorized: status.passiveShadowAuthorized,
  });
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function assertSnapshots(registry) {
  if (!Array.isArray(registry.snapshots)) {
    throw new Error('Candidate snapshot registry has no snapshots array.');
  }
}

function assertTrue(value, message) {
  if (value !== true) {
    throw new Error(message);
  }
}

function assertFalse(value, message) {
  if (value !== false) {
    throw new Error(message);
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
