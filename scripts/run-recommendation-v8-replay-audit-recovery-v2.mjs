import { spawn } from 'node:child_process';
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const LOG_PATH = process.env.TRAINING_LOG_PATH || '/runner/training.log';
const STATUS_PATH = process.env.TRAINING_STATUS_PATH || '/runner/status.json';
const RESOLVED_CONFIG_PATH =
  process.env.TRAINING_RESOLVED_CONFIG_PATH ||
  '/runner/resolved-training-config.json';
const DIAGNOSTIC_PIPELINE_SCRIPT =
  process.env.TRAINING_DIAGNOSTIC_PIPELINE_SCRIPT ||
  '/app/scripts/run-recommendation-v8-diagnostic-only-pipeline.mjs';
const FULL_PIPELINE_SCRIPT =
  process.env.TRAINING_FULL_PIPELINE_SCRIPT ||
  '/app/scripts/run-recommendation-v8-pipeline.mjs';
const PIPELINE_TIMEOUT_MS = positiveInteger(
  process.env.PIPELINE_TIMEOUT_MS,
  7 * 24 * 60 * 60 * 1000,
);
const SNAPSHOT_SUFFIX = 'support-v2';

await main().catch(async (error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  await log(`AUDIT RECOVERY FAILED: ${message}`);
  await writeStatus('FAILED', 'AUDIT_RECOVERY', { error: message });
  process.exitCode = 1;
});

async function main() {
  const originalConfig = JSON.parse(
    await readFile(RESOLVED_CONFIG_PATH, 'utf8'),
  );
  validateResolvedConfig(originalConfig);
  const snapshotId = originalConfig.snapshotId.endsWith(`-${SNAPSHOT_SUFFIX}`)
    ? originalConfig.snapshotId
    : `${originalConfig.snapshotId}-${SNAPSHOT_SUFFIX}`;
  const resolvedConfig = {
    ...originalConfig,
    previousSnapshotId: originalConfig.snapshotId,
    snapshotId,
    replayRecovery: {
      version: 'RECOMMENDATION_V8_REPLAY_AUDIT_RECOVERY_V2',
      candidateSupportStrategy:
        'STATE_PRIMARY_PLUS_HERO_SUPPORT_UNION_V2',
      partitionStrategy: 'MATCH_ID_HASH_V3',
      timelineJoinContract:
        'DECISION_JOIN_SEPARATE_FROM_HORIZON_COMPLETENESS_V2',
      snapshotStalenessS: 300,
      productionRankingChanged: false,
      passiveShadowActivated: false,
      randomizedCanaryAuthorized: false,
    },
  };
  await atomicJson(RESOLVED_CONFIG_PATH, resolvedConfig);
  await log(
    `Starting Recommendation V8 replay audit recovery with config: ${JSON.stringify(
      resolvedConfig,
    )}`,
  );

  const environment = pipelineEnvironment(resolvedConfig);

  await writeStatus('RUNNING', 'DIAGNOSTIC_PIPELINE', { resolvedConfig });
  const diagnosticExitCode = await runChild(
    DIAGNOSTIC_PIPELINE_SCRIPT,
    environment,
    'diagnostic',
  );
  if (diagnosticExitCode !== 0) {
    throw new Error(
      `Recommendation V8 diagnostic pipeline exited with code ${diagnosticExitCode}.`,
    );
  }

  const diagnosticStatus = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-diagnostic/status',
  );
  if (
    diagnosticStatus.diagnosticGatePassed !== true ||
    diagnosticStatus.fullTrainingRecommended !== true
  ) {
    await writeStatus('DIAGNOSTIC_REJECTED', 'DIAGNOSTIC_GATE', {
      resolvedConfig,
      diagnosticStatus,
      fullTrainingStarted: false,
    });
    await log(
      `Diagnostic gate stopped full training: ${JSON.stringify(
        diagnosticStatus,
      )}`,
    );
    return;
  }

  if (resolvedConfig.catalog?.releaseEligible !== true) {
    await writeStatus(
      'DIAGNOSTIC_COMPLETE',
      'NON_RELEASE_CATALOG_GATE',
      {
        resolvedConfig,
        diagnosticStatus,
        fullTrainingStarted: false,
        releaseEligible: false,
        releaseBlockReason:
          'Historical catalog lineage is not temporally validated.',
      },
    );
    await log(
      'Diagnostic passed, but full training was blocked because historical ' +
        'catalog lineage is not release eligible.',
    );
    return;
  }

  await writeStatus('RUNNING', 'FULL_OFFLINE_PIPELINE', {
    resolvedConfig,
    diagnosticStatus,
  });
  const fullExitCode = await runChild(
    FULL_PIPELINE_SCRIPT,
    environment,
    'full',
  );
  if (fullExitCode !== 0) {
    throw new Error(
      `Recommendation V8 full pipeline exited with code ${fullExitCode}.`,
    );
  }

  const fullStatus = await requestJson(
    'GET',
    '/deadlock/analysis/recommendation-value-v8-full-evaluation/status',
  );
  await writeStatus('COMPLETE', 'FULL_OFFLINE_COMPLETE', {
    resolvedConfig,
    diagnosticStatus,
    fullStatus,
    productionRankingChanged: false,
    passiveShadowActivated: false,
    randomizedCanaryAuthorized: false,
  });
  await log('Recommendation V8 replay recovery and full offline pipeline completed.');
}

