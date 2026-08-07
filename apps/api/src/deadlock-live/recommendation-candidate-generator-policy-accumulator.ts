import type { HeroBuildDecisionDatasetV3Row } from './hero-build-decision-dataset-v3.service';
import type { RecommendationSerializedHeroBuildPolicy } from './recommendation-candidate-generator-snapshot';
import type { HeroBuildPolicyNextAction } from './hero-build-transition-aggregation.service';

interface MutableAction {
  actionType: HeroBuildDecisionDatasetV3Row['actualActionType'];
  itemId: number;
  actionKey: string;
  count: number;
  totalGameTimeS: number;
  afterStateCounts: Map<string, number>;
}

interface MutableState {
  observationCount: number;
  actionsByKey: Map<string, MutableAction>;
}

interface MutableHero {
  playerKeys: Set<string>;
  transitionCount: number;
  statesByKey: Map<string, MutableState>;
}

export interface RecommendationCandidateGeneratorPolicySummary {
  rowCount: number;
  heroCount: number;
  playerCount: number;
  stateCount: number;
  transitionCount: number;
  actionOptionCount: number;
}

export class RecommendationCandidateGeneratorPolicyAccumulator {
  private readonly heroesById = new Map<number, MutableHero>();
  private rowCount = 0;

  observe(row: HeroBuildDecisionDatasetV3Row): void {
    validateRow(row);
    const hero = this.heroesById.get(row.heroId) ?? {
      playerKeys: new Set<string>(),
      transitionCount: 0,
      statesByKey: new Map<string, MutableState>(),
    };
    hero.playerKeys.add(`${row.matchId}:${row.playerId}`);

    const state = hero.statesByKey.get(row.inventoryBeforeStateKey) ?? {
      observationCount: 0,
      actionsByKey: new Map<string, MutableAction>(),
    };
    state.observationCount += 1;

    const action = state.actionsByKey.get(row.actualActionKey) ?? {
      actionType: row.actualActionType,
      itemId: row.actualItemId,
      actionKey: row.actualActionKey,
      count: 0,
      totalGameTimeS: 0,
      afterStateCounts: new Map<string, number>(),
    };
    if (
      action.actionType !== row.actualActionType ||
      action.itemId !== row.actualItemId
    ) {
      throw new Error(
        `Action key ${row.actualActionKey} maps to conflicting action metadata.`,
      );
    }
    action.count += 1;
    action.totalGameTimeS += row.gameTimeS;
    action.afterStateCounts.set(
      row.inventoryAfterStateKey,
      (action.afterStateCounts.get(row.inventoryAfterStateKey) ?? 0) + 1,
    );

    state.actionsByKey.set(row.actualActionKey, action);
    hero.statesByKey.set(row.inventoryBeforeStateKey, state);
    hero.transitionCount += 1;
    this.heroesById.set(row.heroId, hero);
    this.rowCount += 1;
  }

  release(): void {
    this.heroesById.clear();
    this.rowCount = 0;
  }

  build(): {
    policies: RecommendationSerializedHeroBuildPolicy[];
    summary: RecommendationCandidateGeneratorPolicySummary;
  } {
    const policies: RecommendationSerializedHeroBuildPolicy[] = [];
    let playerCount = 0;
    let stateCount = 0;
    let transitionCount = 0;
    let actionOptionCount = 0;

    for (const [heroId, hero] of [...this.heroesById.entries()].sort(
      ([left], [right]) => left - right,
    )) {
      const states = [...hero.statesByKey.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([stateKey, state]) => {
          const nextActions = [...state.actionsByKey.values()]
            .map((action): HeroBuildPolicyNextAction => ({
              actionType: action.actionType,
              itemId: action.itemId,
              actionKey: action.actionKey,
              count: action.count,
              probability: action.count / state.observationCount,
              averageGameTimeS: action.totalGameTimeS / action.count,
              afterStates: [...action.afterStateCounts.entries()]
                .map(([afterStateKey, count]) => ({
                  afterStateKey,
                  count,
                  probability: count / action.count,
                }))
                .sort(
                  (left, right) =>
                    right.count - left.count ||
                    left.afterStateKey.localeCompare(right.afterStateKey),
                ),
            }))
            .sort(
              (left, right) =>
                right.count - left.count ||
                left.actionKey.localeCompare(right.actionKey),
            );
          actionOptionCount += nextActions.length;
          return {
            stateKey,
            observationCount: state.observationCount,
            nextActionCount: nextActions.length,
            nextActions,
          };
        });

      policies.push({
        heroId,
        playerCount: hero.playerKeys.size,
        stateCount: states.length,
        transitionCount: hero.transitionCount,
        states,
      });
      playerCount += hero.playerKeys.size;
      stateCount += states.length;
      transitionCount += hero.transitionCount;
    }

    return {
      policies,
      summary: {
        rowCount: this.rowCount,
        heroCount: policies.length,
        playerCount,
        stateCount,
        transitionCount,
        actionOptionCount,
      },
    };
  }
}

function validateRow(row: HeroBuildDecisionDatasetV3Row): void {
  if (!row.decisionId.trim()) {
    throw new Error('Candidate generator source decisionId is required.');
  }
  if (!Number.isSafeInteger(row.matchId) || row.matchId <= 0) {
    throw new Error('Candidate generator source matchId must be positive.');
  }
  if (!Number.isSafeInteger(row.playerId) || row.playerId <= 0) {
    throw new Error('Candidate generator source playerId must be positive.');
  }
  if (!Number.isSafeInteger(row.heroId) || row.heroId <= 0) {
    throw new Error('Candidate generator source heroId must be positive.');
  }
  if (!Number.isFinite(row.gameTimeS) || row.gameTimeS < 0) {
    throw new Error('Candidate generator source gameTimeS must be non-negative.');
  }
  if (!row.inventoryBeforeStateKey.trim()) {
    throw new Error('Candidate generator source before state is required.');
  }
  if (!row.inventoryAfterStateKey.trim()) {
    throw new Error('Candidate generator source after state is required.');
  }
  if (!row.actualActionKey.trim()) {
    throw new Error('Candidate generator source action key is required.');
  }
  if (!Number.isSafeInteger(row.actualItemId) || row.actualItemId <= 0) {
    throw new Error('Candidate generator source item ID must be positive.');
  }
}
