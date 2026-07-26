import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const resultDirectory = join(
  process.env.GITHUB_WORKSPACE ?? process.cwd(),
  'recommendation-v6-full-crawler-result',
);
const datasetDirectory =
  'recommendation-decision-dataset-v5-full-crawler-20260726';
const valueDirectory = 'recommendation-value-v6-full-crawler-20260726';
const policyDirectory = 'recommendation-policy-v6-full-crawler-20260726';

await mkdir(resultDirectory, { recursive: true });

const volumeRoot = commandOutput('sudo', [
  'docker',
  'volume',
  'inspect',
  'deadlock_dynamo_helper_deadlock-storage',
  '--format',
  '{{ .Mountpoint }}',
]).trim();

const datasetPath = join(volumeRoot, datasetDirectory, 'dataset.ndjson');
const datasetManifestPath = join(volumeRoot, datasetDirectory, 'manifest.json');
const datasetAuditPath = join(volumeRoot, datasetDirectory, 'audit.json');
const valueEvaluationPath = join(volumeRoot, valueDirectory, 'evaluation.json');
const valueAuditPath = join(volumeRoot, valueDirectory, 'audit.json');
const policyEvaluationPath = join(volumeRoot, policyDirectory, 'evaluation.json');
const policyAuditPath = join(volumeRoot, policyDirectory, 'audit.json');

for (const path of [
  datasetPath,
  datasetManifestPath,
  datasetAuditPath,
  valueEvaluationPath,
  valueAuditPath,
  policyEvaluationPath,
  policyAuditPath,
]) {
  assertTrue(commandSucceeded('sudo', ['test', '-f', path]), `Missing artifact: ${path}`);
}

const counts = JSON.parse(
  commandOutput('sudo', [
    'node',
    '-e',
    String.raw`
const fs = require('node:fs');
const readline = require('node:readline');
const path = process.argv[1];
const counts = {
  rowCount: 0,
  playerTimelineAvailableCount: 0,
  playerTimelineFreshCount: 0,
  teamEconomyAvailableCount: 0,
  completeOwnTeamEconomyCount: 0,
  completeEnemyTeamEconomyCount: 0,
  complete3mCount: 0,
  complete5mCount: 0,
  complete10mCount: 0,
};
(async () => {
  const lines = readline.createInterface({
    input: fs.createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    counts.rowCount += 1;
    const state = row.stateBeforeAction || {};
    const player = state.playerTimelineSnapshot || {};
    const team = state.teamEconomy || {};
    const eligibility = row.trainingEligibility || {};
    if (player.available === true) counts.playerTimelineAvailableCount += 1;
    if (player.available === true && player.fresh === true) counts.playerTimelineFreshCount += 1;
    if (team.available === true) counts.teamEconomyAvailableCount += 1;
    if (team.available === true && team.completeOwnTeam === true) {
      counts.completeOwnTeamEconomyCount += 1;
    }
    if (team.available === true && team.completeEnemyTeam === true) {
      counts.completeEnemyTeamEconomyCount += 1;
    }
    if (eligibility.shortHorizon3m === true) counts.complete3mCount += 1;
    if (eligibility.shortHorizon5m === true) counts.complete5mCount += 1;
    if (eligibility.shortHorizon10m === true) counts.complete10mCount += 1;
  }
  process.stdout.write(JSON.stringify(counts));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`,
    datasetPath,
  ]),
);

const datasetManifest = readJson(datasetManifestPath);
const datasetAudit = readJson(datasetAuditPath);
const valueEvaluation = readJson(valueEvaluationPath);
const valueAudit = readJson(valueAuditPath);
const policyEvaluation = readJson(policyEvaluationPath);
const policyAudit = readJson(policyAuditPath);

const coverage = {
  ...counts,
  playerTimelineRate: divide(counts.playerTimelineAvailableCount, counts.rowCount),
  playerTimelineFreshRate: divide(counts.playerTimelineFreshCount, counts.rowCount),
  teamEconomyRate: divide(counts.teamEconomyAvailableCount, counts.rowCount),
  completeOwnTeamEconomyRate: divide(
    counts.completeOwnTeamEconomyCount,
    counts.rowCount,
  ),
  completeEnemyTeamEconomyRate: divide(
    counts.completeEnemyTeamEconomyCount,
    counts.rowCount,
  ),
  complete3mRate: divide(counts.complete3mCount, counts.rowCount),
  complete5mRate: divide(counts.complete5mCount, counts.rowCount),
  complete10mRate: divide(counts.complete10mCount, counts.rowCount),
};

const validation = {
  generatedAt: new Date().toISOString(),
  volumeRoot,
  datasetVersion: datasetManifest.datasetVersion,
  datasetAuditPassed: datasetAudit.passed === true,
  valueAuditPassed: valueAudit.passed === true,
  policyAuditPassed: policyAudit.passed === true,
  coverage,
  valueReleaseGate: valueEvaluation.releaseGate,
  valueTest: valueEvaluation.test,
  policyReleaseGate: policyEvaluation.releaseGate,
  policyEstimators: policyEvaluation.estimators,
  policyBootstrap: policyEvaluation.bootstrap,
  policyCoverage: policyEvaluation.coverage,
  policyDiagnostics: policyEvaluation.diagnostics,
};

await writeFile(
  join(resultDirectory, '04-production-data-validation.json'),
  `${JSON.stringify(validation, undefined, 2)}\n`,
  'utf8',
);

assertTrue(counts.rowCount > 0, 'Dataset V5.3 contains no rows.');
assertTrue(
  counts.playerTimelineAvailableCount > 0,
  'Dataset V5.3 contains no decision-time player timeline snapshots.',
);
assertTrue(
  counts.teamEconomyAvailableCount > 0,
  'Dataset V5.3 contains no available team-economy states.',
);
assertTrue(
  counts.complete3mCount > 0,
  'Dataset V5.3 contains no complete 3-minute short-horizon targets.',
);
assertTrue(datasetAudit.passed === true, 'Dataset V5.3 audit did not pass.');
assertTrue(valueAudit.passed === true, 'Value V6 audit did not pass.');
assertTrue(policyAudit.passed === true, 'Policy V6 audit did not pass.');

console.log(JSON.stringify(validation, undefined, 2));

function readJson(path) {
  return JSON.parse(commandOutput('sudo', ['cat', path]));
}

function commandOutput(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 30 * 60_000,
    maxBuffer: 128 * 1024 * 1024,
  });
}

function commandSucceeded(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
