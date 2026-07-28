from pathlib import Path


def block(value: str) -> str:
    lines = value.splitlines()
    if lines and not lines[0]:
        lines = lines[1:]
    if lines and not lines[-1]:
        lines = lines[:-1]
    return '\n'.join(line.split('|', 1)[1] for line in lines) + '\n'


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one replacement, found {count}')
    file.write_text(text.replace(old, new, 1))


v3 = 'apps/api/src/deadlock-live/hero-build-decision-dataset-v3.service.ts'
replace_once(
    v3,
    block('''
|      await rm(this.datasetPath, { force: true });
|      await rename(this.partialDatasetPath, this.datasetPath);
|      const artifactStat = await stat(this.datasetPath);
'''),
    block('''
|      await rm(this.datasetPath, { force: true });
|      await rename(this.partialDatasetPath, this.datasetPath);
|      const physicalRowCount = await countNdjsonRows(this.datasetPath);
|      if (physicalRowCount !== checkpoint.audit.rowCount) {
|        throw new Error(
|          `Contextual V3 physical row count ${physicalRowCount} does not match ` +
|            `the audited row count ${checkpoint.audit.rowCount}.`,
|        );
|      }
|      const artifactStat = await stat(this.datasetPath);
'''),
)
replace_once(
    v3,
    block('''
|    const value = this.buffer;
|    this.buffer = '';
|    await this.handle.write(value);
'''),
    block('''
|    const value = Buffer.from(this.buffer, 'utf8');
|    this.buffer = '';
|    let offset = 0;
|    while (offset < value.length) {
|      const { bytesWritten } = await this.handle.write(
|        value,
|        offset,
|        value.length - offset,
|        null,
|      );
|      if (bytesWritten <= 0) {
|        throw new Error('Contextual V3 writer made no progress while flushing.');
|      }
|      offset += bytesWritten;
|    }
'''),
)
replace_once(
    v3,
    'async function ensureFile(path: string): Promise<void> {\n',
    block('''
|async function countNdjsonRows(path: string): Promise<number> {
|  let rowCount = 0;
|  for await (const chunk of createReadStream(path)) {
|    const value = chunk as Buffer;
|    for (let index = 0; index < value.length; index += 1) {
|      if (value[index] === 10) {
|        rowCount += 1;
|      }
|    }
|  }
|  return rowCount;
|}
|
|async function ensureFile(path: string): Promise<void> {
'''),
)

replay = 'apps/api/src/deadlock-live/recommendation-historical-pro-replay.ts'
replace_once(
    replay,
    block('''
|      nonNegativeInteger(
|        outcome.snapshotGameTimeS,
|        `${outcome.horizon} snapshotGameTimeS`,
|      );
'''),
    block('''
|      nonNegativeFiniteNumber(
|        outcome.snapshotGameTimeS,
|        `${outcome.horizon} snapshotGameTimeS`,
|      );
'''),
)
replace_once(
    replay,
    'function nonNegativeInteger(value: unknown, name: string): number {\n',
    block('''
|function nonNegativeFiniteNumber(value: unknown, name: string): number {
|  const normalized = finiteNumber(value, name);
|  if (normalized < 0) {
|    throw new Error(`${name} must be non-negative.`);
|  }
|  return normalized;
|}
|
|function nonNegativeInteger(value: unknown, name: string): number {
'''),
)

