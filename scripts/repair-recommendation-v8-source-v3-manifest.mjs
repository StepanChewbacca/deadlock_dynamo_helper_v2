import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const sourceDirectory = process.argv[2];
const expectedActualRowCount = optionalPositiveInteger(
  process.env.EXPECTED_ACTUAL_ROW_COUNT,
);

if (!sourceDirectory) {
  throw new Error('Usage: node repair-recommendation-v8-source-v3-manifest.mjs <source-directory>');
}

const manifestPath = join(sourceDirectory, 'manifest.json');
const auditPath = join(sourceDirectory, 'audit.json');
const datasetPath = join(sourceDirectory, 'dataset.ndjson');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const audit = JSON.parse(await readFile(auditPath, 'utf8'));

assert(manifest.datasetVersion === 'CONTEXTUAL_V3_DECISION_DATASET_1', 'Unexpected Dataset V3 version.');
assert(manifest.auditPassed === true, 'Dataset V3 manifest audit flag is false.');
assert(audit.passed === true, 'Dataset V3 audit is not passed.');
assert(typeof manifest.artifact?.sha256 === 'string', 'Dataset V3 manifest SHA-256 is missing.');
assert(Number.isSafeInteger(manifest.artifact?.rowCount), 'Dataset V3 manifest rowCount is invalid.');

const datasetStat = await stat(datasetPath);
const actualSha256 = await hashFile(datasetPath);
assert(
  actualSha256 === manifest.artifact.sha256,
  'Dataset V3 SHA-256 does not match the manifest.',
);
assert(
  datasetStat.size === manifest.artifact.byteLength,
  'Dataset V3 byte length does not match the manifest.',
);

const scan = await scanDataset(datasetPath);
if (expectedActualRowCount !== undefined) {
  assert(
    scan.rowCount === expectedActualRowCount,
    `Actual Dataset V3 row count ${scan.rowCount} does not match expected ${expectedActualRowCount}.`,
  );
}
assert(scan.invalidRowCount === 0, 'Dataset V3 contains invalid rows.');
assert(scan.rowCount > 0, 'Dataset V3 contains no rows.');
assert(
  scan.rowCount < manifest.artifact.rowCount,
  'Diagnostic repair requires the actual row count to be lower than the manifest row count.',
);

const repairedAt = new Date().toISOString();
const suffix = repairedAt.replaceAll(':', '').replaceAll('.', '');
const manifestBackupPath = `${manifestPath}.pre-diagnostic-repair-${suffix}`;
const auditBackupPath = `${auditPath}.pre-diagnostic-repair-${suffix}`;
await copyFile(manifestPath, manifestBackupPath);
await copyFile(auditPath, auditBackupPath);

const originalManifestRowCount = manifest.artifact.rowCount;
const originalAuditRowCount = audit.decisions?.rowCount;
const warning =
  `Diagnostic-only metadata repair at ${repairedAt}: manifest rowCount ${originalManifestRowCount} ` +
  `was replaced with the verified physical NDJSON row count ${scan.rowCount}. ` +
  'The source remains ineligible for release training because missing rows cannot be reconstructed.';

manifest.artifact.rowCount = scan.rowCount;
manifest.auditPassed = true;
manifest.warnings = uniqueStrings([...(manifest.warnings ?? []), warning]);
manifest.diagnosticRepair = {
  repairedAt,
  releaseEligible: false,
  physicalDatasetValidated: true,
  sourceSha256Unchanged: true,
  originalManifestRowCount,
  repairedManifestRowCount: scan.rowCount,
  invalidRowCount: scan.invalidRowCount,
  reason: 'PARTIAL_FILE_WRITES_DETECTED_BY_SNAPSHOT_AUDIT',
};

audit.decisions = {
  ...(audit.decisions ?? {}),
  rowCount: scan.rowCount,
};
audit.passed = true;
audit.warnings = uniqueStrings([...(audit.warnings ?? []), warning]);
audit.diagnosticRepair = {
  repairedAt,
  releaseEligible: false,
  physicalDatasetValidated: true,
  sourceSha256Unchanged: true,
  originalAuditRowCount,
  repairedAuditRowCount: scan.rowCount,
  invalidRowCount: scan.invalidRowCount,
  reason: 'PARTIAL_FILE_WRITES_DETECTED_BY_SNAPSHOT_AUDIT',
};

await atomicJson(manifestPath, manifest);
await atomicJson(auditPath, audit);

console.log(
  JSON.stringify(
    {
      repairedAt,
      sourceDirectory,
      datasetPath,
      sha256: actualSha256,
      byteLength: datasetStat.size,
      originalManifestRowCount,
      originalAuditRowCount,
      repairedRowCount: scan.rowCount,
      invalidRowCount: scan.invalidRowCount,
      manifestBackupPath,
      auditBackupPath,
      releaseEligible: false,
      productionRankingChanged: false,
      passiveShadowActivated: false,
      randomizedCanaryAuthorized: false,
    },
    null,
    2,
  ),
);

async function scanDataset(path) {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let rowCount = 0;
  let invalidRowCount = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON in Dataset V3 at physical line ${lineNumber}.`);
    }
    rowCount += 1;
    if (!isValidDatasetRow(row)) {
      invalidRowCount += 1;
      throw new Error(`Invalid Dataset V3 row at physical line ${lineNumber}.`);
    }
    if (rowCount % 250000 === 0) {
      console.log(`Validated ${rowCount} Dataset V3 rows.`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return { rowCount, invalidRowCount };
}

function isValidDatasetRow(value) {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.decisionId === 'string' &&
    Number.isSafeInteger(Number(value.matchId)) &&
    typeof value.matchStartTime === 'string' &&
    Number.isFinite(Date.parse(value.matchStartTime)) &&
    Number.isSafeInteger(Number(value.playerId)) &&
    Number.isSafeInteger(Number(value.heroId)) &&
    Number.isFinite(Number(value.gameTimeS)) &&
    typeof value.inventoryBeforeStateKey === 'string' &&
    typeof value.inventoryAfterStateKey === 'string' &&
    typeof value.actualActionKey === 'string' &&
    Number.isSafeInteger(Number(value.actualItemId))
  );
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function atomicJson(path, value) {
  const partialPath = `${path}.diagnostic-repair.partial`;
  await writeFile(partialPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(partialPath, path);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function optionalPositiveInteger(value) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('EXPECTED_ACTUAL_ROW_COUNT must be a positive integer.');
  }
  return parsed;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
