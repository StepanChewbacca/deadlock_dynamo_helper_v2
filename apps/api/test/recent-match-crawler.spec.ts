import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  calculateMissingRecentMatchCount,
  RECENT_MATCH_CRAWL_CRON,
} from '../src/deadlock-live/recent-match-crawler.service';
import { RECENT_MATCH_TARGET_COUNT } from '../src/deadlock-live/recent-matches-window.service';

describe('recent match crawler', () => {
  it('runs every four hours, six times per day', () => {
    expect(RECENT_MATCH_CRAWL_CRON).toBe('0 0 */4 * * *');
  });

  it('fills only the global deficit up to 10,000 matches', () => {
    expect(RECENT_MATCH_TARGET_COUNT).toBe(10_000);
    expect(calculateMissingRecentMatchCount(0)).toBe(10_000);
    expect(calculateMissingRecentMatchCount(9_999)).toBe(1);
    expect(calculateMissingRecentMatchCount(10_000)).toBe(0);
    expect(calculateMissingRecentMatchCount(12_000)).toBe(0);
  });

  it('does not restrict discovery to only the maximum average badge', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/deadlock-live/recent-match-crawler.service.ts'),
      'utf8',
    );

    expect(source).not.toContain('min_average_badge');
  });
});
