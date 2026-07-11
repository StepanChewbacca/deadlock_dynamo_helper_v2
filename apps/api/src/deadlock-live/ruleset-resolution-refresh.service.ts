import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RawMatchMetadata } from './entities/raw-match-metadata.entity';
import {
  RulesetResolutionResult,
  RulesetResolverService,
} from './ruleset-resolver.service';

@Injectable()
export class RulesetResolutionRefreshService {
  constructor(
    @InjectRepository(RawMatchMetadata)
    private readonly rawMetadataRepository: Repository<RawMatchMetadata>,
    private readonly rulesetResolverService: RulesetResolverService,
  ) {}

  async resolveLatestForMatch(matchId: number): Promise<RulesetResolutionResult> {
    const rawMetadata = await this.rawMetadataRepository.findOne({
      where: { matchId },
      order: { fetchedAt: 'DESC', id: 'DESC' },
    });
    if (!rawMetadata) {
      throw new Error(`No raw metadata found for match ${matchId}`);
    }

    return this.resolveRawMetadata(rawMetadata);
  }

  async resolveRawMetadata(rawMetadata: RawMatchMetadata): Promise<RulesetResolutionResult> {
    const reset = {
      clientVersion: null,
      rulesetResolutionMethod: 'UNKNOWN',
      rulesetResolutionConfidence: 0,
      rulesetResolutionDetails: {},
      resolvedRulesetId: null,
      resolvedCatalogVersionId: null,
      resolvedAt: null,
    };
    await this.rawMetadataRepository.update(rawMetadata.id, reset as any);
    Object.assign(rawMetadata, reset);

    const result = await this.rulesetResolverService.resolveAndPersist(rawMetadata);
    if (result.clientVersion === undefined) {
      await this.rawMetadataRepository.update(rawMetadata.id, { clientVersion: null } as any);
      Object.assign(rawMetadata, { clientVersion: null });
    }

    return result;
  }
}
