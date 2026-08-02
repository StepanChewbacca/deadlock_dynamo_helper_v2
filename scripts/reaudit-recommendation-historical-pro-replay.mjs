import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);
const {
  RecommendationHistoricalProReplayAuditAccumulator,
} = require('../apps/api/dist/src/deadlock-live/recommendation-historical-pro-replay-streaming-audit.js');

const outputDirectory =
  process.env.DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_DIR?.trim() ||
  '/app/apps/api/storage/recommendation-historical-pro-replay-v1';
const datasetPath = join(outputDirectory, 'dataset.ndjson');
const auditPath = join(outputDirectory, 'audit.json');
const manifestPath = join(outputDirectory, 'manifest.json');
const resultPath = process.env.REAUDIT_RESULT_PATH?.trim();

await reaudit();

async function reaudit() {
  const [previousAudit, previousManifest, datasetStat] = await Promise.all([
    requiredJson(auditPath, 'Historical replay audit'),
    requiredJson(manifestPath, 'Historical replay manifest'),
    stat(datasetPath),
  ]);

  validateExistingArtifact(previousAudit, previousManifest, datasetStat);

  const accumulator = new RecommendationHistoricalProReplayAuditAccumulator(
    previousAudit.thresholds,
  );
  let parsedRowCount = 0;
  for await (const value of ndjson(datasetPath)) {
    accumulator.observe(value);
    parsedRowCount += 1;
    if (parsedRowCount % 50_000 === 0) {
      console.log(`Re-audited ${parsedRowCount} historical replay rows.`);
    }
  }

  const generatedAt = new Date().toISOString();
  const coreAudit = accumulator.finalize(generatedAt);
  const additionalReasons = artifactReasons({
    coreAudit,
    previousAudit,
    previousManifest,
    parsedRowCount,
  });
  const reasons = [...coreAudit.reasons, ...additionalReasons];
  const trainingArtifactEligible =
    previousAudit.build?.fullCorpus === true && reasons.length === 0;
  const audit = {
    ...previousAudit,
    ...coreAudit,
    generatedAt,
    passed: reasons.length === 0,
    reasons,
    source: previousAudit.source,
    snapshots: previousAudit.snapshots,
    build: previousAudit.build,
    trainingArtifactEligible,
  };
  const manifest = {
    ...previousManifest,
    generatedAt,
    auditPassed: audit.passed,
    trainingArtifactEligible,
  };

  const summary = {
    generatedAt,
    datasetPath,
    parsedRowCount,
    previousAuditPassed: previousAudit.passed === true,
    auditPassed: audit.passed,
    trainingArtifactEligible,
    timelineCoverage: audit.coverage.timelineCoverage,
    candidateMetadataCoverage: audit.coverage.candidateMetadataCoverage,
    observedActionCandidateCoverage:
      audit.coverage.observedActionCandidateCoverage,
    stateModelEligibleCount: audit.coverage.stateModelEligibleCount,
    behavioralModelEligibleCount: audit.coverage.behavioralModelEligibleCount,
    actionModelEligibleCount: audit.coverage.actionModelEligibleCount,
    reasons,
  };

  await Promise.all([
    backupOnce(auditPath, `${auditPath}.before-timeline-audit-fix-v1`),
    backupOnce(manifestPath, `${manifestPath}.before-timeline-audit-fix-v1`),
  ]);
  await Promise.all([
    atomicJson(auditPath, audit),
    atomicJson(manifestPath, manifest),
    resultPath ? atomicJson(resultPath, summary) : Promise.resolve(),
  ]);

  console.log(JSON.stringify(summary, null, 2));
  if (!audit.passed || !trainingArtifactEligible) {
    throw new Error(
      `Historical replay re-audit failed: ${reasons.join('; ') || 'artifact is not training eligible'}.`,
    );
  }
}

function validateExistingArtifact(audit, manifest, datasetStat) {
  if (
    audit?.schemaVersion !== 1 ||
    audit?.replayVersion !== 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_1' ||
    manifest?.schemaVersion !== 1 ||
    manifest?.replayVersion !== 'RECOMMENDATION_HISTORICAL_PRO_REPLAY_1'
  ) {
    throw new Error('Historical replay audit or manifest version is invalid.');
  }
  if (!audit.thresholds || !audit.source || !audit.snapshots || !audit.build) {
    throw new Error('Historical replay audit lineage is incomplete.');
  }
  if (!manifest.artifact || manifest.artifact.fileName !== 'dataset.ndjson') {
    throw new Error('Historical replay manifest artifact is invalid.');
  }
  if (Number(manifest.artifact.byteLength) !== datasetStat.size) {
    throw new Error(
      `Historical replay byte length mismatch: ${datasetStat.size} versus ` +
        `${manifest.artifact.byteLength}.`,
    );
  }
}

function artifactReasons({
  coreAudit,
  previousAudit,
  previousManifest,
  parsedRowCount,
}) {
  const reasons = [];
  if (parsedRowCount !== Number(previousManifest.artifact.rowCount)) {
    reasons.push(
      'Physical replay row count does not match the existing manifest.',
    );
  }
  if (coreAudit.rowCount !== parsedRowCount) {
    reasons.push('Streaming audit row count does not match parsed rows.');
  }
  if (
    Number(previousAudit.source.scannedRowCount) !==
    Number(previousAudit.source.expectedRowCount)
  ) {
    reasons.push('Scanned source row count does not match the source manifest.');
  }
  if (
    Number(previousAudit.source.selectedRowCount) !==
    Number(previousManifest.source.selectedRowCount)
  ) {
    reasons.push('Selected source row count does not match the replay manifest.');
  }
  if (Number(previousAudit.source.invalidSourceRowCount) > 0) {
    reasons.push('Replay source contains invalid rows.');
  }
  if (parsedRowCount === 0) {
    reasons.push('Replay produced no timeline-backed rows.');
  }
  if (previousAudit.build.fullCorpus !== true) {
    reasons.push('Diagnostic maxRows was used; artifact is not eligible for training.');
  }
  return reasons;
}

async function* ndjson(path) {
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }
    try {
      yield JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON in ${path} at line ${lineNumber}.`);
    }
  }
}

async function requiredJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} is unavailable at ${path}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

async function backupOnce(source, destination) {
  try {
    await stat(destination);
  } catch {
    await copyFile(source, destination);
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  await writeFile(partial, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(partial, path);
}
