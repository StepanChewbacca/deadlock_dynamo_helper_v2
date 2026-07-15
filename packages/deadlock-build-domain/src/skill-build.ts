export type SkillSlot = 1 | 2 | 3 | 4;
export type SkillLevel = 0 | 1 | 2 | 3 | 4;
export type SkillBuildActionType = 'UNLOCK' | 'UPGRADE';

export interface SkillUpgradeObservation {
  abilityId: number;
  upgradeOrder: number;
  upgradeTimeS?: number;
}

export interface SkillBuildRuleset {
  pointCostByTargetLevel: Readonly<Record<Exclude<SkillLevel, 0>, number>>;
}

export interface SkillBuildState {
  levels: Readonly<Record<SkillSlot, SkillLevel>>;
}

export interface SkillBuildAction {
  abilityId: number;
  skillSlot: SkillSlot;
  type: SkillBuildActionType;
  fromLevel: SkillLevel;
  toLevel: Exclude<SkillLevel, 0>;
  upgradeTier: 0 | 1 | 2 | 3;
  pointCost: number;
}

export interface SkillBuildPathStep extends SkillBuildAction {
  actionIndex: number;
  cumulativePointCost: number;
  sampleSize: number;
  pickRate: number;
  averageUpgradeTimeS?: number;
}

export interface SkillBuildDiagnostic {
  code:
    | 'UNKNOWN_ABILITY'
    | 'DUPLICATE_UPGRADE_ORDER'
    | 'MAX_LEVEL_EXCEEDED'
    | 'INVALID_UPGRADE_ORDER';
  message: string;
  upgradeOrder?: number;
  abilityId?: number;
}

export interface SkillBuildReplayResult {
  valid: boolean;
  state: SkillBuildState;
  actions: SkillBuildAction[];
  diagnostics: SkillBuildDiagnostic[];
}

export interface SkillBuildGraphTransition {
  fromStateKey: string;
  toStateKey: string;
  action: SkillBuildAction;
  count: number;
  totalUpgradeTimeS: number;
  upgradeTimeSampleCount: number;
}

export interface SkillBuildGraphState {
  stateKey: string;
  state: SkillBuildState;
  observationCount: number;
  outgoingTransitions: readonly SkillBuildGraphTransition[];
}

export interface SkillBuildGraph {
  rootStateKey: string;
  sourcePathCount: number;
  statesByKey: ReadonlyMap<string, SkillBuildGraphState>;
}

export const DEFAULT_SKILL_BUILD_RULESET: SkillBuildRuleset = {
  pointCostByTargetLevel: {
    1: 1,
    2: 1,
    3: 2,
    4: 5,
  },
};

export function createInitialSkillBuildState(): SkillBuildState {
  return {
    levels: {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
    },
  };
}

export function createSkillBuildStateKey(state: SkillBuildState): string {
  return `${state.levels[1]}:${state.levels[2]}:${state.levels[3]}:${state.levels[4]}`;
}

export function getSkillBuildSpentPoints(
  state: SkillBuildState,
  ruleset: SkillBuildRuleset = DEFAULT_SKILL_BUILD_RULESET,
): number {
  let total = 0;
  for (const slot of [1, 2, 3, 4] as const) {
    const level = state.levels[slot];
    for (let targetLevel = 1; targetLevel <= level; targetLevel += 1) {
      total += ruleset.pointCostByTargetLevel[targetLevel as Exclude<SkillLevel, 0>];
    }
  }
  return total;
}

export function createSkillBuildAction(
  abilityId: number,
  skillSlot: SkillSlot,
  state: SkillBuildState,
  ruleset: SkillBuildRuleset = DEFAULT_SKILL_BUILD_RULESET,
): SkillBuildAction {
  const fromLevel = state.levels[skillSlot];
  if (fromLevel >= 4) {
    throw new Error(`Skill ${skillSlot} is already at maximum level`);
  }

  const toLevel = (fromLevel + 1) as Exclude<SkillLevel, 0>;
  return {
    abilityId,
    skillSlot,
    type: fromLevel === 0 ? 'UNLOCK' : 'UPGRADE',
    fromLevel,
    toLevel,
    upgradeTier: fromLevel as 0 | 1 | 2 | 3,
    pointCost: ruleset.pointCostByTargetLevel[toLevel],
  };
}

