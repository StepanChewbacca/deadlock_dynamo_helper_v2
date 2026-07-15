import {
  clearSkillBuildProgress,
  confirmRecommendedSkillAction,
  createSkillBuildObservationBaseline,
  createSkillBuildProgress,
  getAbilityItemCounts,
  loadSkillBuildProgress,
  reconcileSkillProgressFromAbilityCounts,
  recordActualSkillUpgrade,
  saveSkillBuildProgress,
  undoLastManualSkillUpgrade,
} from './skill-build-progress';
import type { SkillBuildPathStep } from './skill-build-client';

const ACTION: SkillBuildPathStep = {
  abilityId: 101,
  skillSlot: 1,
  type: 'UNLOCK',
  fromLevel: 0,
  toLevel: 1,
  upgradeTier: 0,
  pointCost: 1,
  actionIndex: 1,
  cumulativePointCost: 1,
  sampleSize: 10,
  pickRate: 0.5,
};

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('skill build progress', () => {
  it('persists progress per match and hero', () => {
    const storage = createStorage();
    const progress = recordActualSkillUpgrade(
      createSkillBuildProgress('match-1', 11),
      2,
    );

    saveSkillBuildProgress(storage, progress);

    expect(loadSkillBuildProgress(storage, 'match-1', 11)).toEqual(progress);
    expect(loadSkillBuildProgress(storage, 'match-2', 11).levels).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 0,
    });
  });

  it('confirms the recommended action and supports undo', () => {
    const confirmed = confirmRecommendedSkillAction(
      createSkillBuildProgress('match-1', 11),
      ACTION,
    );

    expect(confirmed.levels).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0 });
    expect(confirmed.manualHistory).toEqual([1]);
    expect(undoLastManualSkillUpgrade(confirmed).levels).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 0,
    });
  });

  it('records a different actual skill without exceeding max level', () => {
    let progress = createSkillBuildProgress('match-1', 11);
    for (let index = 0; index < 5; index += 1) {
      progress = recordActualSkillUpgrade(progress, 4);
    }

    expect(progress.levels[4]).toBe(4);
    expect(progress.manualHistory).toEqual([4, 4, 4, 4]);
  });

  it('uses ability count increases only after the observation baseline', () => {
    const abilityIds = { 1: 101, 2: 102, 3: 103, 4: 104 } as const;
    const progress = createSkillBuildProgress('match-1', 11);
    const baselineCounts = getAbilityItemCounts([101, 102], abilityIds);
    const baseline = createSkillBuildObservationBaseline(progress, baselineCounts);

    const unchanged = reconcileSkillProgressFromAbilityCounts(
      progress,
      baseline,
      getAbilityItemCounts([101, 102], abilityIds),
    );
    const upgraded = reconcileSkillProgressFromAbilityCounts(
      progress,
      baseline,
      getAbilityItemCounts([101, 101, 102], abilityIds),
    );

    expect(unchanged).toBe(progress);
    expect(upgraded.levels).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0 });
  });

  it('does not double count a manually confirmed action', () => {
    const abilityIds = { 1: 101, 2: 102, 3: 103, 4: 104 } as const;
    const initial = createSkillBuildProgress('match-1', 11);
    const baseline = createSkillBuildObservationBaseline(
      initial,
      getAbilityItemCounts([], abilityIds),
    );
    const confirmed = confirmRecommendedSkillAction(initial, ACTION);

    const reconciled = reconcileSkillProgressFromAbilityCounts(
      confirmed,
      baseline,
      getAbilityItemCounts([101], abilityIds),
    );

    expect(reconciled.levels[1]).toBe(1);
  });

  it('clears persisted progress', () => {
    const storage = createStorage();
    const progress = recordActualSkillUpgrade(
      createSkillBuildProgress('match-1', 11),
      3,
    );
    saveSkillBuildProgress(storage, progress);

    expect(clearSkillBuildProgress(storage, 'match-1', 11).levels[3]).toBe(0);
    expect(loadSkillBuildProgress(storage, 'match-1', 11).levels[3]).toBe(0);
  });
});
