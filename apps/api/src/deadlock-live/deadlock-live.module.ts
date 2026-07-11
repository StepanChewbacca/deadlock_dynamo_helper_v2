import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogContentService } from './catalog-content.service';
import { LiveMatchStateService } from './live-match-state.service';
import { InventoryShadowReplayService } from './inventory-shadow-replay.service';
import { RawEventLogService } from './raw-event-log.service';
import { RecentLiveEventsService } from './recent-live-events.service';
import { RecentMatchesWindowController } from './recent-matches-window.controller';
import { RecentMatchesWindowService } from './recent-matches-window.service';
import { LiveIngestController } from './live-ingest.controller';
import { DebugPageController } from './debug-page.controller';
import { HeroAnalysisService } from './hero-analysis.service';
import { HeroAnalysisController } from './hero-analysis.controller';
import { IngestStatusController } from './ingest-status.controller';
import { IngestStatusService } from './ingest-status.service';
import { AllHeroesAnalysisService } from './all-heroes-analysis.service';
import { AllHeroesAnalysisController } from './all-heroes-analysis.controller';
import { HistoricalCatalogBackfillService } from './historical-catalog-backfill.service';
import { HistoricalMatchReplayService } from './historical-match-replay.service';
import { RawMatchMetadataNormalizerService } from './raw-match-metadata-normalizer.service';
import { RulesetWindowManifestService } from './ruleset-window-manifest.service';
import { SituationalRecommendationService } from './situational-recommendation.service';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { GameRuleset } from './entities/game-ruleset.entity';
import { Hero } from './entities/hero.entity';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { ItemComponent } from './entities/item-component.entity';
import { Item } from './entities/item.entity';
import { Match } from './entities/match.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import { ReferenceDataImportService } from './reference-data-import.service';
import { ReferenceDataController } from './reference-data.controller';
import { ShadowModeDecision } from './entities/shadow-mode-decision.entity';
import { RawMatchMetadataService } from './raw-match-metadata.service';
import { StoredMatchReprocessingService } from './stored-match-reprocessing.service';
import { ItemCatalogImportService } from './item-catalog-import.service';
import { RulesetResolverService } from './ruleset-resolver.service';
import { RulesetResolutionRefreshService } from './ruleset-resolution-refresh.service';
import { VersionedRecipeGraphService } from './versioned-recipe-graph.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Match,
      MatchPlayer,
      MatchPlayerItem,
      MatchPlayerSkillUpgrade,
      Hero,
      Item,
      ItemComponent,
      CrawlerRun,
      CrawlerState,
      ShadowModeDecision,
      RawMatchMetadata,
      GameRuleset,
      ItemCatalogVersion,
      ItemCatalogItem,
      ItemCatalogRecipe,
    ]),
  ],
  controllers: [
    LiveIngestController,
    DebugPageController,
    HeroAnalysisController,
    AllHeroesAnalysisController,
    RecentMatchesWindowController,
    ReferenceDataController,
    IngestStatusController,
  ],
  providers: [
    LiveMatchStateService,
    InventoryShadowReplayService,
    RawEventLogService,
    RecentLiveEventsService,
    RecentMatchesWindowService,
    HeroAnalysisService,
    RulesetResolverService,
    RulesetResolutionRefreshService,
    RawMatchMetadataService,
    RawMatchMetadataNormalizerService,
    HistoricalMatchReplayService,
    StoredMatchReprocessingService,
    ItemCatalogImportService,
    CatalogContentService,
    HistoricalCatalogBackfillService,
    RulesetWindowManifestService,
    VersionedRecipeGraphService,
    AllHeroesAnalysisService,
    SituationalRecommendationService,
    ReferenceDataImportService,
    IngestStatusService,
  ],
  exports: [
    LiveMatchStateService,
    InventoryShadowReplayService,
    RawEventLogService,
    RecentLiveEventsService,
    RecentMatchesWindowService,
    HeroAnalysisService,
    RulesetResolverService,
    RulesetResolutionRefreshService,
    RawMatchMetadataService,
    RawMatchMetadataNormalizerService,
    HistoricalMatchReplayService,
    StoredMatchReprocessingService,
    ItemCatalogImportService,
    CatalogContentService,
    HistoricalCatalogBackfillService,
    RulesetWindowManifestService,
    VersionedRecipeGraphService,
    AllHeroesAnalysisService,
    SituationalRecommendationService,
    ReferenceDataImportService,
    IngestStatusService,
  ],
})
export class DeadlockLiveModule {}
