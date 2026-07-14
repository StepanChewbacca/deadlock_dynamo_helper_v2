import { RawMatchMetadata } from '../src/deadlock-live/entities/raw-match-metadata.entity';
import {
  normalizeReplayLimit,
  shouldReplayHistoricalRow,
} from '../src/deadlock-live/historical-match-replay.service';
import { MATCH_METADATA_PROCESSING_VERSION } from '../src/deadlock-live/stored-match-reprocessing.service';

describe('HistoricalMatchReplayService helpers', () => {
  it('ignores audit normalization versions when processing is current', () => {
    expect(
      shouldReplayHistoricalRow({
        normalizationVersion: 'old-audit-version',
        processingVersion: MATCH_METADATA_PROCESSING_VERSION,
      } as RawMatchMetadata),
    ).toBe(false);
  });

  it('replays rows when the version-independent processing logic is stale', () => {
    expect(
      shouldReplayHistoricalRow({
        normalizationVersion: 'any-audit-version',
        processingVersion: 'old-processing-version',
      } as RawMatchMetadata),
    ).toBe(true);
  });

  it('skips rows already processed by the current version-independent logic', () => {
    expect(
      shouldReplayHistoricalRow({
        normalizationVersion: 'any-audit-version',
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
