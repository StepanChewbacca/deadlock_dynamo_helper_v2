import { describeMatchupDiagnostics } from './live-build-desktop-full-build-ui';

describe('desktop situational diagnostics', () => {
  it('explains when the enemy roster is missing', () => {
    expect(
      describeMatchupDiagnostics({
        enemyHeroIds: [],
      } as any),
    ).toBe('Enemy roster missing. Situational scoring is disabled.');
  });

  it('explains when evidence exists but no candidate is promoted', () => {
    expect(
      describeMatchupDiagnostics({
        enemyHeroIds: [2, 3, 4],
        recommendation: {
          evaluatedCandidateCount: 100,
          situationalCandidateCount: 3,
          promotedSituationalCandidateCount: 0,
          insertedSituationalCandidateCount: 0,
          action: {},
          alternatives: [],
        },
      } as any),
    ).toBe(
      'Matchup funnel: 100 evaluated, 3 supported, 0 promoted, and the primary action is not situational.',
    );
  });

  it('reports a rank-promoted primary action as warning-ready', () => {
    expect(
      describeMatchupDiagnostics({
        enemyHeroIds: [2, 3, 4],
        recommendation: {
          evaluatedCandidateCount: 100,
          situationalCandidateCount: 3,
          promotedSituationalCandidateCount: 2,
          insertedSituationalCandidateCount: 1,
          action: {
            isSituational: true,
            wasPromotedByMatchup: true,
          },
          alternatives: [],
        },
      } as any),
    ).toBe(
      'Warning-ready: 100 evaluated, 3 supported, 2 promoted, 1 inserted.',
    );
  });

  it('reports a supported primary action as warning-ready without promotion', () => {
    expect(
      describeMatchupDiagnostics({
        enemyHeroIds: [2, 3, 4],
        recommendation: {
          evaluatedCandidateCount: 100,
          situationalCandidateCount: 1,
          promotedSituationalCandidateCount: 0,
          insertedSituationalCandidateCount: 0,
          action: {
            isSituational: true,
            wasPromotedByMatchup: false,
          },
          alternatives: [],
        },
      } as any),
    ).toBe(
      'Warning-ready: 100 evaluated, 1 supported, primary already ranked first before matchup scoring.',
    );
  });
});
