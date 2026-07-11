import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GameRuleset } from './entities/game-ruleset.entity';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import {
  getCatalogContentVersionId,
  ItemCatalogVersion,
} from './entities/item-catalog-version.entity';

export interface CatalogContentDeduplicationResult {
  catalogVersionId: number;
  contentCatalogVersionId: number;
  deduplicated: boolean;
  itemCount: number;
  recipeCount: number;
}

@Injectable()
export class CatalogContentService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ItemCatalogVersion)
    private readonly catalogVersionRepository: Repository<ItemCatalogVersion>,
    @InjectRepository(ItemCatalogItem)
    private readonly catalogItemRepository: Repository<ItemCatalogItem>,
    @InjectRepository(ItemCatalogRecipe)
    private readonly catalogRecipeRepository: Repository<ItemCatalogRecipe>,
    @InjectRepository(GameRuleset)
    private readonly rulesetRepository: Repository<GameRuleset>,
  ) {}

  async resolveContentCatalogVersionId(catalogVersionId: number): Promise<number> {
    const catalog = await this.catalogVersionRepository.findOne({
      where: { id: catalogVersionId },
    });
    if (!catalog) {
      throw new Error(`No item catalog exists with id ${catalogVersionId}`);
    }
    return getCatalogContentVersionId(catalog);
  }

  async deduplicateCatalogVersion(
    catalogVersionId: number,
  ): Promise<CatalogContentDeduplicationResult> {
    return this.dataSource.transaction(async (manager) => {
      const versionRepository = manager.getRepository(ItemCatalogVersion);
      const itemRepository = manager.getRepository(ItemCatalogItem);
      const recipeRepository = manager.getRepository(ItemCatalogRecipe);
      const catalog = await versionRepository.findOne({ where: { id: catalogVersionId } });
      if (!catalog) {
        throw new Error(`No item catalog exists with id ${catalogVersionId}`);
      }

      const canonical = catalog.payloadHash
        ? await versionRepository.findOne({
            where: { payloadHash: catalog.payloadHash },
            order: { id: 'ASC' },
          })
        : undefined;

      if (!canonical || canonical.id === catalog.id) {
        if (catalog.contentCatalogVersionId) {
          catalog.contentCatalogVersionId = null as unknown as number;
          await versionRepository.save(catalog);
        }
        const [itemCount, recipeCount] = await Promise.all([
          itemRepository.count({ where: { catalogVersionId: catalog.id } }),
          recipeRepository.count({ where: { catalogVersionId: catalog.id } }),
        ]);
        return {
          catalogVersionId: catalog.id,
          contentCatalogVersionId: catalog.id,
          deduplicated: false,
          itemCount,
          recipeCount,
        };
      }

      const contentCatalogVersionId = getCatalogContentVersionId(canonical);
      catalog.contentCatalogVersionId = contentCatalogVersionId;
      await versionRepository.save(catalog);
      await recipeRepository.delete({ catalogVersionId: catalog.id });
      await itemRepository.delete({ catalogVersionId: catalog.id });
      const [itemCount, recipeCount] = await Promise.all([
        itemRepository.count({ where: { catalogVersionId: contentCatalogVersionId } }),
        recipeRepository.count({ where: { catalogVersionId: contentCatalogVersionId } }),
      ]);

      return {
        catalogVersionId: catalog.id,
        contentCatalogVersionId,
        deduplicated: true,
        itemCount,
        recipeCount,
      };
    });
  }

  async listCatalogs() {
    const catalogs = await this.catalogVersionRepository.find({
      order: { clientVersion: 'DESC' },
    });

    return Promise.all(
      catalogs.map(async (catalog) => {
        const contentCatalogVersionId = getCatalogContentVersionId(catalog);
        const [itemCount, recipeCount, ruleset] = await Promise.all([
          this.catalogItemRepository.count({ where: { catalogVersionId: contentCatalogVersionId } }),
          this.catalogRecipeRepository.count({ where: { catalogVersionId: contentCatalogVersionId } }),
          catalog.rulesetId
            ? this.rulesetRepository.findOne({ where: { id: catalog.rulesetId } })
            : Promise.resolve(undefined),
        ]);

        return {
          id: catalog.id,
          clientVersion: Number(catalog.clientVersion),
          contentCatalogVersionId,
          deduplicated: contentCatalogVersionId !== catalog.id,
          source: catalog.source,
          payloadHash: catalog.payloadHash,
          isCurrent: catalog.isCurrent,
          importedAt: catalog.importedAt,
          itemCount,
          recipeCount,
          ruleset: ruleset
            ? {
                id: ruleset.id,
                rulesetKey: ruleset.rulesetKey,
                status: ruleset.status,
                validFrom: ruleset.validFrom,
                validTo: ruleset.validTo,
              }
            : undefined,
        };
      }),
    );
  }
}
