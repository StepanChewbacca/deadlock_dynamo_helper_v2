import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository = '/home/ubuntu/apps/deadlock_dynamo_helper';
const expectedCommit = 'f0ca1aebeb881a7cd39251c03702461d19ac3ed4';
const apiBaseUrl = 'http://127.0.0.1:3000';
const resultDirectory = join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'recommendation-value-v4-context-result');
const overridePath = '/tmp/recommendation-value-v4-context.override.yml';
const datasetSha256 = '9f70cd37f11d0b1cb03a246a9cfc70268c440ec1ec3cb14e24c85a4b90bbe7da';
const valueEndpoint = '/deadlock/analysis/recommendation-value-v4-training';
const policyEndpoint = '/deadlock/analysis/recommendation-policy-v4-evaluation';
const telemetryEndpoint = '/deadlock/analysis/recommendation-telemetry/status';

await mkdir(resultDirectory, { recursive: true });
let failure;
try {
  await waitForDeployment();
  await configureApi();
  await waitForApi(valueEndpoint + '/status', 20 * 60_000);
  const valueStatus = await runStage('value', valueEndpoint, {
    trainFraction: 0.8,
    priorStrength: 100,
    minContextObservations: 20,
    calibrationBinCount: 10,
    expectedSourceSha256: datasetSha256,
  }, 120 * 60_000);
  const valueManifest = await artifact('value-manifest', valueEndpoint + '/manifest');
  const valueAudit = await artifact('value-audit', valueEndpoint + '/audit');
  const valueEvaluation = await artifact('value-evaluation', valueEndpoint + '/evaluation');
  const valueModelSha256 = valueManifest?.artifacts?.model?.sha256;
  if (!valueAudit.passed || typeof valueModelSha256 !== 'string') throw new Error('Value V4 artifacts failed validation.');

  let policySummary = { skipped: true, reason: 'VALUE_RELEASE_GATE_FAILED' };
  if (valueEvaluation?.releaseGate?.passed === true) {
    const behavioralManifest = await request('/deadlock/analysis/recommendation-behavioral-v4-training/manifest');
    const behavioralModelSha256 = behavioralManifest?.artifacts?.model?.sha256;
    if (typeof behavioralModelSha256 !== 'string') throw new Error('Behavioral model SHA is missing.');
    const policyStatus = await runStage('policy', policyEndpoint, {
      expectedDatasetSha256: datasetSha256,
      expectedBehavioralModelSha256: behavioralModelSha256,
      expectedValueModelSha256: valueModelSha256,
      bootstrapReplicates: 1000,
      bootstrapSeed: 20260724,
    }, 90 * 60_000);
    const policyManifest = await artifact('policy-manifest', policyEndpoint + '/manifest');
    const policyAudit = await artifact('policy-audit', policyEndpoint + '/audit');
    const policyEvaluation = await artifact('policy-evaluation', policyEndpoint + '/evaluation');
    policySummary = { status: policyStatus, manifest: policyManifest, audit: policyAudit, evaluation: policyEvaluation };
  }
  await save('00-summary.json', { completedAt: new Date().toISOString(), expectedCommit, value: { status: valueStatus, manifest: valueManifest, audit: valueAudit, evaluation: valueEvaluation }, policy: policySummary });
} catch (error) {
  failure = error;
  await save('99-failure.json', { failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
} finally {
  try { await restoreApi(); } catch (error) { failure ??= error; await save('98-restore-failure.json', { error: String(error) }); }
}
if (failure) throw failure;

async function waitForDeployment() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const current = output('git', ['-C', deployRepository, 'rev-parse', 'HEAD']).trim();
    const ancestor = spawnSync('git', ['-C', deployRepository, 'merge-base', '--is-ancestor', expectedCommit, current]);
    if (ancestor.status === 0) { await save('deploy.json', { expectedCommit, deployedCommit: current }); return; }
    await sleep(15_000);
  }
  throw new Error(`Production did not deploy ${expectedCommit}.`);
}

async function configureApi() {
  const override = `services:\n  api:\n    environment:\n      DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR: /app/apps/api/storage/recommendation-value-v4-training-historical-bootstrap-v2\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR: /app/apps/api/storage/recommendation-behavioral-v4-training-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_POLICY_V4_DATASET_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_POLICY_V4_BEHAVIORAL_DIR: /app/apps/api/storage/recommendation-behavioral-v4-training-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_POLICY_V4_VALUE_DIR: /app/apps/api/storage/recommendation-value-v4-training-historical-bootstrap-v2\n      DEADLOCK_RECOMMENDATION_POLICY_V4_OUTPUT_DIR: /app/apps/api/storage/recommendation-policy-v4-evaluation-historical-bootstrap-v2\n`;
  await writeFile(overridePath, override, 'utf8');
  compose(['-f', join(deployRepository, 'docker-compose.yml'), '-f', overridePath, 'up', '-d', '--force-recreate', '--no-deps', 'api']);
}

async function restoreApi() {
  compose(['-f', join(deployRepository, 'docker-compose.yml'), 'up', '-d', '--force-recreate', '--no-deps', 'api']);
  await rm(overridePath, { force: true });
  await waitForApi(telemetryEndpoint, 15 * 60_000);
  await save('97-restored-telemetry-status.json', await request(telemetryEndpoint));
}

async function runStage(name, endpoint, body, timeoutMs) {
  const start = await request(endpoint + '/start', { method: 'POST', body: JSON.stringify(body) });
  await save(`${name}-start.json`, start);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await request(endpoint + '/status');
    await save(`${name}-status.json`, status);
    if (status.state === 'COMPLETE') return status;
    if (status.state === 'FAILED') throw new Error(`${name} failed: ${status.error ?? 'unknown'}`);
    await sleep(10_000);
  }
  throw new Error(`${name} timed out.`);
}
async function artifact(name, path) { const value = await request(path); await save(`${name}.json`, value); return value; }
async function waitForApi(path, timeoutMs) { const started = Date.now(); while (Date.now() - started < timeoutMs) { try { await request(path); return; } catch {} await sleep(5_000); } throw new Error(`API not ready: ${path}`); }
async function request(path, init = {}) { const response = await fetch(apiBaseUrl + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) }); const text = await response.text(); const value = text ? JSON.parse(text) : {}; if (!response.ok) throw new Error(`${path} ${response.status}: ${text}`); return value; }
async function save(name, value) { await writeFile(join(resultDirectory, name), `${JSON.stringify(value, undefined, 2)}\n`, 'utf8'); }
function compose(args) { const result = spawnSync('sudo', ['docker', 'compose', ...args], { encoding: 'utf8', timeout: 20 * 60_000 }); if (result.status !== 0) throw new Error(result.stderr || result.stdout); }
function output(command, args) { return execFileSync(command, args, { encoding: 'utf8', timeout: 60_000 }); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
