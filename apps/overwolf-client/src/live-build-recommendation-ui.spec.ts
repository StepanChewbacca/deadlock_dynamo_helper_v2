import { formatMatchupSignal } from './live-build-recommendation-ui';

describe('live build recommendation matchup signals', () => {
  it('formats model lift without claiming a proven counter', () => {
    expect(
      formatMatchupSignal({
        heroId: 13,
        heroName: 'Haze',
        direction: 'POSITIVE',
        scoreContribution: 0.031,
        contextualPurchaseLiftPercent: 3.15,
        observationCount: 124,
      }),
    ).toBe('VS Haze +3.1% purchase-pattern lift · 124 samples');
  });
});
