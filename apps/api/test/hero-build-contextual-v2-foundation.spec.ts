import type {
  ContextualHeroBuildRecommendationResponse,
  ContextualHeroBuildRecommendationService,
} from '../src/deadlock-live/contextual-hero-build-recommendation.service';
import {
  adjustPValuesBenjaminiHochberg,
  buildHeroBuildOfflinePairedStatisticalSummary,
  calculateTop1McNemar,
  evaluateHeroBuildOfflineReleaseGates,
  HeroBuildOfflinePairedStepOutcome,
  splitHeroBuildEvaluationMatchesThreeWay,
} from '../src/deadlock-live/hero-build-offline-evaluation-v2';
import type { HeroBuildRecommendationResponse } from '../src/deadlock-live/hero-build-recommendation.service';
import type {
  HeroBuildPolicy,
  HeroBuildTransitionAggregationService,
} from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { ProductionHeroBuildRecommendationService } from '../src/deadlock-live/production-hero-build-recommendation.service';
import type { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('contextual v2 foundation', () => {
  const previousShadowEnabled = process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED;
  const previousShadowSampleRate =
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE;

  afterEach(() => {
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_ENABLED',
      previousShadowEnabled,
    );
    restoreEnvironmentValue(
      'DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE',
      previousShadowSampleRate,
    );
    jest.restoreAllMocks();
  });

  it('returns the baseline recommendation while evaluating contextual ranking in shadow', async () => {
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_ENABLED = 'true';
    process.env.DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE = '1';

    const policy = createPolicy();
    const transitionService = {
      ensureReady: jest.fn(async () => undefined),
      getStatus: jest.fn(() => ({
        lastRefreshedAt: new Date('2026-07-17T00:00:00.000Z'),
      })),
      getHeroPolicy: jest.fn(() => policy),
    } as unknown as HeroBuildTransitionAggregationService;
    const recipeService = {
      getComponentItemIds: jest.fn(() => []),
    } as unknown as RecipeAwareTimelineReconciliationService;
    const contextualResponse = createContextualResponse();
    const contextualService = {
      recommend: jest.fn(async () => contextualResponse),
    } as unknown as ContextualHeroBuildRecommendationService;
    const service = new ProductionHeroBuildRecommendationService(
      transitionService,
      recipeService,
      contextualService,
    );

    const response = await service.recommend({
      heroId: 1,
      itemIds: [],
      gameTimeS: 60,
      enemyHeroIds: [2, 3, 4, 5, 6],
      limit: 5,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(response.action.actionKey).toBe('BUY:100');
    expect(contextualService.recommend).toHaveBeenCalledTimes(1);
    expect(contextualResponse.action.actionKey).toBe('BUY:200');
  });

  it('creates a leak-free chronological train, validation, and test split', () => {
    const split = splitHeroBuildEvaluationMatchesThreeWay(
      Array.from({ length: 10 }, (_, index) => ({
        matchId: index + 1,
        startTime: new Date(Date.UTC(2026, 0, index + 1)),
      })),
      0.7,
      0.15,
      10,
    );

    expect(split.train.map((match) => match.matchId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(split.validation.map((match) => match.matchId)).toEqual([8]);
    expect(split.test.map((match) => match.matchId)).toEqual([9, 10]);
    expect(new Set(split.train.map((match) => match.matchId))).not.toContain(8);
    expect(new Set(split.validation.map((match) => match.matchId))).not.toContain(9);
  });

  it('calculates deterministic match-clustered paired confidence intervals', () => {
    const outcomes = [
      createOutcome(1, false, true),
      createOutcome(1, false, true),
      createOutcome(2, false, false),
      createOutcome(2, false, false),
    ];
    const summary = buildHeroBuildOfflinePairedStatisticalSummary(
      outcomes,
      500,
      1234,
    );

    expect(summary.top1.pointEstimatePercentagePoints).toBe(50);
    expect(summary.top1.clusterCount).toBe(2);
    expect(summary.top1.lower95PercentagePoints).toBeLessThanOrEqual(50);
    expect(summary.top1.upper95PercentagePoints).toBeGreaterThanOrEqual(50);
    expect(summary.top1.seed).toBe(1234);
  });

  it('reports paired top-1 improvements and regressions with McNemar statistics', () => {
    const result = calculateTop1McNemar([
      createOutcome(1, false, true),
      createOutcome(2, false, true),
      createOutcome(3, false, true),
      createOutcome(4, true, false),
      createOutcome(5, true, true),
    ]);

    expect(result).toMatchObject({
      improvedCount: 3,
      worsenedCount: 1,
      discordantCount: 4,
    });
    expect(result.approximateTwoSidedPValue).toBeGreaterThan(0);
    expect(result.approximateTwoSidedPValue).toBeLessThanOrEqual(1);
  });

  it('controls false discoveries with Benjamini-Hochberg adjustment', () => {
    const adjusted = adjustPValuesBenjaminiHochberg([
      { key: 'a', pValue: 0.01 },
      { key: 'b', pValue: 0.02 },
      { key: 'c', pValue: 0.2 },
    ]);

    expect(adjusted).toEqual([
      { key: 'a', pValue: 0.01, adjustedPValue: 0.03 },
      { key: 'b', pValue: 0.02, adjustedPValue: 0.03 },
      { key: 'c', pValue: 0.2, adjustedPValue: 0.2 },
    ]);
  });

  it('enforces conservative release gates', () => {
    expect(
      evaluateHeroBuildOfflineReleaseGates({
        top1DeltaPercentagePoints: 0.2,
        top1Lower95PercentagePoints: 0.05,
        top3DeltaPercentagePoints: 0.1,
        top3Lower95PercentagePoints: 0,
        coverageDeltaPercentagePoints: 0,
        improvedCount: 200,
        worsenedCount: 100,
        worstPhaseTop1DeltaPercentagePoints: -0.1,
        worstLargeHeroTop1DeltaPercentagePoints: -0.3,
      }),
    ).toEqual({ passed: true, violations: [] });

    const failed = evaluateHeroBuildOfflineReleaseGates({
      top1DeltaPercentagePoints: -0.2,
      top1Lower95PercentagePoints: -0.3,
      top3DeltaPercentagePoints: -1,
      top3Lower95PercentagePoints: -1.2,
      coverageDeltaPercentagePoints: -0.1,
      improvedCount: 10,
      worsenedCount: 20,
      worstPhaseTop1DeltaPercentagePoints: -0.5,
      worstLargeHeroTop1DeltaPercentagePoints: -1,
    });
    expect(failed.passed).toBe(false);
    expect(failed.violations.length).toBeGreaterThanOrEqual(6);
  });
});

function createPolicy(): HeroBuildPolicy {
  return {
    heroId: 1,
    playerCount: 10,
    stateCount: 1,
    transitionCount: 10,
    statesByKey: new Map([
      [
        'EMPTY',
        {
          heroId: 1,
          stateKey: 'EMPTY',
          observationCount: 10,
          nextActionCount: 1,
          nextActions: [
            {
              actionType: 'BUY',
              itemId: 100,
              actionKey: 'BUY:100',
              count: 10,
              probability: 1,
              averageGameTimeS: 60,
              afterStates: [
                {
                  afterStateKey: '100x1',
                  count: 10,
                  probability: 1,
                },
              ],
            },
          ],
        },
      ],
    ]),
  };
}

function createContextualResponse(): ContextualHeroBuildRecommendationResponse {
  const action = {
    type: 'BUY',
    sourceActionType: 'BUY',
    itemId: 200,
    actionKey: 'BUY:200',
    historicalCount: 5,
    historicalProbability: 0.5,
    averageGameTimeS: 60,
    matchedStateKey: 'EMPTY',
    matchedStateObservationCount: 10,
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    predictedStateKey: '200x1',
    score: 0.7,
    confidence: 0.7,
    baseScore: 0.5,
    contextualScore: 0.7,
    baseRank: 2,
    contextualRank: 1,
    wasInBaseBuild: true,
    isSituational: true,
    wasPromotedByMatchup: true,
    wasInsertedByMatchup: false,
    situationalAgainstHeroId: 2,
    situationalInteractionOddsRatio: 2,
    situationalLower95OddsRatio: 1.2,
    matchupObservationCount: 100,
    matchupModelVersion: 'GRAPH_EDGE_INTERACTION_ODDS_RATIO_V1',
    matchupEvidence: [],
  } as ContextualHeroBuildRecommendationResponse['action'];

  return {
    mode: 'EXACT',
    heroId: 1,
    requestedStateKey: 'EMPTY',
    gameTimeS: 60,
    matchedStateKey: 'EMPTY',
    stateDistance: 0,
    missingItemCount: 0,
    extraItemCount: 0,
    matchedBySubset: true,
    observationCount: 10,
    candidateStateCount: 1,
    enemyHeroIds: [2, 3, 4, 5, 6],
    matchupModelVersion: 'GRAPH_EDGE_INTERACTION_ODDS_RATIO_V1',
    evaluatedCandidateCount: 2,
    situationalCandidateCount: 1,
    promotedSituationalCandidateCount: 1,
    insertedSituationalCandidateCount: 0,
    action,
    alternatives: [],
  };
}

function createOutcome(
  matchId: number,
  baselineTop1Correct: boolean,
  contextualTop1Correct: boolean,
): HeroBuildOfflinePairedStepOutcome {
  return {
    matchId,
    playerId: matchId * 10,
    heroId: 1,
    phase: 'EARLY',
    baselineMode: 'EXACT',
    contextualMode: 'EXACT',
    baselineCovered: true,
    contextualCovered: true,
    baselineTop1Correct,
    contextualTop1Correct,
    baselineTop3Correct: baselineTop1Correct,
    contextualTop3Correct: contextualTop1Correct,
    changedTop1: baselineTop1Correct !== contextualTop1Correct,
    contextualPromoted: contextualTop1Correct && !baselineTop1Correct,
    contextualInserted: false,
  };
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