snapshot = 'apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot-export.service.ts'
replace_once(
    snapshot,
    block('''
|import {
|  mkdir,
|  readFile,
|  rename,
|  stat,
|  writeFile,
|} from 'node:fs/promises';
'''),
    block('''
|import {
|  mkdir,
|  open,
|  readFile,
|  rename,
|  rm,
|  stat,
|  writeFile,
|} from 'node:fs/promises';
|import type { FileHandle } from 'node:fs/promises';
'''),
)
replace_once(
    snapshot,
    block('''
|      const artifactPath = this.artifactPath(request.snapshotId);
|      const artifactRaw = `${JSON.stringify(artifact, undefined, 2)}\n`;
|      const artifactSha256 = sha256Text(artifactRaw);
|      const audit = buildAudit({
'''),
    block('''
|      const artifactPath = this.artifactPath(request.snapshotId);
|      const artifactWrite = await writeCandidateSnapshotPartial(
|        artifactPath,
|        artifact,
|      );
|      const artifactSha256 = artifactWrite.sha256;
|      const audit = buildAudit({
'''),
)
replace_once(
    snapshot,
    block('''
|        artifactFileName: basename(artifactPath),
|        artifactByteLength: Buffer.byteLength(artifactRaw),
|        artifactSha256,
|      });
|      if (!audit.passed) {
|        throw new Error(
|          `Candidate generator snapshot audit failed: ${audit.reasons.join(' ')}`,
|        );
|      }
|
|      await atomicWrite(artifactPath, artifactRaw);
'''),
    block('''
|        artifactFileName: basename(artifactPath),
|        artifactByteLength: artifactWrite.byteLength,
|        artifactSha256,
|      });
|      if (!audit.passed) {
|        await rm(artifactWrite.partialPath, { force: true });
|        throw new Error(
|          `Candidate generator snapshot audit failed: ${audit.reasons.join(' ')}`,
|        );
|      }
|
|      await rename(artifactWrite.partialPath, artifactPath);
'''),
)
replace_once(
    snapshot,
    'async function atomicWrite(path: string, content: string): Promise<void> {\n',
    block(r'''
|const SNAPSHOT_STREAM_BUFFER_LIMIT_BYTES = 1024 * 1024;
|
|async function writeCandidateSnapshotPartial(
|  path: string,
|  artifact: RecommendationCandidateGeneratorSnapshotArtifact,
|): Promise<{ partialPath: string; byteLength: number; sha256: string }> {
|  const partialPath = `${path}.partial`;
|  await rm(partialPath, { force: true });
|  const handle = await open(partialPath, 'w');
|  const writer = new BufferedHashedSnapshotWriter(handle);
|  try {
|    await writer.append(
|      `{"schemaVersion":${artifact.schemaVersion},` +
|        `"artifactVersion":${JSON.stringify(artifact.artifactVersion)},` +
|        `"snapshot":${JSON.stringify(artifact.snapshot)},` +
|        `"generatorOptions":${JSON.stringify(artifact.generatorOptions)},` +
|        '"policies":[',
|    );
|    for (
|      let policyIndex = 0;
|      policyIndex < artifact.policies.length;
|      policyIndex += 1
|    ) {
|      const policy = artifact.policies[policyIndex];
|      if (policyIndex > 0) {
|        await writer.append(',');
|      }
|      await writer.append(
|        `{"heroId":${policy.heroId},` +
|          `"playerCount":${policy.playerCount},` +
|          `"stateCount":${policy.stateCount},` +
|          `"transitionCount":${policy.transitionCount},` +
|          '"states":[',
|      );
|      for (
|        let stateIndex = 0;
|        stateIndex < policy.states.length;
|        stateIndex += 1
|      ) {
|        if (stateIndex > 0) {
|          await writer.append(',');
|        }
|        await writer.append(JSON.stringify(policy.states[stateIndex]));
|      }
|      await writer.append(']}');
|    }
|    await writer.append(`],"catalog":${JSON.stringify(artifact.catalog)}}\n`);
|    const descriptor = await writer.close();
|    return { partialPath, ...descriptor };
|  } catch (error) {
|    await writer.abort();
|    await rm(partialPath, { force: true });
|    throw error;
|  }
|}
|
|class BufferedHashedSnapshotWriter {
|  private buffer = '';
|  private readonly hash = createHash('sha256');
|  private byteLength = 0;
|  private closed = false;
|
|  constructor(private readonly handle: FileHandle) {}
|
|  async append(value: string): Promise<void> {
|    if (this.closed) {
|      throw new Error('Candidate snapshot writer is already closed.');
|    }
|    this.buffer += value;
|    if (Buffer.byteLength(this.buffer) >= SNAPSHOT_STREAM_BUFFER_LIMIT_BYTES) {
|      await this.flush();
|    }
|  }
|
|  async close(): Promise<{ byteLength: number; sha256: string }> {
|    if (this.closed) {
|      throw new Error('Candidate snapshot writer is already closed.');
|    }
|    await this.flush();
|    await this.handle.sync();
|    await this.handle.close();
|    this.closed = true;
|    return {
|      byteLength: this.byteLength,
|      sha256: this.hash.digest('hex'),
|    };
|  }
|
|  async abort(): Promise<void> {
|    if (this.closed) {
|      return;
|    }
|    this.closed = true;
|    await this.handle.close().catch(() => undefined);
|  }
|
|  private async flush(): Promise<void> {
|    if (!this.buffer) {
|      return;
|    }
|    const value = Buffer.from(this.buffer, 'utf8');
|    this.buffer = '';
|    let offset = 0;
|    while (offset < value.length) {
|      const { bytesWritten } = await this.handle.write(
|        value,
|        offset,
|        value.length - offset,
|        null,
|      );
|      if (bytesWritten <= 0) {
|        throw new Error('Candidate snapshot writer made no progress.');
|      }
|      offset += bytesWritten;
|    }
|    this.hash.update(value);
|    this.byteLength += value.length;
|  }
|}
|
|async function atomicWrite(path: string, content: string): Promise<void> {
'''),
)
replace_once(
    snapshot,
    block('''
|function sha256Text(value: string): string {
|  return createHash('sha256').update(value).digest('hex');
|}
|
'''),
    '',
)

