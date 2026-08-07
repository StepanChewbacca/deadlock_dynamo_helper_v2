from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one occurrence, found {count}')
    return text.replace(old, new, 1)


def replace_between(
    text: str,
    start_marker: str,
    end_marker: str,
    replacement: str,
    label: str,
) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker not found')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{label}: end marker not found')
    return text[:start] + replacement + text[end:]


stable_path = Path('apps/api/src/deadlock-live/stable-json.ts')
stable = stable_path.read_text()
stable = replace_once(
    stable,
    'function updateStableJsonHash(hash: Hash, value: unknown): void {',
    'export function updateStableJsonHash(hash: Hash, value: unknown): void {',
    'export stable hash updater',
)
stable_path.write_text(stable)


snapshot_path = Path(
    'apps/api/src/deadlock-live/recommendation-candidate-generator-snapshot.ts'
)
snapshot = snapshot_path.read_text()

metadata_block = '''export type RecommendationCandidateGeneratorSnapshotMetadata = Omit<
  RecommendationCandidateGeneratorSnapshotArtifact,
  'policies'
>;

export interface RecommendationPreparedHeroBuildPolicy {
  heroId: number;
  policy: HeroBuildPolicy;
  parsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
}

'''
snapshot = replace_once(
    snapshot,
    'export interface RecommendationCandidateGeneratorSnapshotRegistryEntry {',
    metadata_block + 'export interface RecommendationCandidateGeneratorSnapshotRegistryEntry {',
    'insert snapshot metadata types',
)

metadata_validator = '''export function validateRecommendationCandidateGeneratorSnapshotMetadata(
  artifact: RecommendationCandidateGeneratorSnapshotMetadata,
): void {
  if (
    artifact.schemaVersion !==
      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION ||
    artifact.artifactVersion !==
      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION
  ) {
    throw new Error('Unsupported recommendation candidate generator snapshot.');
  }
  validateSnapshotIdentity(artifact.snapshot);
  validateGeneratorOptions(artifact.generatorOptions);
  if (
    !artifact.catalog ||
    !Array.isArray(artifact.catalog.items) ||
    !artifact.catalog.version.trim()
  ) {
    throw new Error('Candidate generator snapshot catalog is invalid.');
  }
  if (artifact.catalog.version !== artifact.snapshot.catalogVersion) {
    throw new Error('Candidate generator snapshot catalog version does not match metadata.');
  }
  const normalizedCatalog = normalizeCatalogItems(artifact.catalog.items);
  const itemIds = new Set<number>();
  for (const item of normalizedCatalog) {
    if (itemIds.has(item.itemId)) {
      throw new Error(`Candidate generator snapshot duplicates item ${item.itemId}.`);
    }
    itemIds.add(item.itemId);
  }
}

'''
snapshot = replace_once(
    snapshot,
    'export function validateRecommendationCandidateGeneratorSnapshotArtifact(',
    metadata_validator
    + 'export function validateRecommendationCandidateGeneratorSnapshotArtifact(',
    'insert metadata validator',
)

