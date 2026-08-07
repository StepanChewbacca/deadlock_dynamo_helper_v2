import { spawn } from 'node:child_process';
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const LOG_PATH = process.env.TRAINING_LOG_PATH || '/runner/training.log';
const STATUS_PATH = process.env.TRAINING_STATUS_PATH || '/runner/status.json';
const RESOLVED_CONFIG_PATH =
  process.env.TRAINING_RESOLVED_CONFIG_PATH || '/runner/resolved-training-config.json';
const PIPELINE_SCRIPT =
  process.env.TRAINING_PIPELINE_SCRIPT ||
  '/runner/run-recommendation-v8-diagnostic-only-pipeline.mjs';
const PIPELINE_TIMEOUT_MS = positiveInteger(
  process.env.PIPELINE_TIMEOUT_MS,
  48 * 60 * 60 * 1000,
);

await main().catch(async (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await log(`RESUME FAILED: ${message}`);
  await writeStatus('FAILED', 'OFFLINE_V8_DIAGNOSTIC_PIPELINE_RESUME', {
    error: message,
  });
  process.exitCode = 1;
});

async function main() {
  const resolvedConfig = JSON.parse(await readFile(RESOLVED_CONFIG_PATH, 'utf8'));
  validateResolvedConfig(resolvedConfig);
  await log('Resuming Recommendation V8 diagnostic-only pipeline without rebuilding Dataset V3.');
  await writeStatus('RUNNING', 'OFFLINE_V8_DIAGNOSTIC_PIPELINE_RESUME', {
    resolvedConfig,
    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
    releaseEligible: false,
    offlineReleaseGateAccepted: false,
  });

  const child = spawn('node', [PIPELINE_SCRIPT], {
    env: {
      ...process.env,
      API_BASE_URL,
      SNAPSHOT_ID: resolvedConfig.snapshotId,
      CANDIDATE_GENERATOR_VERSION: 'RECOMMENDATION_CANDIDATE_GENERATOR_V6_1',
      CANDIDATE_POLICY_VERSION: 'RECOMMENDATION_CANDIDATE_POLICY_V6_1',
      CATALOG_VERSION_ID: String(resolvedConfig.catalog.id),
      TRAINING_WINDOW_START: resolvedConfig.chronology.trainingWindowStart,
      TRAINING_WINDOW_END: resolvedConfig.chronology.trainingWindowEnd,
      TUNING_START: resolvedConfig.chronology.tuningStart,
      FUTURE_TEST_START: resolvedConfig.chronology.futureTestStart,
      EXPECTED_SNAPSHOT_SOURCE_SHA256: resolvedConfig.source.sha256,
      DIAGNOSTIC_MAX_ROWS: process.env.DIAGNOSTIC_MAX_ROWS || '10000',
      PIPELINE_POLL_INTERVAL_MS: process.env.PIPELINE_POLL_INTERVAL_MS || '15000',
      PIPELINE_TIMEOUT_MS: String(PIPELINE_TIMEOUT_MS),
      PIPELINE_REQUEST_TIMEOUT_MS:
        process.env.PIPELINE_REQUEST_TIMEOUT_MS || '30000',
      PIPELINE_REQUEST_RETRY_COUNT:
        process.env.PIPELINE_REQUEST_RETRY_COUNT || '240',
      PIPELINE_REQUEST_RETRY_DELAY_MS:
        process.env.PIPELINE_REQUEST_RETRY_DELAY_MS || '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) =>
    void log(`[pipeline:resume] ${String(chunk).trimEnd()}`),
  );
  child.stderr.on('data', (chunk) =>
    void log(`[pipeline:resume:stderr] ${String(chunk).trimEnd()}`),
  );

  const exitCode = await waitForChild(child);
  if (exitCode !== 0) {
    throw new Error(`Recommendation V8 resumed pipeline exited with code ${exitCode}.`);
  }

  await writeStatus('DIAGNOSTIC_COMPLETE', 'DIAGNOSTIC_NON_RELEASE_COMPLETE', {
    resolvedConfig,
    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
    releaseEligible: false,
    offlineReleaseGateAccepted: false,
  });
  await log('Recommendation V8 resumed diagnostic-only pipeline completed.');
}

async function waitForChild(child) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Recommendation V8 pipeline exceeded ${PIPELINE_TIMEOUT_MS} ms.`));
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

async function writeStatus(state, stage, extra = {}) {
  await atomicJson(STATUS_PATH, {
    schemaVersion: 2,
    runId: process.env.TRAINING_RUN_ID,
    state,
    stage,
    updatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    logPath: LOG_PATH,
    productionRankingChanged: false,
    passiveShadowAuthorized: false,
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
