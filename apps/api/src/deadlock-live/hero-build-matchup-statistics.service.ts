import { Injectable } from '@nestjs/common';
import { canonicalHeroId } from './all-heroes-analysis.service';
import { CanonicalBuildSequenceService } from './canonical-build-sequence.service';
import { InventoryTimelineReplayService } from './inventory-timeline-replay.service';
import { MatchTimelineNormalizationService } from './match-timeline-normalization.service';
import {
  RecentMatchSnapshot,
  RecentMatchesWindowService,
} from './recent-matches-window.service';
import { RecipeAwareTimelineReconciliationService } from './recipe-aware-timeline-reconciliation.service';

export const GRAPH_MATCHUP_MODEL_VERSION = 'GRAPH_EDGE_INTERACTION_ODDS_RATIO_V1';
export const GRAPH_MATCHUP_CONFIDENCE_Z = 1.96;
export const GRAPH_MATCHUP_CONTINUITY_CORRECTION = 0.5;

export interface GraphOutcomeSample {
  matches: number;
  wins: number;
}

export interface GraphMatchupInteractionInput {
  enemyHeroId: number;
  actionAgainst: GraphOutcomeSample;
  otherActionsAgainst: GraphOutcomeSample;
  actionWithoutEnemy: GraphOutcomeSample;
  otherActionsWithoutEnemy: GraphOutcomeSample;
}

export interface GraphMatchupEvidence {
  enemyHeroId: number;
  matchupObservationCount: number;
  actionMatchupObservationCount: number;
  otherActionMatchupObservationCount: number;
  actionWinRateAgainst: number;
  otherActionsWinRateAgainst: number;
  actionWinRateWithoutEnemy: number;
  otherActionsWinRateWithoutEnemy: number;
  interactionLogOddsRatio: number;
  interactionOddsRatio: number;
  standardError: number;
  lower95InteractionLogOddsRatio: number;
  upper95InteractionLogOddsRatio: number;
  lower95InteractionOddsRatio: number;
  upper95InteractionOddsRatio: number;
}

export interface GraphMatchupEvaluation {
  modelVersion: typeof GRAPH_MATCHUP_MODEL_VERSION;
  found: boolean;
  heroId: number;
  stateKey: string;
  actionKey: string;
  stateObservationCount: number;
  actionObservationCount: number;
  enemyHeroIds: number[];
  bestEvidence?: GraphMatchupEvidence;
  evidence: GraphMatchupEvidence[];
}

interface MutableOutcomeSample {
  matches: number;
  wins: number;
}

interface MutableGraphActionStats extends MutableOutcomeSample {
  byEnemyHeroId: Map<number, MutableOutcomeSample>;
}

interface MutableGraphStateStats extends MutableOutcomeSample {
  byEnemyHeroId: Map<number, MutableOutcomeSample>;
  actionsByKey: Map<string, MutableGraphActionStats>;
}

type HeroGraphMatchupIndex = Map<number, Map<string, MutableGraphStateStats>>;

@Injectable()
export class HeroBuildMatchupStatisticsService {
  private index: HeroGraphMatchupIndex = new Map();
  private sourceVersionMs = 0;
  private refreshPromise?: Promise<void>;

  constructor(
    private readonly recentMatchesWindowService: RecentMatchesWindowService,
    private readonly matchTimelineNormalizationService: MatchTimelineNormalizationService,
    private readonly inventoryTimelineReplayService: InventoryTimelineReplayService,
    private readonly canonicalBuildSequenceService: CanonicalBuildSequenceService,
    private readonly recipeAwareTimelineReconciliationService:
      RecipeAwareTimelineReconciliationService,
  ) {}