new_generation_block = '''export function generateRecommendationHistoricalCandidatesFromValidatedSnapshot(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  artifact: RecommendationCandidateGeneratorSnapshotArtifact;
}): RecommendationHistoricalCandidateInput[] {
  const policyValue = input.artifact.policies.find(
    (policy) => policy.heroId === input.decision.heroId,
  );
  return generateRecommendationHistoricalCandidatesFromPreparedPolicy({
    decision: input.decision,
    snapshot: input.artifact.snapshot,
    generatorOptions: input.artifact.generatorOptions,
    catalog: input.artifact.catalog,
    policy: policyValue
      ? prepareRecommendationSerializedHeroBuildPolicy(policyValue)
      : undefined,
  });
}

export function validateRecommendationSerializedHeroBuildPolicy(
  value: RecommendationSerializedHeroBuildPolicy,
): void {
  validateSerializedPolicy(value);
}

export function prepareRecommendationSerializedHeroBuildPolicy(
  value: RecommendationSerializedHeroBuildPolicy,
): RecommendationPreparedHeroBuildPolicy {
  validateRecommendationSerializedHeroBuildPolicy(value);
  const policy = deserializePolicy(value);
  const parsedStates = [...policy.statesByKey.values()]
    .map((state) => ({
      state,
      itemCounts: parseInventoryStateKey(state.stateKey),
    }))
    .filter(
      (
        item,
      ): item is {
        state: HeroBuildPolicyState;
        itemCounts: ReadonlyMap<number, number>;
      } => item.itemCounts !== undefined,
    );
  return {
    heroId: value.heroId,
    policy,
    parsedStates,
  };
}

export function generateRecommendationHistoricalCandidatesFromPreparedPolicy(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot;
  generatorOptions: HeroBuildRecommendationOptions;
  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];
  policy?: RecommendationPreparedHeroBuildPolicy;
  componentsByParent?: ReadonlyMap<number, number[]>;
}): RecommendationHistoricalCandidateInput[] {
  const matchTime = requiredTimestamp(
    input.decision.matchStartTime,
    'decision.matchStartTime',
  );
  const trainingEnd = requiredTimestamp(
    input.snapshot.trainingWindowEnd,
    'trainingWindowEnd',
  );
  if (trainingEnd >= matchTime) {
    throw new Error(
      'Candidate generator snapshot training window must end before the replay match.',
    );
  }
  if (!input.policy) {
    return [];
  }
  if (input.policy.heroId !== input.decision.heroId) {
    throw new Error('Prepared candidate policy hero does not match the replay decision.');
  }

  const inventory = parseInventoryStateKey(
    input.decision.inventoryBeforeStateKey,
  );
  if (!inventory) {
    throw new Error(
      `Invalid replay inventory state ${input.decision.inventoryBeforeStateKey}.`,
    );
  }
  const itemIds = [...inventory.entries()].flatMap(([itemId, count]) =>
    Array.from({ length: count }, () => itemId),
  );
  const componentsByParent =
    input.componentsByParent ??
    new Map<number, number[]>(
      input.catalog.items.map((item) => [
        item.itemId,
        [...item.componentItemIds],
      ]),
    );
  const response = recommendFromPolicy(
    {
      heroId: input.decision.heroId,
      itemIds,
      gameTimeS: input.decision.gameTimeS,
      limit: input.generatorOptions.limit,
    },
    input.decision.inventoryBeforeStateKey,
    input.policy.policy,
    input.policy.parsedStates,
    (parentItemId) => componentsByParent.get(parentItemId) ?? [],
    normalizeGeneratorOptions(input.generatorOptions),
  );
  return candidateActionsFromRecommendationResponse(response);
}

'''
snapshot = replace_between(
    snapshot,
    'export function generateRecommendationHistoricalCandidatesFromValidatedSnapshot',
    'export function createRecommendationCandidateGeneratorSnapshotArtifact',
    new_generation_block,
    'replace candidate generation block',
)
snapshot_path.write_text(snapshot)


replay_path = Path(
    'apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts'
)
replay = replay_path.read_text()
replay = replace_once(
    replay,
    "import { createHash } from 'node:crypto';",
    "import { createHash, type Hash } from 'node:crypto';",
    'import Hash type',
)
replay = replace_once(
    replay,
    "import { createInterface } from 'node:readline';",
    "import { createInterface } from 'node:readline';\nimport { StringDecoder } from 'node:string_decoder';",
    'import StringDecoder',
)
old_snapshot_import = '''import {
  generateRecommendationHistoricalCandidatesFromValidatedSnapshot,
  validateRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotRegistry,
} from './recommendation-candidate-generator-snapshot';'''
new_snapshot_import = '''import {
  generateRecommendationHistoricalCandidatesFromPreparedPolicy,
  prepareRecommendationSerializedHeroBuildPolicy,
  validateRecommendationCandidateGeneratorSnapshotMetadata,
  validateRecommendationSerializedHeroBuildPolicy,
  type RecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotRegistry,
  type RecommendationCandidateGeneratorSnapshotRegistryEntry,
  type RecommendationPreparedHeroBuildPolicy,
  type RecommendationSerializedHeroBuildPolicy,
} from './recommendation-candidate-generator-snapshot';'''
replay = replace_once(
    replay,
    old_snapshot_import,
    new_snapshot_import,
    'replace snapshot imports',
)
replay = replace_once(
    replay,
    "import { sha256StableJson } from './stable-json';",
    "import { sha256StableJson, updateStableJsonHash } from './stable-json';",
    'import stable hash updater',
)

