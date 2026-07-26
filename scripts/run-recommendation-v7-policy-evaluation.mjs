import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository =
  process.env.DEADLOCK_DEPLOY_REPOSITORY ?? '/home/ubuntu/apps/deadlock_dynamo_helper';
const valueDirectory = process.env.RECOMMENDATION_V7_VALUE_DIR;
const policyDirectory = process.env.RECOMMENDATION_V7_POLICY_DIR;
const behavioralDirectory =
  process.env.RECOMMENDATION_V7_BEHAVIORAL_DIR ??
  '/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-recovery-v3-20260725';
const resultDirectory =
  process.env.RECOMMENDATION_V7_RESULT_DIR ??
  join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'recommendation-v6-improvement-result');
const apiBaseUrl = process.env.RECOMMENDATION_V7_API_BASE_URL ?? 'http://127.0.0.1:3000';
const overridePath = '/tmp/recommendation-v7-policy.override.yml';
const endpoint = '/deadlock/analysis/recommendation-policy-v6-evaluation';

if (!valueDirectory || !policyDirectory) {
  throw new Error('RECOMMENDATION_V7_VALUE_DIR and RECOMMENDATION_V7_POLICY_DIR are required.');
}

await mkdir(resultDirectory, { recursive: true });
const volumeRoot = resolveStorageVolumeRoot();
const valueManifest = readVolumeJson(valueDirectory, 'manifest.json');
const valueAudit = readVolumeJson(valueDirectory, 'audit.json');
const behavioralManifest = readVolumeJson(behavioralDirectory, 'manifest.json');
const behavioralAudit = readVolumeJson(behavioralDirectory, 'audit.json');

assertTrue(valueAudit.passed === true, 'Recommendation V7 Value audit did not pass.');
assertTrue(behavioralAudit.passed === true, 'Behavioral V4 audit did not pass.');

const valuePredictionSha256 = requiredSha(
  valueManifest?.artifacts?.predictionEvaluation?.sha256,
  'Recommendation V7 prediction SHA-256',
);
const valueModelSha256 = requiredSha(
  valueManifest?.artifacts?.model?.sha256,
  'Recommendation V7 model SHA-256',
);
const behavioralModelSha256 = requiredSha(
  behavioralManifest?.artifacts?.model?.sha256,
  'Behavioral V4 model SHA-256',
);

await configureApi();
await waitForApi(endpoint + '/status', 20 * 60_000);

let status = await requestJson('GET', endpoint + '/status');
if (status.state !== 'COMPLETE') {
  if (status.state === 'FAILED') {
    throw new Error(`Policy evaluator loaded a failed state: ${String(status.error)}`);
  }
  await requestJson('POST', endpoint + '/start', {
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
  });
  status = await waitForStage(240 * 60_000);
}

const manifest = await requestJson('GET', endpoint + '/manifest');
const audit = await requestJson('GET', endpoint + '/audit');
const evaluation = await requestJson('GET', endpoint + '/evaluation');
assertTrue(audit.passed === true, 'Recommendation V7 Policy OPE audit failed.');

const report = {
  completedAt: new Date().toISOString(),
  valueDirectory,
  policyDirectory,
  status,
  manifest,
  audit,
  evaluation,
  productionRolloutAuthorized: false,
};
await writeFile(
  join(resultDirectory, '60-v7-policy-report.json'),
  `${JSON.stringify(report, undefined, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(report, undefined, 2));

async function configureApi() {
  const override = `services:\n  api:\n    environment:\n      DEADLOCK_TIMELINE_COLLECTOR_ENABLED: "false"\n      DEADLOCK_RECOMMENDATION_POLICY_V6_BEHAVIORAL_DIR: ${behavioralDirectory}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_VALUE_DIR: ${valueDirectory}\n      DEADLOCK_RECOMMENDATION_POLICY_V6_OUTPUT_DIR: ${policyDirectory}\n      NODE_OPTIONS: --max-old-space-size=8192\n`;
  await writeFile(overridePath, override, 'utf8');
  execFileSync(
    'sudo',
    [
      'docker',
      'compose',
      '-f',
      join(deployRepository, 'docker-compose.yml'),
      '-f',
      overridePath,
      'up',
      '-d',
      '--force-recreate',
      '--no-deps',
      'api',
    ],
    {
      cwd: deployRepository,
      stdio: 'inherit',
      timeout: 30 * 60_000,
    },
  );
}

async function waitForStage(timeoutMs) {
  const startedAt = Date.now();
  let lastLogAt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    const current = await requestJson('GET', endpoint + '/status');
    if (current.state === 'COMPLETE') {
      return current;
    }
    if (current.state === 'FAILED') {
      throw new Error(`Recommendation V7 Policy OPE failed: ${String(current.error ?? 'unknown error')}`);
    }
    if (Date.now() - lastLogAt >= 60_000) {
      console.log(`[v7-policy] ${JSON.stringify(current)}`);
      lastLogAt = Date.now();
    }
    await sleep(10_000);
  }
  throw new Error('Recommendation V7 Policy OPE exceeded its timeout.');
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
    const value = responseText ? JSON.parse(responseText) : {};
    if (!response.ok) {
      throw new Error(`${method} ${path} failed with ${response.status}: ${responseText}`);
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function resolveStorageVolumeRoot() {
  const value = execFileSync(
    'sudo',
    [
      'docker',
      'volume',
      'inspect',
      'deadlock_dynamo_helper_deadlock-storage',
      '--format',
      '{{ .Mountpoint }}',
    ],
    { encoding: 'utf8' },
  ).trim();
  assertTrue(value.startsWith('/'), `Invalid storage volume root: ${value}`);
  return value;
}

function readVolumeJson(containerDirectory, fileName) {
  const prefix = '/app/apps/api/storage/';
  assertTrue(
    containerDirectory.startsWith(prefix),
    `Storage directory must start with ${prefix}: ${containerDirectory}`,
  );
  const path = join(volumeRoot, containerDirectory.slice(prefix.length), fileName);
  return JSON.parse(execFileSync('sudo', ['cat', path], { encoding: 'utf8' }));
}

function requiredSha(value, name) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  assertTrue(/^[a-f0-9]{64}$/.test(normalized), `${name} is missing or invalid.`);
  return normalized;
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