  async evaluate(input: {
    heroId: number;
    stateKey: string;
    actionKey: string;
    enemyHeroIds: number[];
  }): Promise<GraphMatchupEvaluation> {
    await this.ensureReady();

    const heroId = canonicalHeroId(input.heroId);
    const enemyHeroIds = normalizeHeroIds(input.enemyHeroIds);
    const state = this.index.get(heroId)?.get(input.stateKey);
    const action = state?.actionsByKey.get(input.actionKey);

    if (!state || !action) {
      return {
        modelVersion: GRAPH_MATCHUP_MODEL_VERSION,
        found: false,
        heroId,
        stateKey: input.stateKey,
        actionKey: input.actionKey,
        stateObservationCount: state?.matches ?? 0,
        actionObservationCount: action?.matches ?? 0,
        enemyHeroIds,
        evidence: [],
      };
    }

    const otherActionsTotal = subtractSamples(state, action);
    const evidence = enemyHeroIds
      .map((enemyHeroId) => {
        const stateAgainst = state.byEnemyHeroId.get(enemyHeroId) ?? emptySample();
        const actionAgainst = action.byEnemyHeroId.get(enemyHeroId) ?? emptySample();
        const otherActionsAgainst = subtractSamples(stateAgainst, actionAgainst);
        const stateWithoutEnemy = subtractSamples(state, stateAgainst);
        const actionWithoutEnemy = subtractSamples(action, actionAgainst);
        const otherActionsWithoutEnemy = subtractSamples(
          otherActionsTotal,
          otherActionsAgainst,
        );

        return calculateGraphMatchupInteraction({
          enemyHeroId,
          actionAgainst,
          otherActionsAgainst,
          actionWithoutEnemy,
          otherActionsWithoutEnemy,
        });
      })
      .filter((value): value is GraphMatchupEvidence => value !== undefined)
      .sort(compareEvidence);

    return {
      modelVersion: GRAPH_MATCHUP_MODEL_VERSION,
      found: evidence.length > 0,
      heroId,
      stateKey: input.stateKey,
      actionKey: input.actionKey,
      stateObservationCount: state.matches,
      actionObservationCount: action.matches,
      enemyHeroIds,
      bestEvidence: evidence[0],
      evidence,
    };
  }