replay = replace_once(
    replay,
    '''  sourceParts: string;
  outputParts: string;
  partStats: string;
}''',
    '''  sourceParts: string;
  outputParts: string;
  partStats: string;
  snapshotCache: string;
}''',
    'add snapshot cache path',
)

old_bundle = '''interface SnapshotBundle {
  registrySha256: string;
  artifacts: RecommendationCandidateGeneratorSnapshotArtifact[];
}'''
new_bundle = '''interface PreparedCandidateGeneratorSnapshotArtifact {
  schemaVersion: RecommendationCandidateGeneratorSnapshotArtifact['schemaVersion'];
  artifactVersion: RecommendationCandidateGeneratorSnapshotArtifact['artifactVersion'];
  snapshot: RecommendationCandidateGeneratorSnapshotArtifact['snapshot'];
  generatorOptions: RecommendationCandidateGeneratorSnapshotArtifact['generatorOptions'];
  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];
  policyPathsByHeroId: ReadonlyMap<number, string>;
  componentsByParent: ReadonlyMap<number, number[]>;
}

interface SnapshotBundle {
  registrySha256: string;
  artifacts: PreparedCandidateGeneratorSnapshotArtifact[];
}'''
replay = replace_once(replay, old_bundle, new_bundle, 'replace snapshot bundle type')

replay = replace_once(
    replay,
    '''      const snapshots = await loadSnapshotBundle(
        this.snapshotRegistryPath,
        options.expectedSnapshotRegistrySha256,
      );''',
    '''      const snapshots = await loadSnapshotBundle(
        this.snapshotRegistryPath,
        options.expectedSnapshotRegistrySha256,
        this.paths.snapshotCache,
      );''',
    'pass snapshot cache path',
)
replay = replace_once(
    replay,
    '''        maxRows: options.maxRows,
        thresholds: options.thresholds,
      });''',
    '''        maxRows: options.maxRows,
        thresholds: options.thresholds,
        partitionStrategy: 'HERO_ID_HASH_V2',
      });''',
    'version replay partition strategy',
)
replay = replace_once(
    replay,
    '''      await rm(this.paths.work, { recursive: true, force: true });''',
    '''      await Promise.all([
        rm(this.paths.work, { recursive: true, force: true }),
        rm(this.paths.snapshotCache, { recursive: true, force: true }),
      ]);''',
    'remove snapshot cache after completion',
)

