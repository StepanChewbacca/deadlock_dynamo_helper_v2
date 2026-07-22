import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isAbilityItem,
  mapAbilityToSkillNumber,
  UNKNOWN_SKILL_SLOT,
} from '../src/deadlock-live/hero-abilities';
import {
  calculateMissingRecentMatchCount,
  RECENT_MATCH_CRAWL_CRON,
} from '../src/deadlock-live/recent-match-crawler.service';
import { RECENT_MATCH_TARGET_COUNT } from '../src/deadlock-live/recent-matches-window.service';

const DYNAMO_HERO_ID = 11;
const DYNAMO_SKILL_ONE_ID = 3760705623;
const INFERNUS_SKILL_ONE_ID = 491391007;

describe('recent match crawler', () => {
  it('runs every four hours, six times per day', () => {
    expect(RECENT_MATCH_CRAWL_CRON).toBe('0 0 */4 * * *');
  });

  it('fills only the global deficit up to 50,000 matches', () => {
    expect(RECENT_MATCH_TARGET_COUNT).toBe(50_000);
    expect(calculateMissingRecentMatchCount(0)).toBe(50_000);
    expect(calculateMissingRecentMatchCount(49_999)).toBe(1);
    expect(calculateMissingRecentMatchCount(50_000)).toBe(0);
    expect(calculateMissingRecentMatchCount(50_001)).toBe(0);
  });

  it('does not restrict discovery to only the maximum average badge', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/deadlock-live/recent-match-crawler.service.ts'),
      'utf8',
    );

    expect(source).not.toContain('min_average_badge');
  });

  it('maps a known hero ability to its actual skill slot', () => {
    expect(mapAbilityToSkillNumber(DYNAMO_HERO_ID, DYNAMO_SKILL_ONE_ID)).toBe(1);
  });

  it('does not silently map another hero ability to skill one', () => {
    expect(isAbilityItem(DYNAMO_HERO_ID, INFERNUS_SKILL_ONE_ID)).toBe(true);
    expect(mapAbilityToSkillNumber(DYNAMO_HERO_ID, INFERNUS_SKILL_ONE_ID)).toBe(
      UNKNOWN_SKILL_SLOT,
    );
  });

  it('marks an unknown item as neither an ability nor a valid skill slot', () => {
    expect(isAbilityItem(DYNAMO_HERO_ID, 999)).toBe(false);
    expect(mapAbilityToSkillNumber(DYNAMO_HERO_ID, 999)).toBe(UNKNOWN_SKILL_SLOT);
  });
});