export function applySkillBuildAction(
  state: SkillBuildState,
  action: SkillBuildAction,
): SkillBuildState {
  if (state.levels[action.skillSlot] !== action.fromLevel) {
    throw new Error(
      `Skill ${action.skillSlot} expected level ${action.fromLevel}, got ${state.levels[action.skillSlot]}`,
    );
  }

  return {
    levels: {
      ...state.levels,
      [action.skillSlot]: action.toLevel,
    },
  };
}

export function replaySkillBuild(
  observations: readonly SkillUpgradeObservation[],
  abilitySlotById: Readonly<Record<number, SkillSlot>>,
  ruleset: SkillBuildRuleset = DEFAULT_SKILL_BUILD_RULESET,
): SkillBuildReplayResult {
  const diagnostics: SkillBuildDiagnostic[] = [];
  const seenOrders = new Set<number>();
  let state = createInitialSkillBuildState();
  const actions: SkillBuildAction[] = [];

  const ordered = [...observations].sort((left, right) => left.upgradeOrder - right.upgradeOrder);

  for (let index = 0; index < ordered.length; index += 1) {
    const observation = ordered[index];
    if (seenOrders.has(observation.upgradeOrder)) {
      diagnostics.push({
        code: 'DUPLICATE_UPGRADE_ORDER',
        message: `Duplicate upgrade order ${observation.upgradeOrder}`,
        upgradeOrder: observation.upgradeOrder,
        abilityId: observation.abilityId,
      });
      break;
    }
    seenOrders.add(observation.upgradeOrder);

    if (index > 0 && observation.upgradeOrder <= ordered[index - 1].upgradeOrder) {
      diagnostics.push({
        code: 'INVALID_UPGRADE_ORDER',
        message: `Upgrade order ${observation.upgradeOrder} is not strictly increasing`,
        upgradeOrder: observation.upgradeOrder,
        abilityId: observation.abilityId,
      });
      break;
    }

    const skillSlot = abilitySlotById[observation.abilityId];
    if (!skillSlot) {
      diagnostics.push({
        code: 'UNKNOWN_ABILITY',
        message: `Ability ${observation.abilityId} is not mapped to a skill slot`,
        upgradeOrder: observation.upgradeOrder,
        abilityId: observation.abilityId,
      });
      break;
    }

    if (state.levels[skillSlot] >= 4) {
      diagnostics.push({
        code: 'MAX_LEVEL_EXCEEDED',
        message: `Skill ${skillSlot} cannot be upgraded above level 4`,
        upgradeOrder: observation.upgradeOrder,
        abilityId: observation.abilityId,
      });
      break;
    }

    const action = createSkillBuildAction(observation.abilityId, skillSlot, state, ruleset);
    actions.push(action);
    state = applySkillBuildAction(state, action);
  }

  return {
    valid: diagnostics.length === 0,
    state,
    actions,
    diagnostics,
  };
}

interface MutableTransition {
  fromStateKey: string;
  toStateKey: string;
  action: SkillBuildAction;
  count: number;
  totalUpgradeTimeS: number;
  upgradeTimeSampleCount: number;
}

interface MutableState {
  state: SkillBuildState;
  observationCount: number;
  transitionsByKey: Map<string, MutableTransition>;
}

export class SkillBuildGraphAccumulator {
  private readonly statesByKey = new Map<string, MutableState>();
  private sourcePathCount = 0;

  constructor(private readonly ruleset: SkillBuildRuleset = DEFAULT_SKILL_BUILD_RULESET) {
    const initialState = createInitialSkillBuildState();
    this.statesByKey.set(createSkillBuildStateKey(initialState), {
      state: initialState,
      observationCount: 0,
      transitionsByKey: new Map(),
    });
  }