function pipelineEnvironment(resolvedConfig) {
  return {
    ...process.env,
    API_BASE_URL,
    SNAPSHOT_ID: resolvedConfig.snapshotId,
    CANDIDATE_GENERATOR_VERSION:
      'RECOMMENDATION_CANDIDATE_GENERATOR_V6_2_SUPPORT_UNION',
    CANDIDATE_POLICY_VERSION:
      'RECOMMENDATION_CANDIDATE_POLICY_V6_2_SUPPORT_UNION',
    CATALOG_VERSION_ID: String(resolvedConfig.catalog.id),
    TRAINING_WINDOW_START: resolvedConfig.chronology.trainingWindowStart,
    TRAINING_WINDOW_END: resolvedConfig.chronology.trainingWindowEnd,
    TUNING_START: resolvedConfig.chronology.tuningStart,
    FUTURE_TEST_START: resolvedConfig.chronology.futureTestStart,
    EXPECTED_SNAPSHOT_SOURCE_SHA256: resolvedConfig.source.sha256,
    REPLAY_PARTITION_COUNT: process.env.REPLAY_PARTITION_COUNT || '64',
    REPLAY_SNAPSHOT_STALENESS_S:
      process.env.REPLAY_SNAPSHOT_STALENESS_S || '300',
    DATASET_DECISION_SNAPSHOT_STALENESS_S:
      process.env.DATASET_DECISION_SNAPSHOT_STALENESS_S || '300',
    DIAGNOSTIC_MAX_ROWS: process.env.DIAGNOSTIC_MAX_ROWS || '10000',
    PIPELINE_POLL_INTERVAL_MS:
      process.env.PIPELINE_POLL_INTERVAL_MS || '15000',
    PIPELINE_TIMEOUT_MS: String(PIPELINE_TIMEOUT_MS),
    PIPELINE_REQUEST_TIMEOUT_MS:
      process.env.PIPELINE_REQUEST_TIMEOUT_MS || '30000',
    PIPELINE_REQUEST_RETRY_COUNT:
      process.env.PIPELINE_REQUEST_RETRY_COUNT || '240',
    PIPELINE_REQUEST_RETRY_DELAY_MS:
      process.env.PIPELINE_REQUEST_RETRY_DELAY_MS || '5000',
  };
}

async function runChild(script, environment, label) {
  await log(`Starting ${label} pipeline from ${script}.`);
  const child = spawn('node', [script], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) =>
    void log(`[pipeline:${label}] ${String(chunk).trimEnd()}`),
  );
  child.stderr.on('data', (chunk) =>
    void log(`[pipeline:${label}:stderr] ${String(chunk).trimEnd()}`),
  );
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(
        new Error(
          `Recommendation V8 ${label} pipeline exceeded ${PIPELINE_TIMEOUT_MS} ms.`,
        ),
      );
    }, PIPELINE_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });
}

function validateResolvedConfig(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.snapshotId !== 'string' ||
    typeof value.source?.sha256 !== 'string' ||
    !Number.isSafeInteger(Number(value.catalog?.id)) ||
    typeof value.chronology?.trainingWindowStart !== 'string' ||
    typeof value.chronology?.trainingWindowEnd !== 'string' ||
    typeof value.chronology?.tuningStart !== 'string' ||
    typeof value.chronology?.futureTestStart !== 'string'
  ) {
    throw new Error('Resolved training config is invalid.');
  }
}

async function requestJson(method, path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
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

async function writeStatus(state, stage, extra = {}) {
  await atomicJson(STATUS_PATH, {
    schemaVersion: 4,
    runId: process.env.TRAINING_RUN_ID,
    state,
    stage,
    updatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    logPath: LOG_PATH,
    productionRankingChanged: false,
    passiveShadowActivated: false,
    randomizedCanaryAuthorized: false,
    ...extra,
  });
}

async function atomicJson(path, value) {
  const partial = `${path}.partial`;
  await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(partial, path);
}

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  await appendFile(LOG_PATH, line, 'utf8');
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
