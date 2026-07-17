import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisOperationsController } from './analysis-operations.controller';
import { CanonicalBuildSequenceService } from './canonical-build-sequence.service';
import { CatalogContentService } from './catalog-content.service';
import { ContextualHeroBuildRecommendationV2Service } from './contextual-hero-build-recommendation-v2.service';
import { ContextualHeroBuildRecommendationService } from './contextual-hero-build-recommendation.service';
import { DebugPageController } from './debug-page.controller';
import { CrawlerRun } from './entities/crawler-run.entity';
import { CrawlerState } from './entities/crawler-state.entity';
import { GameRuleset } from './entities/game-ruleset.entity';
import { Hero } from './entities/hero.entity';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { ItemComponent } from './entities/item-component.entity';
import { Item } from './entities/item.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { Match } from './entities/match.entity';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import { HeroBuildMatchupStatisticsService } from './hero-build-matchup-statistics.service';
import { HeroBuildNextActionContextStatisticsService } from './hero-build-next-action-context-statistics.service';
import { HeroBuildOfflineEvaluationController } from './hero-build-offline-evaluation.controller';
import { HeroBuildOfflineEvaluationResilientService } from './hero-build-offline-evaluation-resilient.service';
import { HeroBuildOfflineEvaluationService } from './hero-build-offline-evaluation.service';
import { HeroBuildRecommendationController } from './hero-build-recommendation.controller';
import { HeroBuildRecommendationOwnershipFilterService } from './hero-build-recommendation-ownership-filter.service';
import { HeroBuildRecommendationPresentationService } from './hero-build-recommendation-presentation.service';
import { HeroBuildRecommendationService } from './hero-build-recommendation.service';
import { HeroBuildTransitionAggregationController } from './hero-build-transition-aggregation.controller';
import { HeroBuildTransitionAggregationService } from './hero-build-transition-aggregation.service';
import { HistoricalCatalogBackfillService } from './historical-catalog-backfill.service';
import { HistoricalMatchReplayService } from './historical-match-replay.service';
import { IngestStatusController } from './ingest-status.controller';
import { IngestStatusService } from './ingest-status.service';
import { InventoryShadowReplayService } from './inventory-shadow-replay.service';
import { InventoryTimelineReplayService } from './inventory-timeline-replay.service';
import { ItemCatalogImportService } from './item-catalog-import.service';
import { LazyBuildTransitionAggregationService } from './lazy-build-transition-aggregation.service';
import { LazyRecentMatchesWindowService } from './lazy-recent-matches-window.service';
import { LiveBuildRecommendationTraversalService } from './live-build-recommendation-traversal.service';
import { LiveHeroBuildPolicyService } from './live-hero-build-policy.service';
import { LiveHeroBuildRecommendationPresentationService } from './live-hero-build-recommendation-presentation.service';
import { LiveHeroMatchupSourceService } from './live-hero-matchup-source.service';
import { LiveIngestController } from './live-ingest.controller';
import { LiveInventoryEventNormalizerService } from './live-inventory-event-normalizer.service';
import { LiveMatchStateService } from './live-match-state.service';
import { MatchTimelineNormalizationController } from './match-timeline-normalization.controller';
import { MatchTimelineNormalizationService } from './match-timeline-normalization.service';
import { ProductionHeroBuildRecommendationService } from './production-hero-build-recommendation.service';
import { RawEventLogService } from './raw-event-log.service';
import { RawMatchMetadataNormalizerService } from './raw-match-metadata-normalizer.service';
import { RawMatchMetadataService } from './raw-match-metadata.service';
import { RecentLiveEventsService } from './recent-live-events.service';
import { RecentMatchCrawlerService } from './recent-match-crawler.service';
import { RecentMatchRosterRepairService } from './recent-match-roster-repair.service';
import { RecentMatchesWindowController } from './recent-matches-window.controller';
import { RecentMatchesWindowService } from './recent-matches-window.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataImportService } from './reference-data-import.service';
import { RulesetResolutionRefreshService } from './ruleset-resolution-refresh.service';
import { RulesetResolverService } from './ruleset-resolver.service';
import { RulesetWindowManifestService } from './ruleset-window-manifest.service';
import { SituationalRecommendationDiagnosticsService } from './situational-recommendation-diagnostics.service';
import { SkillBuildAnalysisController } from './skill-build-analysis.controller';
import { SkillBuildAnalysisService } from './skill-build-analysis.service';
import { StoredMatchReprocessingService } from './stored-match-reprocessing.service';
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
    AnalysisOperationsController,
    RecentMatchesWindowController,
    MatchTimelineNormalizationController,
    HeroBuildTransitionAggregationController,
    HeroBuildRecommendationController,
    HeroBuildOfflineEvaluationController,
    SkillBuildAnalysisController,
    ReferenceDataController,
    IngestStatusController,
  ],
  providers: [
    LiveMatchStateService,
    LiveInventoryEventNormalizerService,
    LiveBuildRecommendationTraversalService,
    InventoryShadowReplayService,
    InventoryTimelineReplayService,
    CanonicalBuildSequenceService,
    LiveHeroBuildPolicyService,
    LiveHeroMatchupSourceService,
    LazyBuildTransitionAggregationService,
    {
      provide: HeroBuildTransitionAggregationService,
      useExisting: LazyBuildTransitionAggregationService,
    },
    HeroBuildMatchupStatisticsService,
    HeroBuildNextActionContextStatisticsService,
    HeroBuildOfflineEvaluationResilientService,
    {
      provide: HeroBuildOfflineEvaluationService,
      useExisting: HeroBuildOfflineEvaluationResilientService,
    },
    ContextualHeroBuildRecommendationService,
    ContextualHeroBuildRecommendationV2Service,
    ProductionHeroBuildRecommendationService,
    {
      provide: HeroBuildRecommendationService,
      useExisting: ContextualHeroBuildRecommendationService,
    },
    HeroBuildRecommendationOwnershipFilterService,
    LiveHeroBuildRecommendationPresentationService,
    {
      provide: HeroBuildRecommendationPresentationService,
      useExisting: LiveHeroBuildRecommendationPresentationService,
    },
    SituationalRecommendationDiagnosticsService,
    SkillBuildAnalysisService,
    RawEventLogService,
    RecentLiveEventsService,
    LazyRecentMatchesWindowService,
    {
      provide: RecentMatchesWindowService,
      useExisting: LazyRecentMatchesWindowService,
    },
    RecentMatchCrawlerService,
    RecentMatchRosterRepairService,
    RecipeAwareTimelineReconciliationService,
    MatchTimelineNormalizationService,
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
    ReferenceDataImportService,
    IngestStatusService,
  ],
  exports: [
    LiveMatchStateService,
    LiveBuildRecommendationTraversalService,
    InventoryShadowReplayService,
    InventoryTimelineReplayService,
    CanonicalBuildSequenceService,
    LiveHeroBuildPolicyService,
    LiveHeroMatchupSourceService,
    HeroBuildTransitionAggregationService,
    HeroBuildMatchupStatisticsService,
    HeroBuildNextActionContextStatisticsService,
    HeroBuildOfflineEvaluationService,
    HeroBuildRecommendationService,
    HeroBuildRecommendationPresentationService,
    SituationalRecommendationDiagnosticsService,
    SkillBuildAnalysisService,
    RawEventLogService,
    RecentLiveEventsService,
    RecentMatchesWindowService,
    RecentMatchCrawlerService,
    RecentMatchRosterRepairService,
    RecipeAwareTimelineReconciliationService,
    MatchTimelineNormalizationService,
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
    ReferenceDataImportService,
    IngestStatusService,
  ],
})
export class DeadlockLiveModule {}
