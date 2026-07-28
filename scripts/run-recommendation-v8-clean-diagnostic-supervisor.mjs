import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3000';
const LOG_PATH = process.env.TRAINING_LOG_PATH || '/runner/training.log';
const STATUS_PATH = process.env.TRAINING_STATUS_PATH || '/runner/status.json';
const PIPELINE_SCRIPT = process.env.TRAINING_PIPELINE_SCRIPT || '/runner/run-recommendation-v8-diagnostic-only-pipeline.mjs';
const SOURCE_DATASET_PATH = '/app/apps/api/storage/build-decision-dataset-v3/dataset.ndjson';
const SOURCE_MANIFEST_PATH = '/app/apps/api/storage/build-decision-dataset-v3/manifest.json';
const POLL_INTERVAL_MS = positiveInteger(process.env.TRAINING_POLL_INTERVAL_MS, 15000);
const SOURCE_TIMEOUT_MS = positiveInteger(process.env.SOURCE_DATASET_TIMEOUT_MS, 12 * 60 * 60 * 1000);
const PIPELINE_TIMEOUT_MS = positiveInteger(process.env.PIPELINE_TIMEOUT_MS, 48 * 60 * 60 * 1000);
const MINIMUM_SOURCE_MATCH_COUNT = positiveInteger(process.env.MINIMUM_SOURCE_MATCH_COUNT, 25000);
const require = createRequire('/app/package.json');
const { Client } = require('pg');

let currentStage = 'STARTING';

await main().catch(async (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await log(`FAILED: ${message}`);
  await writeStatus('FAILED', currentStage, { error: message });
  process.exitCode = 1;
});

async function main() {
  await writeStatus('RUNNING', currentStage);
  await log(`Recommendation V8 detached training supervisor started at ${new Date().toISOString()}.`);
  await waitForApi();

  currentStage = 'SOURCE_DATASET_V3';
  await writeStatus('RUNNING', currentStage);
  const source = await rebuildSourceDataset();

  currentStage = 'DERIVING_CHRONOLOGICAL_SPLITS';
  await writeStatus('RUNNING', currentStage);
  const chronology = await deriveChronology(SOURCE_DATASET_PATH);
  if (chronology.decisionRowCount !== source.manifest.artifact.rowCount) {
    throw new Error(
      `Physical Dataset V3 row count ${chronology.decisionRowCount} does not match ` +
        `manifest row count ${source.manifest.artifact.rowCount}.`,
    );
  }
  if (chronology.matchCount < MINIMUM_SOURCE_MATCH_COUNT) {
    throw new Error(
      `Source corpus has ${chronology.matchCount} matches; expected at least ${MINIMUM_SOURCE_MATCH_COUNT}.`,
    );
  }

  currentStage = 'RESOLVING_CURRENT_CATALOG_FALLBACK';
  await writeStatus('RUNNING', currentStage, {
    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
    releaseEligible: false,
  });
  const catalog = await resolveCurrentCatalogFallback();
  const snapshotId = buildSnapshotId(chronology.trainingWindowEnd, catalog.id, source.manifest.artifact.sha256);

  const resolvedConfig = {
    source: {
      matchCount: chronology.matchCount,
      decisionRowCount: source.manifest.artifact.rowCount,
      sha256: source.manifest.artifact.sha256,
      selectedWindowStartTime: source.manifest.source.selectedWindowStartTime,
      selectedWindowEndTime: source.manifest.source.selectedWindowEndTime,
    },
    chronology,
    catalog,
    snapshotId,
  };
  await atomicJson('/runner/resolved-training-config.json', resolvedConfig);
  await log(`Resolved training config: ${JSON.stringify(resolvedConfig)}`);

  currentStage = 'OFFLINE_V8_DIAGNOSTIC_PIPELINE';
  await writeStatus('RUNNING', currentStage, {
    resolvedConfig,
    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
    releaseEligible: false,
    productionRankingChanged: false,
    passiveShadowActivated: false,
    randomizedCanaryAuthorized: false,
  });
  const exitCode = await runPipeline({ source, chronology, catalog, snapshotId });
  if (exitCode !== 0) {
    throw new Error(`Recommendation V8 pipeline exited with code ${exitCode}.`);
  }

  currentStage = 'DIAGNOSTIC_NON_RELEASE_COMPLETE';
  await writeStatus('DIAGNOSTIC_COMPLETE', currentStage, {
    resolvedConfig,
    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
    releaseEligible: false,
    offlineReleaseGateAccepted: false,
    productionRankingChanged: false,
    passiveShadowActivated: false,
    randomizedCanaryAuthorized: false,
  });
  await log(`Recommendation V8 detached training completed at ${new Date().toISOString()}.`);
}

