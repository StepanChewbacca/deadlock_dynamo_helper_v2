import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import {
  HistoricalCatalogBackfillService,
  ImportHistoricalCatalogBatchDto,
} from './historical-catalog-backfill.service';
import {
  ConfigureRulesetWindowDto,
  ImportItemCatalogsDto,
  ItemCatalogImportService,
} from './item-catalog-import.service';
import {
  ApplyRulesetWindowManifestDto,
  RulesetWindowManifestService,
} from './ruleset-window-manifest.service';
import { VersionedRecipeGraphService } from './versioned-recipe-graph.service';

@Controller('deadlock/reference-data')
export class ReferenceDataController {
  constructor(
    private readonly itemCatalogImportService: ItemCatalogImportService,
    private readonly historicalCatalogBackfillService: HistoricalCatalogBackfillService,
    private readonly rulesetWindowManifestService: RulesetWindowManifestService,
    private readonly versionedRecipeGraphService: VersionedRecipeGraphService,
  ) {}

  @Get('catalogs/available')
  async getAvailableCatalogVersions() {
    const clientVersions = await this.itemCatalogImportService.getAvailableClientVersions();
    return {
      count: clientVersions.length,
      latestClientVersion: clientVersions[clientVersions.length - 1],
      clientVersions,
    };
  }

  @Get('catalogs')
  async getCatalogs() {
    return this.itemCatalogImportService.listCatalogs();
  }

  @Post('catalogs/import')
  async importCatalogs(@Body() dto: ImportItemCatalogsDto) {
    return this.itemCatalogImportService.importCatalogs(dto ?? {});
  }

  @Get('catalogs/history/status')
  async getHistoricalCatalogBackfillStatus() {
    return this.historicalCatalogBackfillService.getStatus();
  }

  @Post('catalogs/history/import')
  async importHistoricalCatalogBatch(@Body() dto: ImportHistoricalCatalogBatchDto) {
    return this.historicalCatalogBackfillService.importBatch(dto ?? {});
  }

  @Get('catalogs/:clientVersion/recipes')
  async getCatalogRecipes(
    @Param('clientVersion', ParseIntPipe) clientVersion: number,
  ) {
    return this.versionedRecipeGraphService.getDiagnostics(clientVersion);
  }

  @Get('rulesets')
  async getRulesets() {
    return this.itemCatalogImportService.listRulesets();
  }

  @Get('rulesets/windows/status')
  async getRulesetWindowStatus() {
    return this.rulesetWindowManifestService.getStatus();
  }

  @Post('rulesets/windows/validate')
  async validateRulesetWindowManifest(@Body() dto: ApplyRulesetWindowManifestDto) {
    return this.rulesetWindowManifestService.validateManifest(dto ?? {});
  }

  @Put('rulesets/windows')
  async applyRulesetWindowManifest(@Body() dto: ApplyRulesetWindowManifestDto) {
    return this.rulesetWindowManifestService.applyManifest(dto ?? {});
  }

  @Put('rulesets/:clientVersion/window')
  async configureRulesetWindow(
    @Param('clientVersion', ParseIntPipe) clientVersion: number,
    @Body() dto: ConfigureRulesetWindowDto,
  ) {
    return this.itemCatalogImportService.configureRulesetWindow(clientVersion, dto ?? {});
  }
}
