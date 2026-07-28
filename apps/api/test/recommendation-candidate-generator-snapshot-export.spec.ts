import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ObjectLiteral, Repository } from 'typeorm';
import type { HeroBuildDecisionDatasetV3Row } from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import { ItemCatalogItem } from '../src/deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from '../src/deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from '../src/deadlock-live/entities/item-catalog-version.entity';
import {
  validateRecommendationCandidateGeneratorSnapshotArtifact,
  type RecommendationCandidateGeneratorSnapshotArtifact,
} from '../src/deadlock-live/recommendation-candidate-generator-snapshot';
import { RecommendationCandidateGeneratorSnapshotExportService } from '../src/deadlock-live/recommendation-candidate-generator-snapshot-export.service';

const SOURCE_ENV = 'DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SOURCE_DIR';
const OUTPUT_ENV = 'DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_DIR';

describe('Recommendation candidate generator snapshot export', () => {
  let root: string;
  let previousSource: string | undefined;
  let previousOutput: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'recommendation-candidate-snapshot-'));
    previousSource = process.env[SOURCE_ENV];
    previousOutput = process.env[OUTPUT_ENV];
  });

  afterEach(async () => {
    restoreEnvironment(SOURCE_ENV, previousSource);
    restoreEnvironment(OUTPUT_ENV, previousOutput);
    await rm(root, { recursive: true, force: true });
  });

  it('exports a deterministic pro-only snapshot and registry entry', async () => {
    const sourceDirectory = join(root, 'source');
    const outputDirectory = join(root, 'snapshots');
    await mkdir(sourceDirectory, { recursive: true });
    const sourceSha256 = await writeSource(sourceDirectory);
    process.env[SOURCE_ENV] = sourceDirectory;
    process.env[OUTPUT_ENV] = outputDirectory;

    const service = new RecommendationCandidateGeneratorSnapshotExportService(
      repository({
        findOne: jest.fn().mockResolvedValue(catalogVersion()),
      }),
      repository({
        find: jest.fn().mockResolvedValue(catalogItems()),
      }),
      repository({
        find: jest.fn().mockResolvedValue(catalogRecipes()),
      }),
    );
    await service.onModuleInit();
    await service.start({
      snapshotId: 'pro-policy-20260710',
      generatorVersion: 'HERO_BUILD_CANDIDATE_GENERATOR_V1',
      policyVersion: 'policy-20260710',
      catalogVersionId: 5,
      trainingWindowStart: '2026-07-01T00:00:00.000Z',
      trainingWindowEnd: '2026-07-09T23:59:59.000Z',
      expectedSourceSha256: sourceSha256,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      selectedRowCount: 3,
      heroCount: 1,
      stateCount: 1,
      actionOptionCount: 2,
      catalogItemCount: 3,
      catalogRecipeCount: 1,
    });

    const artifactPath = join(outputDirectory, 'pro-policy-20260710.json');
    const artifact = JSON.parse(
      await readFile(artifactPath, 'utf8'),
    ) as RecommendationCandidateGeneratorSnapshotArtifact;
    expect(() =>
      validateRecommendationCandidateGeneratorSnapshotArtifact(artifact),
    ).not.toThrow();
    expect(artifact.snapshot).toMatchObject({
      snapshotId: 'pro-policy-20260710',
      catalogVersion: '999',
      trainingWindowEnd: '2026-07-09T23:59:59.000Z',
    });
    expect(artifact.policies[0].states[0].nextActions).toEqual([
      expect.objectContaining({ actionKey: 'BUY:1002', count: 2 }),
      expect.objectContaining({ actionKey: 'BUY:1003', count: 1 }),
    ]);
    expect(artifact.catalog.items.find((item) => item.itemId === 1003)).toMatchObject({
      tags: ['DAMAGE', 'WEAPON'],
      componentItemIds: [1001],
    });

    const registry = await service.getRegistry();
    expect(registry.snapshots).toEqual([
      expect.objectContaining({
        snapshotId: 'pro-policy-20260710',
        fileName: 'pro-policy-20260710.json',
        trainingWindowEnd: '2026-07-09T23:59:59.000Z',
      }),
    ]);
    expect(registry.snapshots[0].artifactSha256).toBe(
      sha256(await readFile(artifactPath, 'utf8')),
    );

    const audit = JSON.parse(
      await readFile(
        join(outputDirectory, 'pro-policy-20260710.audit.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(audit).toMatchObject({
      passed: true,
      provenance: {
        dataSource: 'PRO_HISTORICAL',
        userLiveUsedAsInput: false,
        v5_3UsedAsInput: false,
      },
      source: {
        selectedRowCount: 3,
        invalidSourceRowCount: 0,
      },
    });
  });
});

