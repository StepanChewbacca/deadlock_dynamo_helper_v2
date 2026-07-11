import { RawMatchMetadata } from '../src/deadlock-live/entities/raw-match-metadata.entity';
import {
  normalizeReplayLimit,
  shouldReplayHistoricalRow,
} from '../src/deadlock-live/historical-match-replay.service';
import { RAW_MATCH_METADATA_NORMALIZATION_VERSION } from '../src/deadlock-live/raw-match-metadata-normalizer.service';
import { MATCH_METADATA_PROCESSING_VERSION } from '../src/deadlock-live/stored-match-reprocessing.service';

describe('HistoricalMatchReplayService helpers', () => {
  it('replays rows when either version is stale', () => {
    expect(
      shouldReplayHistoricalRow({
        normalizationVersion: 'old',
        processingVersion: MATCH_METADATA_PROCESSING_VERSION,
      } as RawMatchMetadata),
    ).toBe(true);

    expect(
      shouldReplayHistoricalRow({
        normalizationVersion: RAW_MATCH_METADATA_NORMALIZATION_VERSION,
        processingVersion: 'old',
      } as RawMatchMetadata),
    ).toBe(true);
  });

  it('skips rows already processed by current versions', () => {
    expect(
      shouldReplayHistoricalRow({
        normalizationVersion: RAW_MATCH_METADATA_NORMALIZATION_VERSION,
        processingVersion: MATCH_METADATA_PROCESSING_VERSION,
      } as RawMatchMetadata),
    ).toBe(false);
  });

  it('bounds replay batches', () => {
    expect(normalizeReplayLimit(undefined)).toBe(25);
    expect(normalizeReplayLimit(-1)).toBe(25);
    expect(normalizeReplayLimit(100)).toBe(100);
    expect(normalizeReplayLimit(1000)).toBe(250);
  });
});
