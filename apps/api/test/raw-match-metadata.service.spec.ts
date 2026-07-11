import {
  extractMatchIdFromMetadataUrl,
  hashRawMatchMetadata,
  summarizeRawMatchMetadata,
} from '../src/deadlock-live/raw-match-metadata.service';

describe('RawMatchMetadataService helpers', () => {
  it('extracts only single-match metadata URLs', () => {
    expect(
      extractMatchIdFromMetadataUrl(
        'https://api.deadlock-api.com/v1/matches/93314383/metadata',
      ),
    ).toBe(93314383);
    expect(
      extractMatchIdFromMetadataUrl(
        'https://api.deadlock-api.com/v1/matches/93314383/metadata?include_raw=true',
      ),
    ).toBe(93314383);
    expect(
      extractMatchIdFromMetadataUrl('https://api.deadlock-api.com/v1/matches/metadata'),
    ).toBeUndefined();
  });

  it('uses only explicit client_version fields for observed rulesets', () => {
    expect(
      summarizeRawMatchMetadata({
        version: 7,
        match_info: {
          client_version: 123456,
          game_mode: 1,
          match_mode: 2,
          game_mode_version: 99,
        },
      }),
    ).toEqual({
      metadataVersion: 7,
      clientVersion: 123456,
      gameMode: 1,
      matchMode: 2,
      gameModeVersion: 99,
      rulesetResolutionMethod: 'OBSERVED',
      rulesetResolutionConfidence: 1,
    });

    expect(
      summarizeRawMatchMetadata({
        match_info: {
          game_mode_version: 99,
        },
      }),
    ).toMatchObject({
      clientVersion: undefined,
      gameModeVersion: 99,
      rulesetResolutionMethod: 'UNKNOWN',
      rulesetResolutionConfidence: 0,
    });
  });

  it('hashes objects independently of property order', () => {
    const left = hashRawMatchMetadata({
      match_info: { duration_s: 100, players: [{ hero_id: 1 }] },
      version: 7,
    });
    const right = hashRawMatchMetadata({
      version: 7,
      match_info: { players: [{ hero_id: 1 }], duration_s: 100 },
    });

    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });
});
