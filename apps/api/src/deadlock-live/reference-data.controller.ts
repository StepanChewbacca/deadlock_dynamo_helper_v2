import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import {
  ConfigureRulesetWindowDto,
  ImportItemCatalogsDto,
  ItemCatalogImportService,
} from './item-catalog-import.service';
import { VersionedRecipeGraphService } from './versioned-recipe-graph.service';

@Controller('deadlock/reference-data')
export class ReferenceDataController {
  constructor(
    private readonly itemCatalogImportService: ItemCatalogImportService,
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

  @Put('rulesets/:clientVersion/window')
  async configureRulesetWindow(
    @Param('clientVersion', ParseIntPipe) clientVersion: number,
    @Body() dto: ConfigureRulesetWindowDto,
  ) {
    return this.itemCatalogImportService.configureRulesetWindow(clientVersion, dto ?? {});
  }
}