original = Path('scripts/run-recommendation-v8-training-supervisor.mjs').read_text()
clean = original.replace(
    "const PIPELINE_SCRIPT = process.env.TRAINING_PIPELINE_SCRIPT || '/runner/run-recommendation-v8-real-data-v2.mjs';",
    "const PIPELINE_SCRIPT = process.env.TRAINING_PIPELINE_SCRIPT || '/runner/run-recommendation-v8-diagnostic-only-pipeline.mjs';",
    1,
)
clean = clean.replace(
    block('''
|  currentStage = 'RESOLVING_HISTORICAL_CATALOG';
|  await writeStatus('RUNNING', currentStage);
|  const catalog = await resolveHistoricalCatalog(chronology.trainingWindowEnd);
'''),
    block('''
|  currentStage = 'RESOLVING_CURRENT_CATALOG_FALLBACK';
|  await writeStatus('RUNNING', currentStage, {
|    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
|    releaseEligible: false,
|  });
|  const catalog = await resolveCurrentCatalogFallback();
'''),
    1,
)
clean = clean.replace(
    block('''
|  currentStage = 'OFFLINE_V8_PIPELINE';
|  await writeStatus('RUNNING', currentStage, { resolvedConfig });
'''),
    block('''
|  currentStage = 'OFFLINE_V8_DIAGNOSTIC_PIPELINE';
|  await writeStatus('RUNNING', currentStage, {
|    resolvedConfig,
|    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
|    releaseEligible: false,
|    productionRankingChanged: false,
|    passiveShadowActivated: false,
|    randomizedCanaryAuthorized: false,
|  });
'''),
    1,
)
clean = clean.replace(
    block('''
|  currentStage = 'COMPLETE';
|  await writeStatus('COMPLETE', currentStage, {
|    resolvedConfig,
|    productionRankingChanged: false,
|    passiveShadowActivated: false,
|    randomizedCanaryAuthorized: false,
|  });
'''),
    block('''
|  currentStage = 'DIAGNOSTIC_NON_RELEASE_COMPLETE';
|  await writeStatus('DIAGNOSTIC_COMPLETE', currentStage, {
|    resolvedConfig,
|    runMode: 'DIAGNOSTIC_NON_RELEASE_CURRENT_CATALOG_FALLBACK',
|    releaseEligible: false,
|    offlineReleaseGateAccepted: false,
|    productionRankingChanged: false,
|    passiveShadowActivated: false,
|    randomizedCanaryAuthorized: false,
|  });
'''),
    1,
)
old_catalog = block('''
|async function resolveHistoricalCatalog(trainingWindowEnd) {
|  const client = new Client({
|    host: process.env.DB_HOST,
|    port: Number(process.env.DB_PORT || 5432),
|    user: process.env.DB_USER,
|    password: process.env.DB_PASSWORD,
|    database: process.env.DB_NAME,
|  });
|  await client.connect();
|  try {
|    const result = await client.query(
|      `SELECT id, "clientVersion", "contentCatalogVersionId", "importedAt", "isCurrent"
|       FROM item_catalog_versions
|       WHERE "importedAt" <= $1
|       ORDER BY "importedAt" DESC, id DESC
|       LIMIT 1`,
|      [trainingWindowEnd],
|    );
|    if (result.rows.length !== 1) {
|      throw new Error(`No historical catalog exists at or before ${trainingWindowEnd}.`);
|    }
|    const row = result.rows[0];
|    return {
|      id: Number(row.id),
|      clientVersion: String(row.clientVersion),
|      contentCatalogVersionId:
|        row.contentCatalogVersionId === null ? undefined : Number(row.contentCatalogVersionId),
|      importedAt: new Date(row.importedAt).toISOString(),
|      isCurrent: row.isCurrent === true,
|      selectionRule: 'LATEST_IMPORTED_AT_OR_BEFORE_POLICY_TRAINING_WINDOW_END',
|    };
|  } finally {
|    await client.end();
|  }
|}
''')
new_catalog = block('''
|async function resolveCurrentCatalogFallback() {
|  const client = new Client({
|    host: process.env.DB_HOST,
|    port: Number(process.env.DB_PORT || 5432),
|    user: process.env.DB_USER,
|    password: process.env.DB_PASSWORD,
|    database: process.env.DB_NAME,
|  });
|  await client.connect();
|  try {
|    const result = await client.query(
|      `SELECT id, "clientVersion", "contentCatalogVersionId", "importedAt", "isCurrent"
|       FROM item_catalog_versions
|       ORDER BY "isCurrent" DESC, "importedAt" DESC, id DESC
|       LIMIT 1`,
|    );
|    if (result.rows.length !== 1) {
|      throw new Error('No item catalog is available for the diagnostic fallback.');
|    }
|    const row = result.rows[0];
|    return {
|      id: Number(row.id),
|      clientVersion: String(row.clientVersion),
|      contentCatalogVersionId:
|        row.contentCatalogVersionId === null ? undefined : Number(row.contentCatalogVersionId),
|      importedAt: new Date(row.importedAt).toISOString(),
|      isCurrent: row.isCurrent === true,
|      selectionRule: 'CURRENT_CATALOG_FALLBACK_NON_RELEASE',
|      temporalValidationPassed: false,
|      temporalCatalogLeakageRisk: true,
|      releaseEligible: false,
|    };
|  } finally {
|    await client.end();
|  }
|}
''')
if clean.count(old_catalog) != 1:
    raise SystemExit('clean supervisor: historical catalog function was not found exactly once')
clean = clean.replace(old_catalog, new_catalog, 1)
clean = clean.replace(
    "  if (chronology.matchCount < MINIMUM_SOURCE_MATCH_COUNT) {\n",
    block('''
|  if (chronology.decisionRowCount !== source.manifest.artifact.rowCount) {
|    throw new Error(
|      `Physical Dataset V3 row count ${chronology.decisionRowCount} does not match ` +
|        `manifest row count ${source.manifest.artifact.rowCount}.`,
|    );
|  }
|  if (chronology.matchCount < MINIMUM_SOURCE_MATCH_COUNT) {
'''),
    1,
)
if clean == original:
    raise SystemExit('clean supervisor was not modified')
Path('scripts/run-recommendation-v8-clean-diagnostic-supervisor.mjs').write_text(clean)
