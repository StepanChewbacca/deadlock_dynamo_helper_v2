import {
  extractNormalizedRawMatchMetadataSummary,
  normalizeNormalizationLimit,
  toDateFromUnixValue,
} from '../src/deadlock-live/raw-match-metadata-normalizer.service';

describe('RawMatchMetadataNormalizerService helpers', () => {
  it('extracts canonical fields and records their source paths', () => {
    expect(
      extractNormalizedRawMatchMetadataSummary({
        metadata_version: '7',
        match_info: {
          client_version: '6629',
          game_mode: 2,
          match_mode: '3',
          game_mode_version: 4,
          start_time: 1_700_000_000,
          players: [{ hero_id: 1 }, { hero_id: 2 }],
        },
      }),
    ).toEqual({
      metadataVersion: { value: 7, path: 'metadata_version' },
      clientVersion: { value: 6629, path: 'match_info.client_version' },
      gameMode: { value: 2, path: 'match_info.game_mode' },
      matchMode: { value: 3, path: 'match_info.match_mode' },
      gameModeVersion: { value: 4, path: 'match_info.game_mode_version' },
      matchStartTime: { value: 1_700_000_000, path: 'match_info.start_time' },
      playerCount: 2,
      hasMatchInfo: true,
    });
  });

  it('does not treat a generic metadata version as a client version', () => {
    const summary = extractNormalizedRawMatchMetadataSummary({ version: 999 });

    expect(summary.metadataVersion).toEqual({ value: 999, path: 'version' });
    expect(summary.clientVersion).toBeUndefined();
  });

  it('supports Unix seconds and milliseconds', () => {
    expect(toDateFromUnixValue(1_700_000_000)?.toISOString()).toBe(
      '2023-11-14T22:13:20.000Z',
    );
    expect(toDateFromUnixValue(1_700_000_000_000)?.toISOString()).toBe(
      '2023-11-14T22:13:20.000Z',
    );
  });

  it('bounds normalization batches', () => {
    expect(normalizeNormalizationLimit(undefined)).toBe(100);
    expect(normalizeNormalizationLimit(0)).toBe(100);
    expect(normalizeNormalizationLimit(50)).toBe(50);
    expect(normalizeNormalizationLimit(5000)).toBe(1000);
  });
});
