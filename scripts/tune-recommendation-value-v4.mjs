import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const deployRepository = '/home/ubuntu/apps/deadlock_dynamo_helper';
const expectedCommit = '579868d24a42497f87561a5e002423f6275aea07';
const apiBaseUrl = 'http://127.0.0.1:3000';
const outputDirectory = join(process.env.GITHUB_WORKSPACE ?? process.cwd(), 'value-v4-tuning-results');
const overridePath = '/tmp/recommendation-value-v4-tuning.override.yml';
const endpoint = '/deadlock/analysis/recommendation-value-v4-training';
const datasetSha256 = '9f70cd37f11d0b1cb03a246a9cfc70268c440ec1ec3cb14e24c85a4b90bbe7da';
const configurations = [
  { priorStrength: 5, minContextObservations: 1 },
  { priorStrength: 10, minContextObservations: 1 },
  { priorStrength: 10, minContextObservations: 3 },
  { priorStrength: 20, minContextObservations: 5 },
  { priorStrength: 50, minContextObservations: 10 },
  { priorStrength: 100, minContextObservations: 20 },
];

await mkdir(outputDirectory, { recursive: true });
let failure;
try {
  await waitForDeployment();
  await configureHistoricalApi();
  await waitForApi();
  const results = [];
  for (const configuration of configurations) {
    const name = `prior-${configuration.priorStrength}-min-${configuration.minContextObservations}`;
    const result = await runConfiguration(configuration, name);
    results.push(result);
  }
  results.sort(compareResults);
  const best = results[0];
  await writeJson('00-ranking.json', { generatedAt: new Date().toISOString(), best, results });
  await runConfiguration(best.configuration, 'best-final');
} catch (error) {
  failure = error;
  await writeJson('99-failure.json', {
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  throw error;
}

async function waitForDeployment() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const deployedCommit = git(['rev-parse', 'HEAD']).trim();
    if (deployedCommit === expectedCommit) {
      await writeJson('deploy.json', { expectedCommit, deployedCommit });
      return;
    }
    await sleep(15_000);
  }
  throw new Error(`Production did not deploy ${expectedCommit}.`);
}

async function configureHistoricalApi() {
  await writeFile(overridePath, `services:\n  api:\n    environment:\n      DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR: /app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap\n      DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR: /app/apps/api/storage/recommendation-value-v4-training-historical-bootstrap-tuning\n`, 'utf8');
  compose(['-f', 'docker-compose.yml', '-f', overridePath, 'up', '-d', '--force-recreate', '--no-deps', 'api']);
}

async function waitForApi() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      await request(`${endpoint}/status`);
      return;
    } catch {
      await sleep(5_000);
    }
  }
  throw new Error('Value V4 API did not become ready.');
}

async function runConfiguration(configuration, name) {
  const start = await request(`${endpoint}/start`, {
    method: 'POST',
    body: JSON.stringify({
      trainFraction: 0.8,
      priorStrength: configuration.priorStrength,
      minContextObservations: configuration.minContextObservations,
      calibrationBinCount: 10,
      expectedSourceSha256: datasetSha256,
    }),
  });
  await writeJson(`${name}-start.json`, start);
  let status;
  for (let attempt = 0; attempt < 720; attempt += 1) {
    status = await request(`${endpoint}/status`);
    if (status.state === 'COMPLETE' || status.state === 'FAILED') break;
    await sleep(10_000);
  }
  await writeJson(`${name}-status.json`, status);
  if (!status || status.state !== 'COMPLETE') {
    throw new Error(`${name} failed: ${status?.error ?? 'timeout'}`);
  }
  const evaluation = await request(`${endpoint}/evaluation`);
  const manifest = await request(`${endpoint}/manifest`);
  await writeJson(`${name}-evaluation.json`, evaluation);
  await writeJson(`${name}-manifest.json`, manifest);
  return {
    name,
    configuration,
    modelSha256: manifest?.artifacts?.model?.sha256,
    releaseGate: evaluation.releaseGate,
    value: evaluation.value,
    globalBaseline: evaluation.globalBaseline,
    heroTimeBaseline: evaluation.heroTimeBaseline,
    score: scoringTuple(evaluation),
  };
}

function scoringTuple(evaluation) {
  const value = evaluation.value;
  const baselines = [evaluation.globalBaseline, evaluation.heroTimeBaseline];
  const bestLogLoss = Math.min(...baselines.map((entry) => entry.logLoss));
  const bestBrier = Math.min(...baselines.map((entry) => entry.brierScore));
  return {
    releaseGatePassed: Boolean(evaluation.releaseGate?.passed),
    logLossImprovement: bestLogLoss - value.logLoss,
    brierImprovement: bestBrier - value.brierScore,
    rocAuc: value.rocAuc,
    calibrationError: value.calibration?.expectedCalibrationError,
  };
}

function compareResults(left, right) {
  return Number(right.score.releaseGatePassed) - Number(left.score.releaseGatePassed)
    || right.score.logLossImprovement - left.score.logLossImprovement
    || right.score.brierImprovement - left.score.brierImprovement
    || right.score.rocAuc - left.score.rocAuc;
}

async function request(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function writeJson(fileName, value) {
  await writeFile(join(outputDirectory, fileName), `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

function git(args) {
  return execFileSync('git', ['-C', deployRepository, ...args], { encoding: 'utf8' });
}

function compose(args) {
  execFileSync('sudo', ['docker', 'compose', ...args], { cwd: deployRepository, stdio: 'inherit' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
