import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import {
  CatalogImportVersionResult,
  ItemCatalogImportService,
} from './item-catalog-import.service';

const DEFAULT_HISTORY_IMPORT_LIMIT = 5;
const MAX_HISTORY_IMPORT_LIMIT = 25;

export class ImportHistoricalCatalogBatchDto {
  limit?: number;
  beforeClientVersion?: number;
  language?: string;
  force?: boolean;
  continueOnError?: boolean;
}

export interface HistoricalCatalogImportFailure {
  clientVersion: number;
  error: string;
}

export interface HistoricalCatalogBackfillPlan {
  clientVersions: number[];
  nextBeforeClientVersion: number;
  remainingAfterBatch: number;
  hasMore: boolean;
}

@Injectable()
export class HistoricalCatalogBackfillService {
  constructor(
    @InjectRepository(ItemCatalogVersion)
    private readonly catalogVersionRepository: Repository<ItemCatalogVersion>,
    private readonly itemCatalogImportService: ItemCatalogImportService,
  ) {}

  async getStatus() {
    const [availableVersions, catalogs] = await Promise.all([
      this.itemCatalogImportService.getAvailableClientVersions(),
      this.catalogVersionRepository.find({ order: { clientVersion: 'ASC' } }),
    ]);
    const importedVersions = catalogs.map((catalog) => Number(catalog.clientVersion));
    const importedSet = new Set(importedVersions);
    const missingVersions = availableVersions.filter((version) => !importedSet.has(version));

    return {
      availableVersionCount: availableVersions.length,
      importedVersionCount: importedVersions.length,
      missingVersionCount: missingVersions.length,
      latestAvailableClientVersion: availableVersions[availableVersions.length - 1],
      newestMissingClientVersion: missingVersions[missingVersions.length - 1],
      oldestMissingClientVersion: missingVersions[0],
      oldestImportedClientVersion: importedVersions[0],
      newestImportedClientVersion: importedVersions[importedVersions.length - 1],
      nextBeforeClientVersion:
        missingVersions.length > 0 ? missingVersions[missingVersions.length - 1] + 1 : undefined,
    };
  }

  async importBatch(dto: ImportHistoricalCatalogBatchDto = {}) {
    const [availableVersions, catalogs] = await Promise.all([
      this.itemCatalogImportService.getAvailableClientVersions(),
      this.catalogVersionRepository.find({ order: { clientVersion: 'ASC' } }),
    ]);
    const importedVersions = catalogs.map((catalog) => Number(catalog.clientVersion));
    const limit = normalizeHistoricalCatalogImportLimit(dto.limit);
    const plan = buildHistoricalCatalogBackfillPlan(
      availableVersions,
      importedVersions,
      dto.beforeClientVersion,
      limit,
    );
    const imported: CatalogImportVersionResult[] = [];
    const failures: HistoricalCatalogImportFailure[] = [];
    const attemptedVersions: number[] = [];
    let nextBeforeClientVersion = plan.nextBeforeClientVersion;

    for (const clientVersion of plan.clientVersions) {
      attemptedVersions.push(clientVersion);
      try {
        const result = await this.itemCatalogImportService.importCatalogs({
          clientVersions: [clientVersion],
          language: dto.language,
          force: dto.force,
        });
        const importedVersion = result.imported[0];
        if (!importedVersion) {
          throw new Error(`Catalog import returned no result for client version ${clientVersion}`);
        }
        imported.push(importedVersion);
        nextBeforeClientVersion = clientVersion;
      } catch (error) {
        failures.push({
          clientVersion,
          error: (error as Error).message,
        });
        if (dto.continueOnError !== true) {
          nextBeforeClientVersion = clientVersion + 1;
          break;
        }
        nextBeforeClientVersion = clientVersion;
      }
    }

    const remainingAfterBatch =
      plan.remainingAfterBatch + Math.max(0, plan.clientVersions.length - imported.length);

    return {
      requestedLimit: limit,
      processed: attemptedVersions.length,
      imported: imported.filter((entry) => !entry.skipped).length,
      verified: imported.filter((entry) => entry.skipped).length,
      failed: failures.length,
      attemptedClientVersions: attemptedVersions,
      nextBeforeClientVersion,
      hasMore: remainingAfterBatch > 0,
      remainingAfterBatch,
      retryClientVersions: failures.map((failure) => failure.clientVersion),
      results: imported,
      failures,
    };
  }
}

export function buildHistoricalCatalogBackfillPlan(
  availableVersions: number[],
  importedVersions: number[],
  beforeClientVersion: number | undefined,
  limit: number,
): HistoricalCatalogBackfillPlan {
  const available = normalizeVersions(availableVersions);
  const imported = new Set(normalizeVersions(importedVersions));
  const cursor = normalizePositiveInteger(beforeClientVersion) ?? Number.POSITIVE_INFINITY;
  const missing = available
    .filter((version) => version < cursor && !imported.has(version))
    .sort((left, right) => right - left);
  const clientVersions = missing.slice(0, limit);
  const nextBeforeClientVersion =
    clientVersions.length > 0
      ? clientVersions[clientVersions.length - 1]
      : Number.isFinite(cursor)
        ? cursor
        : (available[available.length - 1] ?? 0) + 1;

  return {
    clientVersions,
    nextBeforeClientVersion,
    remainingAfterBatch: Math.max(0, missing.length - clientVersions.length),
    hasMore: missing.length > clientVersions.length,
  };
}

export function normalizeHistoricalCatalogImportLimit(value: number | undefined): number {
  const normalized = normalizePositiveInteger(value) ?? DEFAULT_HISTORY_IMPORT_LIMIT;
  return Math.min(normalized, MAX_HISTORY_IMPORT_LIMIT);
}

function normalizeVersions(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))].sort(
    (left, right) => left - right,
  );
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