async function waitForApi() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_BASE_URL}/deadlock/analysis/build-decision-dataset-v3/status`);
      if (response.ok) {
        await log('Training API is ready.');
        return;
      }
    } catch {
      // Retry until the deadline.
    }
    await sleep(2000);
  }
  throw new Error('Training API did not become ready within 120 seconds.');
}

async function rebuildSourceDataset() {
  await log('Starting a fresh full PostgreSQL-backed Contextual V3 decision dataset extraction.');
  const startResponse = await requestJson(
    'POST',
    '/deadlock/analysis/build-decision-dataset-v3/start',
    {
      maxMatches: 1000000,
      batchSize: 500,
      includeSellActions: false,
    },
  );
  await log(`Source dataset start response: ${JSON.stringify(startResponse)}`);

  const status = await waitForTerminalStatus(
    '/deadlock/analysis/build-decision-dataset-v3/status',
    SOURCE_TIMEOUT_MS,
    'Contextual V3 decision dataset',
  );
  if (status.state !== 'COMPLETE') {
    throw new Error(`Source dataset failed: ${status.error || JSON.stringify(status)}`);
  }

  const manifest = await requestJson('GET', '/deadlock/analysis/build-decision-dataset-v3/manifest');
  const audit = await requestJson('GET', '/deadlock/analysis/build-decision-dataset-v3/audit');
  if (manifest.auditPassed !== true || audit.passed !== true) {
    throw new Error('Source Dataset V3 audit did not pass.');
  }
  if (manifest.options?.maxMatches !== 1000000) {
    throw new Error('Source Dataset V3 was not built with the requested full-corpus limit.');
  }
  if (!manifest.artifact?.sha256 || !manifest.artifact?.rowCount) {
    throw new Error('Source Dataset V3 manifest is missing artifact lineage.');
  }
  await log(
    `Source Dataset V3 complete: ${manifest.source.selectedMatchCount} matches and ${manifest.artifact.rowCount} decisions.`,
  );
  return { status, manifest, audit };
}

async function deriveChronology(datasetPath) {
  const matches = new Map();
  let decisionRowCount = 0;
  const input = createReadStream(datasetPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    decisionRowCount += 1;
    const matchId = String(row.matchId);
    const matchStartTime = String(row.matchStartTime);
    const previous = matches.get(matchId);
    if (previous && previous !== matchStartTime) {
      throw new Error(`Match ${matchId} has inconsistent start times.`);
    }
    matches.set(matchId, matchStartTime);
  }

  const ordered = [...matches.entries()]
    .map(([matchId, matchStartTime]) => ({ matchId, matchStartTime }))
    .sort((left, right) =>
      left.matchStartTime.localeCompare(right.matchStartTime) || left.matchId.localeCompare(right.matchId),
    );
  if (ordered.length < 100) {
    throw new Error(`Chronological split requires at least 100 matches; found ${ordered.length}.`);
  }

  const trainingEndIndex = quantileIndex(ordered.length, 0.6);
  const tuningStartIndex = quantileIndex(ordered.length, 0.8);
  const futureTestStartIndex = quantileIndex(ordered.length, 0.9);
  const trainingWindowStart = ordered[0].matchStartTime;
  const trainingWindowEnd = ordered[trainingEndIndex].matchStartTime;
  const tuningStart = ordered[tuningStartIndex].matchStartTime;
  const futureTestStart = ordered[futureTestStartIndex].matchStartTime;
  if (!(trainingWindowStart < trainingWindowEnd && trainingWindowEnd < tuningStart && tuningStart < futureTestStart)) {
    throw new Error('Derived chronological boundaries are not strictly ordered.');
  }

  const result = {
    matchCount: ordered.length,
    decisionRowCount,
    trainingWindowStart,
    trainingWindowEnd,
    tuningStart,
    futureTestStart,
    sourceWindowEnd: ordered.at(-1).matchStartTime,
    policyTrainingMatchCount: trainingEndIndex + 1,
    valueTrainApproximateMatchCount: tuningStartIndex - trainingEndIndex,
    tuningApproximateMatchCount: futureTestStartIndex - tuningStartIndex,
    futureTestApproximateMatchCount: ordered.length - futureTestStartIndex,
    splitRule: '60_PERCENT_POLICY_20_PERCENT_VALUE_TRAIN_10_PERCENT_TUNING_10_PERCENT_FUTURE_TEST',
  };
  await log(`Derived chronology: ${JSON.stringify(result)}`);
  return result;
}

async function resolveCurrentCatalogFallback() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, "clientVersion", "contentCatalogVersionId", "importedAt", "isCurrent"
       FROM item_catalog_versions
       ORDER BY "isCurrent" DESC, "importedAt" DESC, id DESC
       LIMIT 1`,
    );
    if (result.rows.length !== 1) {
      throw new Error('No item catalog is available for the diagnostic fallback.');
    }
    const row = result.rows[0];
    return {
      id: Number(row.id),
      clientVersion: String(row.clientVersion),
      contentCatalogVersionId:
        row.contentCatalogVersionId === null ? undefined : Number(row.contentCatalogVersionId),
      importedAt: new Date(row.importedAt).toISOString(),
      isCurrent: row.isCurrent === true,
      selectionRule: 'CURRENT_CATALOG_FALLBACK_NON_RELEASE',
      temporalValidationPassed: false,
      temporalCatalogLeakageRisk: true,
      releaseEligible: false,
    };
  } finally {
    await client.end();
  }
}

