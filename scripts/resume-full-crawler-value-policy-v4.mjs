import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository = '/home/ubuntu/apps/deadlock_dynamo_helper';
const apiBaseUrl = 'http://127.0.0.1:3000';
const resultDirectory = join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'full-crawler-value-policy-resume-result');
const overridePath = '/tmp/full-crawler-value-policy-resume.override.yml';
const datasetSha256 = 'b5f908020e10219459628fa21f552890113cf5c93867f1501d8f827ac098ec9d';
const directories = {
  bootstrap: '/app/apps/api/storage/recommendation-decision-dataset-v4-full-crawler-v2-20260724',
  behavioral: '/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-v2-20260724',
  value: '/app/apps/api/storage/recommendation-value-v4-full-crawler-v2-resume-20260725',
  policy: '/app/apps/api/storage/recommendation-policy-v4-full-crawler-v2-resume-20260725',
};
const endpoints = {
  behavioral: '/deadlock/analysis/recommendation-behavioral-v4-training',
  value: '/deadlock/analysis/recommendation-value-v4-training',
  policy: '/deadlock/analysis/recommendation-policy-v4-evaluation',
  telemetry: '/deadlock/analysis/recommendation-telemetry/status',
};

await mkdir(resultDirectory, { recursive: true });
let failure;
try {
  await configureApi();
  await waitForApi(endpoints.value + '/status', 20 * 60_000);

  const behavioralManifest = await readArtifact('01-behavioral-manifest', endpoints.behavioral + '/manifest');
  const behavioralAudit = await readArtifact('01-behavioral-audit', endpoints.behavioral + '/audit');
  const behavioralEvaluation = await readArtifact('01-behavioral-evaluation', endpoints.behavioral + '/evaluation');
  assertTrue(behavioralAudit.passed === true, 'Behavioral V4 audit failed.');
  assertTrue(behavioralEvaluation?.releaseGate?.passed === true, 'Behavioral V4 release gate failed.');
  const behavioralModelSha256 = requiredString(behavioralManifest, ['artifacts', 'model', 'sha256']);

  const valueStatus = await runStage({
    name: '02-value',
    endpoint: endpoints.value,
    body: {
      trainFraction: 0.8,
      priorStrength: 100,
      minContextObservations: 20,
      calibrationBinCount: 10,
      expectedSourceSha256: datasetSha256,
    },
    timeoutMs: 240 * 60_000,
  });
  const valueManifest = await readArtifact('02-value-manifest', endpoints.value + '/manifest');
  const valueAudit = await readArtifact('02-value-audit', endpoints.value + '/audit');
  const valueEvaluation = await readArtifact('02-value-evaluation', endpoints.value + '/evaluation');
  assertTrue(valueAudit.passed === true, 'Value V4 audit failed.');
  const valueModelSha256 = requiredString(valueManifest, ['artifacts', 'model', 'sha256']);

  let policy = { skipped: true, reasons: [] };
  if (valueEvaluation?.releaseGate?.passed === true) {
    const policyStatus = await runStage({
      name: '03-policy',
      endpoint: endpoints.policy,
      body: {
        expectedDatasetSha256: datasetSha256,
        expectedBehavioralModelSha256: behavioralModelSha256,
        expectedValueModelSha256: valueModelSha256,
        bootstrapReplicates: 1000,
        bootstrapSeed: 20260725,
      },
      timeoutMs: 180 * 60_000,
    });
    const policyManifest = await readArtifact('03-policy-manifest', endpoints.policy + '/manifest');
    const policyAudit = await readArtifact('03-policy-audit', endpoints.policy + '/audit');
    const policyEvaluation = await readArtifact('03-policy-evaluation', endpoints.policy + '/evaluation');
    assertTrue(policyAudit.passed === true, 'Policy V4 audit failed.');
    policy = { skipped: false, status: policyStatus, manifest: policyManifest, audit: policyAudit, evaluation: policyEvaluation };
  } else {
    policy.reasons.push('VALUE_RELEASE_GATE_FAILED');
  }

  await saveJson('00-summary.json', {
    completedAt: new Date().toISOString(),
    datasetSha256,
    behavioral: { modelSha256: behavioralModelSha256, releaseGate: behavioralEvaluation.releaseGate },
    value: { status: valueStatus, modelSha256: valueModelSha256, releaseGate: valueEvaluation.releaseGate },
    policy,
  });
} catch (error) {
  failure = error;
  await saveJson('99-failure.json', { failedAt: new Date().toISOString(), error: message(error), stack: error instanceof Error ? error.stack : undefined });
} finally {
  try {
    await restoreProductionApi();
  } catch (error) {
    failure ??= error;
    await saveJson('98-restore-failure.json', { failedAt: new Date().toISOString(), error: message(error) });
  }
}
if (failure) throw failure;

