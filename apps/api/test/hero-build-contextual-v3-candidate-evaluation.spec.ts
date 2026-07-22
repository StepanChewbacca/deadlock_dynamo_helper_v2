import {
  buildContextualV3CandidateReleaseGate,
  isContextualV3CandidateActionLegal,
  orderContextualV3CandidateActions,
} from '../src/deadlock-live/hero-build-contextual-v3-candidate-evaluation.service';

describe('Contextual V3 candidate evaluation helpers', () => {
  it('orders hero-phase, hero, and global train observations deterministically', () => {
    const catalog = {
      itemIds: new Set([100, 200, 300, 400]),
      componentsByParent: new Map<number, Set<number>>(),
    };

    expect(
      orderContextualV3CandidateActions(
        { 'BUY:100': 1 },
        { 'BUY:200': 50 },
        { 'BUY:300': 10_000, 'BUY:400': 5_000 },
        new Set(),
        catalog,
      ),
    ).toEqual(['BUY:100', 'BUY:200', 'BUY:300', 'BUY:400']);
  });

  it('requires every direct component for an upgrade candidate', () => {
    const catalog = {
      itemIds: new Set([100, 200, 300]),
      componentsByParent: new Map([[300, new Set([100, 200])]]),
    };

    expect(
      isContextualV3CandidateActionLegal('UPGRADE:300', new Set([100]), catalog),
    ).toBe(false);
    expect(
      isContextualV3CandidateActionLegal(
        'UPGRADE:300',
        new Set([100, 200]),
        catalog,
      ),
    ).toBe(true);
  });

  it('rejects held buys, sell targets, and unknown catalog items', () => {
    const catalog = {
      itemIds: new Set([100]),
      componentsByParent: new Map<number, Set<number>>(),
    };

    expect(isContextualV3CandidateActionLegal('BUY:100', new Set([100]), catalog)).toBe(
      false,
    );
    expect(isContextualV3CandidateActionLegal('SELL:100', new Set(), catalog)).toBe(false);
    expect(isContextualV3CandidateActionLegal('BUY:200', new Set(), catalog)).toBe(false);
  });

  it('passes only when coverage and ranking gates all pass', () => {
    expect(buildContextualV3CandidateReleaseGate(0.98, 0.001, -0.0005)).toEqual({
      passed: true,
      reasons: [],
    });
    expect(buildContextualV3CandidateReleaseGate(0.979, 0.0009, -0.0006)).toEqual({
      passed: false,
      reasons: [
        'Candidate coverage is below 98%.',
        'Contextual Top-1 improvement is below 0.10 percentage points.',
        'Contextual Top-3 regression exceeds 0.05 percentage points.',
      ],
    });
  });
});
