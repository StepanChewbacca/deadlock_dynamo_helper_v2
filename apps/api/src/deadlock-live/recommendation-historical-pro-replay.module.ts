import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemCatalogItem } from './entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './entities/item-catalog-version.entity';
import { RecommendationCandidateGeneratorSnapshotExportController } from './recommendation-candidate-generator-snapshot-export.controller';
import { RecommendationCandidateGeneratorSnapshotExportService } from './recommendation-candidate-generator-snapshot-export.service';
import { RecommendationHistoricalProReplayArtifactService } from './recommendation-historical-pro-replay-artifact.service';
import { RecommendationHistoricalProReplayController } from './recommendation-historical-pro-replay.controller';

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
  ],
  providers: [
    RecommendationHistoricalProReplayArtifactService,
    RecommendationCandidateGeneratorSnapshotExportService,
  ],
  exports: [
    RecommendationHistoricalProReplayArtifactService,
    RecommendationCandidateGeneratorSnapshotExportService,
  ],
})
export class RecommendationHistoricalProReplayModule {}
