import {
  FindSkillBuildPathOptions,
  SkillBuildAction,
  SkillBuildGraph,
  SkillBuildGraphState,
  SkillBuildGraphTransition,
  SkillBuildPathStep,
  SkillBuildState,
  SkillLevel,
  SkillSlot,
  createSkillBuildStateKey,
} from './skill-build';

export interface FindBestSkillBuildPathOptions extends FindSkillBuildPathOptions {
  startStateKey?: string;
  initialPointCost?: number;
}

interface SkillBuildPathCandidate {
  transitions: readonly SkillBuildGraphTransition[];
  totalScore: number;
  totalPointCost: number;
}

interface SearchStateResolver {
  getState(stateKey: string): SkillBuildGraphState | undefined;
}

const SCORE_EPSILON = 1e-12;
const SKILL_SLOTS = [1, 2, 3, 4] as const;

export function findBestSkillBuildPath(
  graph: SkillBuildGraph,
  options: FindBestSkillBuildPathOptions = {},
): SkillBuildPathStep[] {
  const maxPointBudget = options.maxPointBudget ?? Number.POSITIVE_INFINITY;
  const maxActions = options.maxActions ?? Number.POSITIVE_INFINITY;
  const initialPointCost = options.initialPointCost ?? 0;
  const startStateKey = options.startStateKey ?? graph.rootStateKey;
  const memo = new Map<string, SkillBuildPathCandidate>();
  const visiting = new Set<string>();
  const stateResolver = createSearchStateResolver(graph);

  const candidate = findBestCandidate(
    stateResolver,
    startStateKey,
    maxPointBudget,
    maxActions,
    memo,
    visiting,
  );

  let cumulativePointCost = initialPointCost;
  return candidate.transitions.map((transition, index): SkillBuildPathStep => {
    cumulativePointCost += transition.action.pointCost;
    const state = stateResolver.getState(transition.fromStateKey);

    return {
      ...transition.action,
      actionIndex: index + 1,
      cumulativePointCost,
      sampleSize: transition.count,
      pickRate:
        state && state.observationCount > 0
          ? transition.count / state.observationCount
          : 0,
      averageUpgradeTimeS:
        transition.upgradeTimeSampleCount > 0
          ? transition.totalUpgradeTimeS / transition.upgradeTimeSampleCount
          : undefined,
    };
  });
}

