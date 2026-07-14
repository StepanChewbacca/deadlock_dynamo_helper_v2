import { RawMatchMetadata } from '../src/deadlock-live/entities/raw-match-metadata.entity';
import { RulesetResolutionRefreshService } from '../src/deadlock-live/ruleset-resolution-refresh.service';

function createRawMetadata(): RawMatchMetadata {
  return Object.assign(new RawMatchMetadata(), {
    id: 1718,
    matchId: 91825430,
    source: 'deadlock-api-match-metadata',
    payloadHash: 'hash',
    payload: {
      match_info: {
        start_time: 1783007796,
      },
    },
    clientVersion: 6629,
    rulesetResolutionMethod: 'TIME_WINDOW' as const,
    rulesetResolutionConfidence: 0.75,
    resolvedRulesetId: 1,
    resolvedCatalogVersionId: 1,
    rulesetResolutionDetails: { sourcePath: 'game_rulesets.client-6629' },
    resolvedAt: new Date('2026-07-11T17:40:00.000Z'),
    fetchedAt: new Date('2026-07-11T17:30:00.000Z'),
  });
}

describe('RulesetResolutionRefreshService', () => {
  it('allows an explicit refresh to downgrade a stale time-window result', async () => {
    const rawMetadata = createRawMetadata();
    const rawMetadataRepository = {
      findOne: jest.fn().mockResolvedValue(rawMetadata),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const rulesetResolverService = {
      resolveAndPersist: jest.fn().mockImplementation(async (row: RawMatchMetadata) => {
        expect(row.rulesetResolutionMethod).toBe('UNKNOWN');
        expect(row.rulesetResolutionConfidence).toBe(0);
        expect(row.resolvedRulesetId).toBeNull();
        expect(row.resolvedCatalogVersionId).toBeNull();
        expect(row.resolvedAt).toBeNull();
        expect(row.clientVersion).toBeNull();

        return {
          matchId: Number(row.matchId),
          rawMetadataId: row.id,
          method: 'UNKNOWN',
          confidence: 0,
          matchStartTime: new Date('2026-07-02T15:56:36.000Z'),
          details: { reason: 'NO_RULESET_WINDOW' },
        };
      }),
    };

    const service = new RulesetResolutionRefreshService(
      rawMetadataRepository as any,
      rulesetResolverService as any,
    );

    const result = await service.resolveLatestForMatch(91825430);

    expect(result.method).toBe('UNKNOWN');
    expect(rawMetadataRepository.update).toHaveBeenCalledWith(1718, { clientVersion: null });
  });
});