new_loader = r'''async function loadSnapshotBundle(
  registryPath: string,
  expectedSha256: string | undefined,
  cacheRoot: string,
): Promise<SnapshotBundle> {
  const raw = await readFile(registryPath, 'utf8');
  const registrySha256 = createHash('sha256').update(raw).digest('hex');
  if (expectedSha256 && expectedSha256 !== registrySha256) {
    throw new Error(
      `Candidate generator registry SHA-256 mismatch: ${registrySha256} ` +
        `versus ${expectedSha256}.`,
    );
  }
  const registry = JSON.parse(
    raw,
  ) as RecommendationCandidateGeneratorSnapshotRegistry;
  if (
    registry.schemaVersion !== 1 ||
    registry.registryVersion !==
      'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_1' ||
    !Array.isArray(registry.snapshots) ||
    registry.snapshots.length === 0
  ) {
    throw new Error('Invalid candidate generator snapshot registry.');
  }

  await rm(cacheRoot, { recursive: true, force: true });
  await mkdir(cacheRoot, { recursive: true });
  const artifacts: PreparedCandidateGeneratorSnapshotArtifact[] = [];
  const snapshotIds = new Set<string>();
  for (const entry of registry.snapshots) {
    if (
      basename(entry.fileName) !== entry.fileName ||
      entry.fileName.includes('..')
    ) {
      throw new Error('Snapshot registry fileName must be a local file name.');
    }
    const cacheDirectory = join(
      cacheRoot,
      createHash('sha256').update(entry.snapshotId).digest('hex').slice(0, 16),
    );
    const artifact = await loadPreparedSnapshotArtifact({
      path: join(dirname(registryPath), entry.fileName),
      entry,
      cacheDirectory,
    });
    if (snapshotIds.has(artifact.snapshot.snapshotId)) {
      throw new Error(
        `Candidate generator registry duplicates ${artifact.snapshot.snapshotId}.`,
      );
    }
    snapshotIds.add(artifact.snapshot.snapshotId);
    artifacts.push(artifact);
  }
  artifacts.sort(
    (left, right) =>
      Date.parse(left.snapshot.trainingWindowEnd) -
        Date.parse(right.snapshot.trainingWindowEnd) ||
      left.snapshot.snapshotId.localeCompare(right.snapshot.snapshotId),
  );
  return { registrySha256, artifacts };
}

async function loadPreparedSnapshotArtifact(input: {
  path: string;
  entry: RecommendationCandidateGeneratorSnapshotRegistryEntry;
  cacheDirectory: string;
}): Promise<PreparedCandidateGeneratorSnapshotArtifact> {
  await rm(input.cacheDirectory, { recursive: true, force: true });
  await mkdir(input.cacheDirectory, { recursive: true });

  const artifactHash = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  const policyPathsByHeroId = new Map<number, string>();
  let mode: 'HEADER' | 'POLICIES' | 'TAIL' = 'HEADER';
  let headerBuffer = '';
  let tailBuffer = '';
  let policyBuffer = '';
  let policyDepth = 0;
  let policyInString = false;
  let policyEscaped = false;
  let policyCount = 0;
  let header:
    | Pick<
        RecommendationCandidateGeneratorSnapshotArtifact,
        'schemaVersion' | 'artifactVersion' | 'snapshot' | 'generatorOptions'
      >
    | undefined;
  let policyHash: Hash | undefined;

  const storePolicy = async (): Promise<void> => {
    const serialized = JSON.parse(
      policyBuffer,
    ) as RecommendationSerializedHeroBuildPolicy;
    validateRecommendationSerializedHeroBuildPolicy(serialized);
    if (policyPathsByHeroId.has(serialized.heroId)) {
      throw new Error(
        `Candidate generator snapshot duplicates hero ${serialized.heroId}.`,
      );
    }
    const policyPath = join(
      input.cacheDirectory,
      `hero-${serialized.heroId}.json`,
    );
    await writeFile(policyPath, `${policyBuffer}\n`, 'utf8');
    policyPathsByHeroId.set(serialized.heroId, policyPath);
    if (!policyHash) {
      throw new Error('Candidate generator policy hash was not initialized.');
    }
    if (policyCount > 0) {
      policyHash.update(',');
    }
    updateStableJsonHash(policyHash, serialized);
    policyCount += 1;
    policyBuffer = '';
  };

  const consume = async (initialText: string): Promise<void> => {
    let text = initialText;
    let index = 0;
    while (index < text.length) {
      if (mode === 'HEADER') {
        headerBuffer += text.slice(index);
        headerBuffer = headerBuffer.replace(/^\uFEFF/, '');
        const match = /"policies"\s*:\s*\[/.exec(headerBuffer);
        if (!match) {
          if (Buffer.byteLength(headerBuffer) > 16 * 1024 * 1024) {
            throw new Error('Candidate snapshot header exceeds 16 MiB.');
          }
          return;
        }
        const headerRaw =
          `${headerBuffer.slice(0, match.index)}"policies":[]}`;
        const parsed = JSON.parse(headerRaw) as Pick<
          RecommendationCandidateGeneratorSnapshotArtifact,
          'schemaVersion' | 'artifactVersion' | 'snapshot' | 'generatorOptions'
        >;
        header = parsed;
        policyHash = createHash('sha256');
        policyHash.update('{"generatorOptions":');
        updateStableJsonHash(policyHash, parsed.generatorOptions);
        policyHash.update(',"policies":[');
        text = headerBuffer.slice(match.index + match[0].length);
        headerBuffer = '';
        mode = 'POLICIES';
        index = 0;
        continue;
      }

      if (mode === 'TAIL') {
        tailBuffer += text.slice(index);
        return;
      }

      const character = text[index];
      index += 1;
      if (policyDepth === 0) {
        if (/\s/.test(character) || character === ',') {
          continue;
        }
        if (character === ']') {
          mode = 'TAIL';
          tailBuffer += text.slice(index);
          return;
        }
        if (character !== '{') {
          throw new Error(
            `Unexpected token ${JSON.stringify(character)} in snapshot policies.`,
          );
        }
        policyBuffer = character;
        policyDepth = 1;
        policyInString = false;
        policyEscaped = false;
        continue;
      }

      policyBuffer += character;
      if (policyInString) {
        if (policyEscaped) {
          policyEscaped = false;
        } else if (character === '\\') {
          policyEscaped = true;
        } else if (character === '"') {
          policyInString = false;
        }
        continue;
      }
      if (character === '"') {
        policyInString = true;
      } else if (character === '{' || character === '[') {
        policyDepth += 1;
      } else if (character === '}' || character === ']') {
        policyDepth -= 1;
        if (policyDepth === 0) {
          await storePolicy();
        }
      }
    }
  };

  for await (const chunk of createReadStream(input.path)) {
    const bytes = chunk as Buffer;
    artifactHash.update(bytes);
    await consume(decoder.write(bytes));
  }
  await consume(decoder.end());

  if (!header || !policyHash || mode !== 'TAIL' || policyDepth !== 0) {
    throw new Error('Candidate generator snapshot ended before parsing completed.');
  }
  if (policyCount === 0) {
    throw new Error('Candidate generator snapshot contains no hero policies.');
  }
  policyHash.update(']}');
  const actualPolicySha256 = policyHash.digest('hex');

  const tail = tailBuffer.trim();
  if (!tail.startsWith(',')) {
    throw new Error('Candidate generator snapshot catalog tail is invalid.');
  }
  const parsedTail = JSON.parse(`{${tail.slice(1)}`) as {
    catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];
  };
  const metadata = {
    ...header,
    catalog: parsedTail.catalog,
  };
  validateRecommendationCandidateGeneratorSnapshotMetadata(metadata);

  const artifactSha256 = artifactHash.digest('hex');
  if (
    artifactSha256 !== requiredSha(input.entry.artifactSha256, 'artifactSha256')
  ) {
    throw new Error(
      `Candidate generator artifact ${input.entry.fileName} SHA-256 mismatch.`,
    );
  }
  if (actualPolicySha256 !== metadata.snapshot.policySha256) {
    throw new Error(
      `Candidate generator policy SHA-256 mismatch: ${actualPolicySha256} versus ` +
        `${metadata.snapshot.policySha256}.`,
    );
  }
  const actualCatalogSha256 = sha256StableJson({
    version: metadata.catalog.version,
    items: metadata.catalog.items,
  });
  if (actualCatalogSha256 !== metadata.snapshot.catalogSha256) {
    throw new Error(
      `Candidate generator catalog SHA-256 mismatch: ${actualCatalogSha256} versus ` +
        `${metadata.snapshot.catalogSha256}.`,
    );
  }
  if (
    metadata.snapshot.snapshotId !== input.entry.snapshotId ||
    metadata.snapshot.trainingWindowEnd !== input.entry.trainingWindowEnd
  ) {
    throw new Error(
      `Candidate generator registry metadata does not match ${input.entry.fileName}.`,
    );
  }

  return {
    ...metadata,
    policyPathsByHeroId,
    componentsByParent: new Map<number, number[]>(
      metadata.catalog.items.map((item) => [
        item.itemId,
        [...item.componentItemIds],
      ]),
    ),
  };
}

'''
replay = replace_between(
    replay,
    'async function loadSnapshotBundle(',
    'async function partitionSource(',
    new_loader,
    'replace snapshot bundle loader',
)

