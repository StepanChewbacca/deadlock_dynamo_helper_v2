import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import { RecommendationCandidateGeneratorSnapshotExportController } from './recommendation-candidate-generator-snapshot-export.controller';
import { RecommendationCandidateGeneratorSnapshotExportService } from './recommendation-candidate-generator-snapshot-export.service';
import { RecommendationHistoricalPostgresTimelineCacheService } from './recommendation-historical-postgres-timeline-cache.service';
import { RecommendationHistoricalProReplayArtifactService } from './recommendation-historical-pro-replay-artifact.service';
import { RecommendationHistoricalProReplayController } from './recommendation-historical-pro-replay.controller';
import { RecommendationHistoricalProReplayFacadeService } from './recommendation-historical-pro-replay-facade.service';
import { RecommendationProDecisionDatasetV6ArtifactService } from './recommendation-pro-decision-dataset-v6-artifact.service';
import { RecommendationProDecisionDatasetV6Controller } from './recommendation-pro-decision-dataset-v6.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ItemCatalogVersion,
      ItemCatalogItem,
      ItemCatalogRecipe,
      RawMatchMetadata,
    ]),
  ],
  controllers: [
    RecommendationHistoricalProReplayController,
    RecommendationCandidateGeneratorSnapshotExportController,
    RecommendationProDecisionDatasetV6Controller,
  ],
  providers: [
    RecommendationHistoricalPostgresTimelineCacheService,
    RecommendationHistoricalProReplayArtifactService,
    RecommendationHistoricalProReplayFacadeService,
    RecommendationCandidateGeneratorSnapshotExportService,
    RecommendationProDecisionDatasetV6ArtifactService,
  ],
  exports: [
    RecommendationHistoricalPostgresTimelineCacheService,
    RecommendationHistoricalProReplayArtifactService,
    RecommendationHistoricalProReplayFacadeService,
    RecommendationCandidateGeneratorSnapshotExportService,
    RecommendationProDecisionDatasetV6ArtifactService,
  ],
})
export class RecommendationHistoricalProReplayModule {}