async function configureApi() {
  const override = `services:\n  api:\n    environment:\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR: ${directories.bootstrap}\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR: ${directories.behavioral}\n      DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR: ${directories.bootstrap}\n      DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR: ${directories.value}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR: ${directories.bootstrap}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR: ${directories.behavioral}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR: ${directories.value}\n      DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR: ${directories.policy}\n`;
  await writeFile(overridePath, override, 'utf8');
  runCompose(['-f', 'docker-compose.yml', '-f', overridePath, 'up', '-d', '--force-recreate', '--no-deps', 'api']);
}

async function restoreProductionApi() {
  runCompose(['up', '-d', '--force-recreate', '--no-deps', 'api']);
  await rm(overridePath, { force: true });
  await waitForApi(endpoints.telemetry, 20 * 60_000);
  await saveJson('97-restored-telemetry-status.json', await requestJson('GET', endpoints.telemetry));
}

function runCompose(args) {
  execFileSync('sudo', ['docker', 'compose', ...args], { cwd: deployRepository, stdio: 'inherit', timeout: 30 * 60_000 });
}

async function runStage({ name, endpoint, body, timeoutMs }) {
  await saveJson(`${name}-00-before-status.json`, await requestJson('GET', endpoint + '/status'));
  await saveJson(`${name}-01-start-response.json`, await requestJson('POST', endpoint, body));
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < deadline) {
    await sleep(10_000);
    let status;
    try {
      status = await requestJson('GET', endpoint + '/status');
    } catch (error) {
      console.warn(`[${name}] transient status error: ${message(error)}`);
      continue;
    }
    if (Date.now() - lastLog >= 60_000) {
      console.log(`[${name}] ${JSON.stringify(status)}`);
      lastLog = Date.now();
    }
    if (status.state === 'COMPLETE') {
      await saveJson(`${name}-02-status.json`, status);
      return status;
    }
    if (status.state === 'FAILED') {
      await saveJson(`${name}-02-status.json`, status);
      throw new Error(`${name} failed: ${status.error ?? 'unknown error'}`);
    }
  }
  throw new Error(`${name} timed out after ${timeoutMs} ms.`);
}

async function readArtifact(name, path) {
  const value = await requestJson('GET', path);
  await saveJson(`${name}.json`, value);
  return value;
}

async function requestJson(method, path, body) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(apiBaseUrl + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${text}`);
      return text ? JSON.parse(text) : {};
    } catch (error) {
      lastError = error;
      if (attempt < 6) await sleep(attempt * 5_000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function waitForApi(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await requestJson('GET', path); return; } catch { await sleep(5_000); }
  }
  throw new Error(`API did not become ready for ${path}.`);
}

async function saveJson(name, value) {
  await writeFile(join(resultDirectory, name), JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function requiredString(value, path) {
  let current = value;
  for (const key of path) current = current?.[key];
  if (typeof current !== 'string' || current.length === 0) throw new Error(`Missing ${path.join('.')}.`);
  return current;
}
function assertTrue(condition, error) { if (!condition) throw new Error(error); }
function message(error) { return error instanceof Error ? error.message : String(error); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