async function runPipeline({ source, chronology, catalog, snapshotId }) {
  const child = spawn('node', [PIPELINE_SCRIPT], {
    env: {
      ...process.env,
      API_BASE_URL,
      SNAPSHOT_ID: snapshotId,
      CANDIDATE_GENERATOR_VERSION: 'RECOMMENDATION_CANDIDATE_GENERATOR_V6_1',
      CANDIDATE_POLICY_VERSION: 'RECOMMENDATION_CANDIDATE_POLICY_V6_1',
      CATALOG_VERSION_ID: String(catalog.id),
      TRAINING_WINDOW_START: chronology.trainingWindowStart,
      TRAINING_WINDOW_END: chronology.trainingWindowEnd,
      TUNING_START: chronology.tuningStart,
      FUTURE_TEST_START: chronology.futureTestStart,
      EXPECTED_SNAPSHOT_SOURCE_SHA256: source.manifest.artifact.sha256,
      DIAGNOSTIC_MAX_ROWS: process.env.DIAGNOSTIC_MAX_ROWS || '10000',
      PIPELINE_POLL_INTERVAL_MS: process.env.PIPELINE_POLL_INTERVAL_MS || '15000',
      PIPELINE_TIMEOUT_MS: String(PIPELINE_TIMEOUT_MS),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => void log(`[pipeline] ${String(chunk).trimEnd()}`));
  child.stderr.on('data', (chunk) => void log(`[pipeline:stderr] ${String(chunk).trimEnd()}`));
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

async function waitForTerminalStatus(path, timeoutMs, name) {
  const deadline = Date.now() + timeoutMs;
  let previousSummary = '';
  while (Date.now() < deadline) {
    const status = await requestJson('GET', path);
    const summary = JSON.stringify({
      state: status.state,
      phase: status.phase,
      processedMatchCount: status.processedMatchCount,
      totalMatchCount: status.totalMatchCount,
      rowCount: status.rowCount,
      currentPass: status.currentPass,
      totalPasses: status.totalPasses,
      error: status.error,
    });
    if (summary !== previousSummary) {
      await log(`${name}: ${summary}`);
      previousSummary = summary;
    }
    if (status.state === 'COMPLETE' || status.state === 'FAILED') return status;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${name} exceeded ${timeoutMs} ms.`);
}

async function requestJson(method, path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function writeStatus(state, stage, extra = {}) {
  await atomicJson(STATUS_PATH, {
    schemaVersion: 1,
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

function buildSnapshotId(trainingWindowEnd, catalogId, sourceSha256) {
  return `v8-${trainingWindowEnd.slice(0, 10).replaceAll('-', '')}-c${catalogId}-${sourceSha256.slice(0, 12)}`;
}

function quantileIndex(length, quantile) {
  return Math.min(length - 1, Math.max(0, Math.floor((length - 1) * quantile)));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