  private async ensureReady(): Promise<void> {
    let status = this.recentMatchesWindowService.getStatus();
    if (!status.lastRefreshedAt) {
      status = await this.recentMatchesWindowService.refresh();
    }

    const sourceVersionMs = status.lastRefreshedAt?.getTime() ?? 0;
    if (this.sourceVersionMs === sourceVersionMs && this.index.size > 0) {
      return;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.rebuild(sourceVersionMs).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    await this.refreshPromise;
  }

  private async rebuild(sourceVersionMs: number): Promise<void> {
    try {
      await this.recipeAwareTimelineReconciliationService.refreshRecipes();
    } catch {
      // The replay pipeline can use its existing recipe cache when refresh is unavailable.
    }

    const nextIndex: HeroGraphMatchupIndex = new Map();
    for (const match of this.recentMatchesWindowService.getMatches()) {
      this.addMatch(nextIndex, match);
    }

    this.index = nextIndex;
    this.sourceVersionMs = sourceVersionMs;
  }

  private addMatch(index: HeroGraphMatchupIndex, match: RecentMatchSnapshot): void {
    const timelines = this.matchTimelineNormalizationService.normalizeMatch(match);
    const replay = this.inventoryTimelineReplayService.replayMatch(timelines);
    const sequences = this.canonicalBuildSequenceService.canonicalizeMatch(replay);
    const playersById = new Map(match.players.map((player) => [player.id, player]));

    for (const sequence of sequences.players) {
      if (sequence.replayDiagnosticCount > 0 || sequence.steps.length === 0) {
        continue;
      }

      const player = playersById.get(sequence.playerId);
      if (!player) {
        continue;
      }

      const enemyHeroIds = normalizeHeroIds(
        match.players
          .filter((candidate) => candidate.team !== player.team)
          .map((candidate) => candidate.heroId),
      );
      const heroId = canonicalHeroId(sequence.heroId);
      const statesByKey = index.get(heroId) ?? new Map<string, MutableGraphStateStats>();

      for (const step of sequence.steps) {
        const state = statesByKey.get(step.beforeStateKey) ?? createStateStats();
        incrementSample(state, player.won);
        incrementEnemySamples(state.byEnemyHeroId, enemyHeroIds, player.won);

        const action = state.actionsByKey.get(step.actionKey) ?? createActionStats();
        incrementSample(action, player.won);
        incrementEnemySamples(action.byEnemyHeroId, enemyHeroIds, player.won);

        state.actionsByKey.set(step.actionKey, action);
        statesByKey.set(step.beforeStateKey, state);
      }

      index.set(heroId, statesByKey);
    }
  }
}

export function calculateGraphMatchupInteraction(
  input: GraphMatchupInteractionInput,
): GraphMatchupEvidence | undefined {
  if (
    input.actionAgainst.matches <= 0 ||
    input.otherActionsAgainst.matches <= 0 ||
    input.actionWithoutEnemy.matches <= 0 ||
    input.otherActionsWithoutEnemy.matches <= 0
  ) {
    return undefined;
  }

  const matchup = calculateLogOddsRatio(
    input.actionAgainst,
    input.otherActionsAgainst,
  );
  const withoutEnemy = calculateLogOddsRatio(
    input.actionWithoutEnemy,
    input.otherActionsWithoutEnemy,
  );
  const interactionLogOddsRatio = matchup.value - withoutEnemy.value;
  const standardError = Math.sqrt(matchup.variance + withoutEnemy.variance);
  const lower95InteractionLogOddsRatio =
    interactionLogOddsRatio - GRAPH_MATCHUP_CONFIDENCE_Z * standardError;
  const upper95InteractionLogOddsRatio =
    interactionLogOddsRatio + GRAPH_MATCHUP_CONFIDENCE_Z * standardError;

  return {
    enemyHeroId: input.enemyHeroId,
    matchupObservationCount:
      input.actionAgainst.matches + input.otherActionsAgainst.matches,
    actionMatchupObservationCount: input.actionAgainst.matches,
    otherActionMatchupObservationCount: input.otherActionsAgainst.matches,
    actionWinRateAgainst: winRate(input.actionAgainst),
    otherActionsWinRateAgainst: winRate(input.otherActionsAgainst),
    actionWinRateWithoutEnemy: winRate(input.actionWithoutEnemy),
    otherActionsWinRateWithoutEnemy: winRate(input.otherActionsWithoutEnemy),
    interactionLogOddsRatio,
    interactionOddsRatio: Math.exp(interactionLogOddsRatio),
    standardError,
    lower95InteractionLogOddsRatio,
    upper95InteractionLogOddsRatio,
    lower95InteractionOddsRatio: Math.exp(lower95InteractionLogOddsRatio),
    upper95InteractionOddsRatio: Math.exp(upper95InteractionLogOddsRatio),
  };
}

function calculateLogOddsRatio(
  action: GraphOutcomeSample,
  otherActions: GraphOutcomeSample,
): { value: number; variance: number } {
  const actionWins = action.wins + GRAPH_MATCHUP_CONTINUITY_CORRECTION;
  const actionLosses =
    action.matches - action.wins + GRAPH_MATCHUP_CONTINUITY_CORRECTION;
  const otherWins = otherActions.wins + GRAPH_MATCHUP_CONTINUITY_CORRECTION;
  const otherLosses =
    otherActions.matches - otherActions.wins + GRAPH_MATCHUP_CONTINUITY_CORRECTION;

  return {
    value: Math.log(
      (actionWins * otherLosses) / (actionLosses * otherWins),
    ),
    variance:
      1 / actionWins +
      1 / actionLosses +
      1 / otherWins +
      1 / otherLosses,
  };
}

function createStateStats(): MutableGraphStateStats {
  return {
    matches: 0,
    wins: 0,
    byEnemyHeroId: new Map(),
    actionsByKey: new Map(),
  };
}

function createActionStats(): MutableGraphActionStats {
  return {
    matches: 0,
    wins: 0,
    byEnemyHeroId: new Map(),
  };
}

function incrementSample(sample: MutableOutcomeSample, won: boolean): void {
  sample.matches += 1;
  if (won) {
    sample.wins += 1;
  }
}

function incrementEnemySamples(
  samplesByEnemyHeroId: Map<number, MutableOutcomeSample>,
  enemyHeroIds: readonly number[],
  won: boolean,
): void {
  for (const enemyHeroId of enemyHeroIds) {
    const sample = samplesByEnemyHeroId.get(enemyHeroId) ?? emptySample();
    incrementSample(sample, won);
    samplesByEnemyHeroId.set(enemyHeroId, sample);
  }
}

function subtractSamples(
  total: GraphOutcomeSample,
  subset: GraphOutcomeSample,
): GraphOutcomeSample {
  return {
    matches: Math.max(0, total.matches - subset.matches),
    wins: Math.max(0, total.wins - subset.wins),
  };
}

function emptySample(): MutableOutcomeSample {
  return { matches: 0, wins: 0 };
}

function normalizeHeroIds(heroIds: readonly number[]): number[] {
  return [...new Set(
    heroIds
      .filter((heroId) => Number.isSafeInteger(heroId) && heroId > 0)
      .map(canonicalHeroId),
  )].sort((left, right) => left - right);
}

function winRate(sample: GraphOutcomeSample): number {
  return sample.matches > 0 ? sample.wins / sample.matches : 0;
}

function compareEvidence(
  left: GraphMatchupEvidence,
  right: GraphMatchupEvidence,
): number {
  if (
    left.lower95InteractionLogOddsRatio !==
    right.lower95InteractionLogOddsRatio
  ) {
    return (
      right.lower95InteractionLogOddsRatio -
      left.lower95InteractionLogOddsRatio
    );
  }
  if (left.interactionLogOddsRatio !== right.interactionLogOddsRatio) {
    return right.interactionLogOddsRatio - left.interactionLogOddsRatio;
  }
  return right.matchupObservationCount - left.matchupObservationCount;
}
