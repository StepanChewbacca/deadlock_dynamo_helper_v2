import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { RecommendationCandidateGeneratorSnapshotExportController } from './recommendation-candidate-generator-snapshot-export.controller';
import { RecommendationCandidateGeneratorSnapshotExportService } from './recommendation-candidate-generator-snapshot-export.service';
import { RecommendationHistoricalProReplayArtifactService } from './recommendation-historical-pro-replay-artifact.service';
import { RecommendationHistoricalProReplayController } from './recommendation-historical-pro-replay.controller';
import { RecommendationProDecisionDatasetV6ArtifactService } from './recommendation-pro-decision-dataset-v6-artifact.service';
import { RecommendationProDecisionDatasetV6Controller } from './recommendation-pro-decision-dataset-v6.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ItemCatalogVersion,
      ItemCatalogItem,
      ItemCatalogRecipe,
    ]),
  ],
  controllers: [
    RecommendationHistoricalProReplayController,
    RecommendationCandidateGeneratorSnapshotExportController,
    RecommendationProDecisionDatasetV6Controller,
  ],
  providers: [
    RecommendationHistoricalProReplayArtifactService,
    RecommendationCandidateGeneratorSnapshotExportService,
    RecommendationProDecisionDatasetV6ArtifactService,
  ],
  exports: [
    RecommendationHistoricalProReplayArtifactService,
    RecommendationCandidateGeneratorSnapshotExportService,
    RecommendationProDecisionDatasetV6ArtifactService,
  ],
})
export class RecommendationHistoricalProReplayModule {}
