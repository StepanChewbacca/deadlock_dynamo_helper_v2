import {
  HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES,
  normalizeHeroBuildDecisionDatasetV3Options,
} from '../src/deadlock-live/hero-build-decision-dataset-v3.service';

describe('Contextual V3 full-corpus snapshot options', () => {
  it('uses the full immutable database snapshot when maxMatches is omitted', () => {
    expect(normalizeHeroBuildDecisionDatasetV3Options({})).toEqual({
      maxMatches: undefined,
      batchSize: 100,
      includeSellActions: false,
    });
  });

  it('keeps an explicit smoke-test limit bounded', () => {
    expect(
      normalizeHeroBuildDecisionDatasetV3Options({ maxMatches: 25 }),
    ).toMatchObject({ maxMatches: 25 });
    expect(() =>
      normalizeHeroBuildDecisionDatasetV3Options({
        maxMatches: HERO_BUILD_DECISION_DATASET_V3_MAX_MATCHES + 1,
      }),
    ).toThrow('maxMatches must be a safe integer');
  });
});
