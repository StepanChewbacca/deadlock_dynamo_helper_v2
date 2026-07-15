import {
  FindSkillBuildPathOptions,
  SkillBuildGraph,
  SkillBuildGraphTransition,
  SkillBuildPathStep,
} from './skill-build';

interface SkillBuildPathCandidate {
  transitions: readonly SkillBuildGraphTransition[];
  totalScore: number;
  totalPointCost: number;
}

const SCORE_EPSILON = 1e-12;

export function findBestSkillBuildPath(
  graph: SkillBuildGraph,
  options: FindSkillBuildPathOptions = {},
): SkillBuildPathStep[] {
  const maxPointBudget = options.maxPointBudget ?? Number.POSITIVE_INFINITY;
  const maxActions = options.maxActions ?? Number.POSITIVE_INFINITY;
  const memo = new Map<string, SkillBuildPathCandidate>();
  const visiting = new Set<string>();

  const candidate = findBestCandidate(
    graph,
    graph.rootStateKey,
    maxPointBudget,
    maxActions,
    memo,
    visiting,
  );

  let cumulativePointCost = 0;
  return candidate.transitions.map((transition, index): SkillBuildPathStep => {
    cumulativePointCost += transition.action.pointCost;
    const state = graph.statesByKey.get(transition.fromStateKey);

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
  graph: SkillBuildGraph,
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

  const state = graph.statesByKey.get(stateKey);
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
        graph,
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