  addPath(
    observations: readonly SkillUpgradeObservation[],
    abilitySlotById: Readonly<Record<number, SkillSlot>>,
  ): SkillBuildReplayResult {
    const replay = replaySkillBuild(observations, abilitySlotById, this.ruleset);
    let state = createInitialSkillBuildState();
    this.sourcePathCount += 1;

    const ordered = [...observations].sort((left, right) => left.upgradeOrder - right.upgradeOrder);
    for (let index = 0; index < replay.actions.length; index += 1) {
      const action = replay.actions[index];
      const observation = ordered[index];
      const fromStateKey = createSkillBuildStateKey(state);
      const nextState = applySkillBuildAction(state, action);
      const toStateKey = createSkillBuildStateKey(nextState);

      const mutableState = this.statesByKey.get(fromStateKey) ?? {
        state,
        observationCount: 0,
        transitionsByKey: new Map<string, MutableTransition>(),
      };
      mutableState.observationCount += 1;

      const transitionKey = `${action.skillSlot}:${action.toLevel}`;
      const transition = mutableState.transitionsByKey.get(transitionKey) ?? {
        fromStateKey,
        toStateKey,
        action,
        count: 0,
        totalUpgradeTimeS: 0,
        upgradeTimeSampleCount: 0,
      };
      transition.count += 1;
      if (observation?.upgradeTimeS !== undefined) {
        transition.totalUpgradeTimeS += observation.upgradeTimeS;
        transition.upgradeTimeSampleCount += 1;
      }
      mutableState.transitionsByKey.set(transitionKey, transition);
      this.statesByKey.set(fromStateKey, mutableState);

      if (!this.statesByKey.has(toStateKey)) {
        this.statesByKey.set(toStateKey, {
          state: nextState,
          observationCount: 0,
          transitionsByKey: new Map(),
        });
      }

      state = nextState;
    }

    return replay;
  }

  build(): SkillBuildGraph {
    const immutableStates = new Map<string, SkillBuildGraphState>();
    for (const [stateKey, mutableState] of this.statesByKey) {
      const outgoingTransitions = [...mutableState.transitionsByKey.values()]
        .map((transition): SkillBuildGraphTransition => ({ ...transition }))
        .sort((left, right) => {
          if (right.count !== left.count) {
            return right.count - left.count;
          }
          if (left.action.skillSlot !== right.action.skillSlot) {
            return left.action.skillSlot - right.action.skillSlot;
          }
          return left.action.toLevel - right.action.toLevel;
        });

      immutableStates.set(stateKey, {
        stateKey,
        state: mutableState.state,
        observationCount: mutableState.observationCount,
        outgoingTransitions,
      });
    }

    return {
      rootStateKey: createSkillBuildStateKey(createInitialSkillBuildState()),
      sourcePathCount: this.sourcePathCount,
      statesByKey: immutableStates,
    };
  }
}

export interface FindSkillBuildPathOptions {
  maxPointBudget?: number;
  maxActions?: number;
}

export function findMostPopularSkillBuildPath(
  graph: SkillBuildGraph,
  options: FindSkillBuildPathOptions = {},
): SkillBuildPathStep[] {
  const maxPointBudget = options.maxPointBudget ?? Number.POSITIVE_INFINITY;
  const maxActions = options.maxActions ?? Number.POSITIVE_INFINITY;
  const path: SkillBuildPathStep[] = [];
  let stateKey = graph.rootStateKey;
  let cumulativePointCost = 0;

  while (path.length < maxActions) {
    const state = graph.statesByKey.get(stateKey);
    if (!state || state.outgoingTransitions.length === 0) {
      break;
    }

    const transition = state.outgoingTransitions.find(
      (candidate) => cumulativePointCost + candidate.action.pointCost <= maxPointBudget,
    );
    if (!transition) {
      break;
    }

    cumulativePointCost += transition.action.pointCost;
    path.push({
      ...transition.action,
      actionIndex: path.length + 1,
      cumulativePointCost,
      sampleSize: transition.count,
      pickRate:
        state.observationCount > 0 ? transition.count / state.observationCount : 0,
      averageUpgradeTimeS:
        transition.upgradeTimeSampleCount > 0
          ? transition.totalUpgradeTimeS / transition.upgradeTimeSampleCount
          : undefined,
    });
    stateKey = transition.toStateKey;
  }

  return path;
}