replay = replace_once(
    replay,
    '''      const partition = partitionIndex(
        String(row.matchId),
        input.partitionCount,
      );''',
    '''      const partition = partitionIndex(
        String(row.heroId),
        input.partitionCount,
      );''',
    'partition replay by hero',
)
replay = replace_once(
    replay,
    '''      await handle.write(`${JSON.stringify(row)}\n`);''',
    '''      await writeAll(
        handle,
        Buffer.from(`${JSON.stringify(row)}\n`, 'utf8'),
      );''',
    'write source partition completely',
)
replay = replace_once(
    replay,
    '''  snapshots: readonly RecommendationCandidateGeneratorSnapshotArtifact[];''',
    '''  snapshots: readonly PreparedCandidateGeneratorSnapshotArtifact[];''',
    'use prepared snapshot descriptors',
)
replay = replace_once(
    replay,
    '''  const catalogBySnapshotId = new Map<
    string,
    ReadonlyMap<number, RecommendationHistoricalCatalogItem>
  >();''',
    '''  const catalogBySnapshotId = new Map<
    string,
    ReadonlyMap<number, RecommendationHistoricalCatalogItem>
  >();
  const preparedPolicyCache = new Map<
    string,
    RecommendationPreparedHeroBuildPolicy
  >();''',
    'add prepared policy cache',
)
replay = replace_once(
    replay,
    '''      const candidates =
        generateRecommendationHistoricalCandidatesFromValidatedSnapshot({
          decision: row,
          artifact: snapshot,
        });''',
    '''      const policy = await loadPreparedPolicy(
        snapshot,
        row.heroId,
        preparedPolicyCache,
      );
      const candidates =
        generateRecommendationHistoricalCandidatesFromPreparedPolicy({
          decision: row,
          snapshot: snapshot.snapshot,
          generatorOptions: snapshot.generatorOptions,
          catalog: snapshot.catalog,
          policy,
          componentsByParent: snapshot.componentsByParent,
        });''',
    'generate from prepared policy',
)