function findBestCandidate(
  stateResolver: SearchStateResolver,
  stateKey: string,
  remainingPointBudget: number,
  remainingActions: number,
  memo: Map<string, SkillBuildPathCandidate>,
  visiting: Set<string>,
): SkillBuildPathCandidate {
  if (remainingActions <= 0) {
    return createEmptyCandidate();
  }

  const memoKey = `${stateKey}|${remainingPointBudget}|${remainingActions}`;
  const cached = memo.get(memoKey);
  if (cached) {
    return cached;
  }
  if (visiting.has(memoKey)) {
    throw new Error(`Skill build graph contains a cycle at state ${stateKey}`);
  }

  const state = stateResolver.getState(stateKey);
  if (!state || state.outgoingTransitions.length === 0) {
    const empty = createEmptyCandidate();
    memo.set(memoKey, empty);
    return empty;
  }

  visiting.add(memoKey);
  let best = createEmptyCandidate();

  try {
    for (const transition of state.outgoingTransitions) {
      if (transition.action.pointCost > remainingPointBudget) {
        continue;
      }

      const child = findBestCandidate(
        stateResolver,
        transition.toStateKey,
        remainingPointBudget - transition.action.pointCost,
        remainingActions - 1,
        memo,
        visiting,
      );
      const candidate: SkillBuildPathCandidate = {
        transitions: [transition, ...child.transitions],
        totalScore: getTransitionScore(transition) + child.totalScore,
        totalPointCost: transition.action.pointCost + child.totalPointCost,
      };

      if (isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }
  } finally {
    visiting.delete(memoKey);
  }

  memo.set(memoKey, best);
  return best;
}

function createSearchStateResolver(graph: SkillBuildGraph): SearchStateResolver {
  const syntheticStates = new Map<string, SkillBuildGraphState>();

  return {
    getState(stateKey: string): SkillBuildGraphState | undefined {
      const exact = graph.statesByKey.get(stateKey);
      if (exact) {
        return exact;
      }

      const cached = syntheticStates.get(stateKey);
      if (cached) {
        return cached;
      }

      const state = parseSkillBuildStateKey(stateKey);
      if (!state) {
        return undefined;
      }

      const synthetic = createBackoffState(graph, state);
      syntheticStates.set(stateKey, synthetic);
      return synthetic;
    },
  };
}

function createBackoffState(
  graph: SkillBuildGraph,
  state: SkillBuildState,
): SkillBuildGraphState {
  const stateKey = createSkillBuildStateKey(state);
  const transitionsByKey = new Map<string, SkillBuildGraphTransition>();

  for (const graphState of graph.statesByKey.values()) {
    for (const transition of graphState.outgoingTransitions) {
      const slot = transition.action.skillSlot;
      if (transition.action.fromLevel !== state.levels[slot]) {
        continue;
      }

      const key = `${slot}:${transition.action.toLevel}`;
      const existing = transitionsByKey.get(key);
      if (existing) {
        existing.count += transition.count;
        existing.totalUpgradeTimeS += transition.totalUpgradeTimeS;
        existing.upgradeTimeSampleCount += transition.upgradeTimeSampleCount;
        continue;
      }

      const action = createBackoffAction(transition.action, state);
      const nextState = applyActionToState(state, action);
      transitionsByKey.set(key, {
        fromStateKey: stateKey,
        toStateKey: createSkillBuildStateKey(nextState),
        action,
        count: transition.count,
        totalUpgradeTimeS: transition.totalUpgradeTimeS,
        upgradeTimeSampleCount: transition.upgradeTimeSampleCount,
      });
    }
  }

  const outgoingTransitions = [...transitionsByKey.values()].sort(compareTransitions);
  return {
    stateKey,
    state,
    observationCount: outgoingTransitions.reduce((total, transition) => total + transition.count, 0),
    outgoingTransitions,
  };
}

function createBackoffAction(
  template: SkillBuildAction,
  state: SkillBuildState,
): SkillBuildAction {
  const fromLevel = state.levels[template.skillSlot];
  const toLevel = (fromLevel + 1) as Exclude<SkillLevel, 0>;

  return {
    ...template,
    type: fromLevel === 0 ? 'UNLOCK' : 'UPGRADE',
    fromLevel,
    toLevel,
    upgradeTier: fromLevel as 0 | 1 | 2 | 3,
  };
}

function applyActionToState(
  state: SkillBuildState,
  action: SkillBuildAction,
): SkillBuildState {
  return {
    levels: {
      ...state.levels,
      [action.skillSlot]: action.toLevel,
    },
  };
}

function parseSkillBuildStateKey(stateKey: string): SkillBuildState | undefined {
  const values = stateKey.split(':').map((value) => Number(value));
  if (
    values.length !== SKILL_SLOTS.length ||
    values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 4)
  ) {
    return undefined;
  }

  return {
    levels: {
      1: values[0] as SkillLevel,
      2: values[1] as SkillLevel,
      3: values[2] as SkillLevel,
      4: values[3] as SkillLevel,
    },
  };
}

function compareTransitions(
  left: SkillBuildGraphTransition,
  right: SkillBuildGraphTransition,
): number {
  if (right.count !== left.count) {
    return right.count - left.count;
  }
  if (left.action.skillSlot !== right.action.skillSlot) {
    return left.action.skillSlot - right.action.skillSlot;
  }
  return left.action.toLevel - right.action.toLevel;
}

function getTransitionScore(transition: SkillBuildGraphTransition): number {
  return Math.log1p(Math.max(0, transition.count));
}

function isBetterCandidate(
  candidate: SkillBuildPathCandidate,
  current: SkillBuildPathCandidate,
): boolean {
  if (candidate.totalScore > current.totalScore + SCORE_EPSILON) {
    return true;
  }
  if (current.totalScore > candidate.totalScore + SCORE_EPSILON) {
    return false;
  }

  if (candidate.totalPointCost !== current.totalPointCost) {
    return candidate.totalPointCost > current.totalPointCost;
  }
  if (candidate.transitions.length !== current.transitions.length) {
    return candidate.transitions.length > current.transitions.length;
  }

  return compareTransitionPaths(candidate.transitions, current.transitions) < 0;
}

function compareTransitionPaths(
  left: readonly SkillBuildGraphTransition[],
  right: readonly SkillBuildGraphTransition[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftTransition = left[index];
    const rightTransition = right[index];

    if (leftTransition.count !== rightTransition.count) {
      return rightTransition.count - leftTransition.count;
    }
    if (leftTransition.action.skillSlot !== rightTransition.action.skillSlot) {
      return leftTransition.action.skillSlot - rightTransition.action.skillSlot;
    }
    if (leftTransition.action.toLevel !== rightTransition.action.toLevel) {
      return leftTransition.action.toLevel - rightTransition.action.toLevel;
    }

    const stateComparison = leftTransition.toStateKey.localeCompare(rightTransition.toStateKey);
    if (stateComparison !== 0) {
      return stateComparison;
    }
  }

  return left.length - right.length;
}

function createEmptyCandidate(): SkillBuildPathCandidate {
  return {
    transitions: [],
    totalScore: 0,
    totalPointCost: 0,
  };
}
