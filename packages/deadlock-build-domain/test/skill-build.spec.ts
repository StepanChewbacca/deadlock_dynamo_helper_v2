import {
  applySkillBuildAction,
  createInitialSkillBuildState,
  createSkillBuildAction,
  createSkillBuildStateKey,
  DEFAULT_SKILL_BUILD_RULESET,
  findBestSkillBuildPath,
  getSkillBuildSpentPoints,
  replaySkillBuild,
  SkillBuildGraphAccumulator,
  SkillSlot,
} from '../src';

const ABILITY_SLOT_BY_ID: Record<number, SkillSlot> = {
  101: 1,
  102: 2,
  103: 3,
  104: 4,
};

describe('skill build domain', () => {
  it('uses 1/1/2/5 point costs for unlock and upgrades', () => {
    let state = createInitialSkillBuildState();

    const unlock = createSkillBuildAction(101, 1, state);
    expect(unlock.type).toBe('UNLOCK');
    expect(unlock.pointCost).toBe(1);
    state = applySkillBuildAction(state, unlock);

    const tier1 = createSkillBuildAction(101, 1, state);
    expect(tier1.type).toBe('UPGRADE');
    expect(tier1.upgradeTier).toBe(1);
    expect(tier1.pointCost).toBe(1);
    state = applySkillBuildAction(state, tier1);

    const tier2 = createSkillBuildAction(101, 1, state);
    expect(tier2.pointCost).toBe(2);
    state = applySkillBuildAction(state, tier2);

    const tier3 = createSkillBuildAction(101, 1, state);
    expect(tier3.pointCost).toBe(5);
    state = applySkillBuildAction(state, tier3);

    expect(getSkillBuildSpentPoints(state)).toBe(9);
  });

  it('replays chronological skill upgrades into a valid state', () => {
    const result = replaySkillBuild(
      [
        { abilityId: 101, upgradeOrder: 1, upgradeTimeS: 10 },
        { abilityId: 102, upgradeOrder: 2, upgradeTimeS: 20 },
        { abilityId: 101, upgradeOrder: 3, upgradeTimeS: 30 },
      ],
      ABILITY_SLOT_BY_ID,
    );

    expect(result.valid).toBe(true);
    expect(result.actions).toHaveLength(3);
    expect(createSkillBuildStateKey(result.state)).toBe('2:1:0:0');
  });

  it('returns the valid prefix when an unknown ability is encountered', () => {
    const result = replaySkillBuild(
      [
        { abilityId: 101, upgradeOrder: 1 },
        { abilityId: 999, upgradeOrder: 2 },
        { abilityId: 102, upgradeOrder: 3 },
      ],
      ABILITY_SLOT_BY_ID,
    );

    expect(result.valid).toBe(false);
    expect(result.actions).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('UNKNOWN_ABILITY');
    expect(createSkillBuildStateKey(result.state)).toBe('1:0:0:0');
  });

  it('rejects duplicate upgrade order values', () => {
    const result = replaySkillBuild(
      [
        { abilityId: 101, upgradeOrder: 1 },
        { abilityId: 102, upgradeOrder: 1 },
      ],
      ABILITY_SLOT_BY_ID,
    );

    expect(result.valid).toBe(false);
    expect(result.actions).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('DUPLICATE_UPGRADE_ORDER');
  });

  it('builds a state-conditioned path instead of positional mode', () => {
    const accumulator = new SkillBuildGraphAccumulator();

    accumulator.addPath(
      [
        { abilityId: 101, upgradeOrder: 1 },
        { abilityId: 102, upgradeOrder: 2 },
        { abilityId: 101, upgradeOrder: 3 },
      ],
      ABILITY_SLOT_BY_ID,
    );
    accumulator.addPath(
      [
        { abilityId: 101, upgradeOrder: 1 },
        { abilityId: 102, upgradeOrder: 2 },
        { abilityId: 101, upgradeOrder: 3 },
      ],
      ABILITY_SLOT_BY_ID,
    );
    accumulator.addPath(
      [
        { abilityId: 102, upgradeOrder: 1 },
        { abilityId: 103, upgradeOrder: 2 },
        { abilityId: 102, upgradeOrder: 3 },
      ],
      ABILITY_SLOT_BY_ID,
    );

    const path = findBestSkillBuildPath(accumulator.build());

    expect(path.map((step) => step.skillSlot)).toEqual([1, 2, 1]);
    expect(path.map((step) => step.cumulativePointCost)).toEqual([1, 2, 3]);
  });

  it('chooses the globally strongest path instead of the greedy first transition', () => {
    const accumulator = new SkillBuildGraphAccumulator();

    for (let index = 0; index < 5; index += 1) {
      accumulator.addPath(
        [{ abilityId: 101, upgradeOrder: 1 }],
        ABILITY_SLOT_BY_ID,
      );
    }
    accumulator.addPath(
      [
        { abilityId: 101, upgradeOrder: 1 },
        { abilityId: 102, upgradeOrder: 2 },
      ],
      ABILITY_SLOT_BY_ID,
    );

    for (let index = 0; index < 5; index += 1) {
      accumulator.addPath(
        [
          { abilityId: 102, upgradeOrder: 1 },
          { abilityId: 103, upgradeOrder: 2 },
          { abilityId: 102, upgradeOrder: 3 },
        ],
        ABILITY_SLOT_BY_ID,
      );
    }

    const graph = accumulator.build();
    expect(graph.statesByKey.get(graph.rootStateKey)?.outgoingTransitions[0]?.action.skillSlot).toBe(1);

    const path = findBestSkillBuildPath(graph);

    expect(path.map((step) => step.skillSlot)).toEqual([2, 3, 2]);
  });

  it('stops before an action that exceeds the point budget', () => {
    const accumulator = new SkillBuildGraphAccumulator(DEFAULT_SKILL_BUILD_RULESET);

    accumulator.addPath(
      [
        { abilityId: 101, upgradeOrder: 1 },
        { abilityId: 101, upgradeOrder: 2 },
        { abilityId: 101, upgradeOrder: 3 },
        { abilityId: 101, upgradeOrder: 4 },
      ],
      ABILITY_SLOT_BY_ID,
    );

    const path = findBestSkillBuildPath(accumulator.build(), { maxPointBudget: 4 });

    expect(path).toHaveLength(3);
    expect(path[path.length - 1]?.cumulativePointCost).toBe(4);
  });
});