prepared_policy_loader = '''async function loadPreparedPolicy(
  snapshot: PreparedCandidateGeneratorSnapshotArtifact,
  heroId: number,
  cache: Map<string, RecommendationPreparedHeroBuildPolicy>,
): Promise<RecommendationPreparedHeroBuildPolicy | undefined> {
  const path = snapshot.policyPathsByHeroId.get(heroId);
  if (!path) {
    return undefined;
  }
  const key = `${snapshot.snapshot.snapshotId}:${heroId}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const serialized = JSON.parse(
    await readFile(path, 'utf8'),
  ) as RecommendationSerializedHeroBuildPolicy;
  const prepared = prepareRecommendationSerializedHeroBuildPolicy(serialized);
  if (cache.size >= 4) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) {
      cache.delete(oldest);
    }
  }
  cache.set(key, prepared);
  return prepared;
}

'''
replay = replace_once(
    replay,
    'function selectValidatedCandidateGeneratorSnapshot(',
    prepared_policy_loader + 'function selectValidatedCandidateGeneratorSnapshot(',
    'insert prepared policy loader',
)
replay = replace_once(
    replay,
    '''  artifacts: readonly RecommendationCandidateGeneratorSnapshotArtifact[],
  matchStartTime: string,
): RecommendationCandidateGeneratorSnapshotArtifact | undefined {''',
    '''  artifacts: readonly PreparedCandidateGeneratorSnapshotArtifact[],
  matchStartTime: string,
): PreparedCandidateGeneratorSnapshotArtifact | undefined {''',
    'update snapshot selection types',
)
replay = replace_once(
    replay,
    '''  let selected: RecommendationCandidateGeneratorSnapshotArtifact | undefined;''',
    '''  let selected: PreparedCandidateGeneratorSnapshotArtifact | undefined;''',
    'update selected snapshot type',
)
replay = replace_once(
    replay,
    '''        await output.write(chunk as Buffer);''',
    '''        await writeAll(output, chunk as Buffer);''',
    'combine replay parts completely',
)
replay = replace_once(
    replay,
    '''      if (totals.invalidSourceRowCount > 0) {''',
    '''      if (coreAudit.rowCount !== totals.outputRowCount) {
        additionalReasons.push(
          'Physical replay row count does not match partition output totals.',
        );
      }
      if (totals.invalidSourceRowCount > 0) {''',
    'audit physical replay row count',
)
replay = replace_once(
    replay,
    '''    partStats: join(work, 'part-stats'),
  };''',
    '''    partStats: join(work, 'part-stats'),
    snapshotCache: join(outputDirectory, 'snapshot-cache'),
  };''',
    'create snapshot cache path',
)

write_all_helper = '''async function writeAll(handle: FileHandle, value: Buffer): Promise<void> {
  let offset = 0;
  while (offset < value.length) {
    const { bytesWritten } = await handle.write(
      value,
      offset,
      value.length - offset,
      null,
    );
    if (bytesWritten <= 0) {
      throw new Error('Replay writer made no progress while writing.');
    }
    offset += bytesWritten;
  }
}

'''
replay = replace_once(
    replay,
    'async function hashFile(path: string): Promise<string> {',
    write_all_helper + 'async function hashFile(path: string): Promise<string> {',
    'insert complete write helper',
)
replay = replace_once(
    replay,
    '''    await this.handle.write(this.buffer);
    this.buffer = '';''',
    '''    const value = Buffer.from(this.buffer, 'utf8');
    this.buffer = '';
    await writeAll(this.handle, value);''',
    'flush replay line writer completely',
)
replay_path.write_text(replay)