async function writeSource(directory: string): Promise<string> {
  const rows = [
    decision('decision-1', 1, 10, 'BUY:1002', 1002, 300),
    decision('decision-2', 2, 20, 'BUY:1002', 1002, 340),
    decision('decision-3', 3, 30, 'BUY:1003', 1003, 360),
  ];
  const dataset = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const datasetSha256 = sha256(dataset);
  await Promise.all([
    writeFile(join(directory, 'dataset.ndjson'), dataset, 'utf8'),
    writeJson(join(directory, 'manifest.json'), {
      schemaVersion: 1,
      datasetVersion: 'CONTEXTUAL_V3_DECISION_DATASET_1',
      artifact: {
        fileName: 'dataset.ndjson',
        rowCount: rows.length,
        sha256: datasetSha256,
      },
      auditPassed: true,
    }),
    writeJson(join(directory, 'audit.json'), {
      schemaVersion: 1,
      passed: true,
    }),
  ]);
  return datasetSha256;
}

function decision(
  decisionId: string,
  matchId: number,
  playerId: number,
  actionKey: string,
  itemId: number,
  gameTimeS: number,
): HeroBuildDecisionDatasetV3Row {
  return {
    schemaVersion: 1,
    decisionId,
    matchId,
    matchStartTime: '2026-07-05T12:00:00.000Z',
    playerId,
    heroId: 1,
    team: 0,
    gameTimeS,
    phase: 'EARLY',
    inventoryBeforeStateKey: '1001x1',
    inventoryAfterStateKey: `1001x1|${itemId}x1`,
    previousActionKeys: ['BUY:1001'],
    buildPrefixKey: 'BUY:1001',
    alliedHeroIds: [1, 2, 3, 4, 5, 6],
    enemyHeroIds: [7, 8, 9, 10, 11, 12],
    actualActionType: 'BUY',
    actualItemId: itemId,
    actualActionKey: actionKey,
    outcomeLabel: { playerWon: true },
  };
}

function catalogVersion(): ItemCatalogVersion {
  return Object.assign(new ItemCatalogVersion(), {
    id: 5,
    clientVersion: 999,
    contentCatalogVersionId: 4,
    source: 'TEST',
    payloadHash: 'catalog-hash',
    isCurrent: false,
    importedAt: new Date('2026-07-01T00:00:00.000Z'),
  });
}

function catalogItems(): ItemCatalogItem[] {
  return [
    item(1001, ['COMPONENT']),
    item(1002, ['VITALITY']),
    item(1003, ['WEAPON', 'DAMAGE']),
  ];
}

function item(itemId: number, tags: string[]): ItemCatalogItem {
  return Object.assign(new ItemCatalogItem(), {
    id: itemId,
    catalogVersionId: 4,
    itemId,
    name: `Item ${itemId}`,
    className: `item_${itemId}`,
    itemType: 'UPGRADE',
    slotType: 'WEAPON',
    cost: 1_250,
    tier: 2,
    shopable: true,
    disabled: false,
    active: true,
    isActiveItem: false,
    activationType: '',
    rawPayload: { tags },
  });
}

function catalogRecipes(): ItemCatalogRecipe[] {
  return [
    Object.assign(new ItemCatalogRecipe(), {
      id: 1,
      catalogVersionId: 4,
      parentItemId: 1003,
      componentItemId: 1001,
      componentOrder: 0,
    }),
  ];
}

function repository<T extends ObjectLiteral>(
  methods: Partial<Repository<T>>,
): Repository<T> {
  return methods as Repository<T>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
