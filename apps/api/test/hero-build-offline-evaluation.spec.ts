import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CanonicalBuildSequenceService, CanonicalPlayerBuildSequence } from '../src/deadlock-live/canonical-build-sequence.service';
import { HeroBuildOfflineEvaluationController } from '../src/deadlock-live/hero-build-offline-evaluation.controller';
import {
  expandInventoryStateKey,
  HeroBuildOfflineEvaluationModel,
  HeroBuildOfflineMatchupIndex,
  normalizeObservedActionKey,
} from '../src/deadlock-live/hero-build-offline-evaluation.model';
import {
  getHeroBuildEvaluationPhase,
  HeroBuildOfflineEvaluationReport,
  HeroBuildOfflineEvaluationService,
  splitHeroBuildEvaluationMatches,
} from '../src/deadlock-live/hero-build-offline-evaluation.service';
import { aggregateCanonicalBuildSequences } from '../src/deadlock-live/hero-build-transition-aggregation.service';
import { InventoryTimelineReplayService } from '../src/deadlock-live/inventory-timeline-replay.service';
import { MatchTimelineNormalizationService } from '../src/deadlock-live/match-timeline-normalization.service';
import {
  RecentMatchesWindowService,
  RecentMatchSnapshot,
} from '../src/deadlock-live/recent-matches-window.service';
import { RecipeAwareTimelineReconciliationService } from '../src/deadlock-live/recipe-aware-timeline-reconciliation.service';

describe('hero build offline evaluation', () => {
  it('creates a chronological holdout from the newest bounded window', () => {
    const split = splitHeroBuildEvaluationMatches(
      [
        descriptor(4, '2026-01-04T00:00:00.000Z'),
        descriptor(2, '2026-01-02T00:00:00.000Z'),
        descriptor(1, '2026-01-01T00:00:00.000Z'),
        descriptor(3, '2026-01-03T00:00:00.000Z'),
        descriptor(5, '2026-01-05T00:00:00.000Z'),
      ],
      0.75,
      4,
    );

    expect(split.selected.map((match) => match.matchId)).toEqual([2, 3, 4, 5]);
    expect(split.train.map((match) => match.matchId)).toEqual([2, 3, 4]);
    expect(split.test.map((match) => match.matchId)).toEqual([5]);
    expect(new Set(split.train.map((match) => match.matchId))).not.toContain(5);
  });

  it('normalizes rebuy labels and inventory state keys', () => {
    expect(normalizeObservedActionKey('REBUY', 100)).toBe('BUY:100');
    expect(normalizeObservedActionKey('SELL', 100)).toBe('SELL:100');
    expect(expandInventoryStateKey('100x2|200x1')).toEqual([100, 100, 200]);
    expect(expandInventoryStateKey('invalid')).toBeUndefined();
  });

  it('uses the existing recommendation policy for held-out predictions', () => {
    const sequences = [1, 2, 3].map((playerId) => createSequence(playerId));
    const policy = aggregateCanonicalBuildSequences(sequences);
    const matchupIndex = new HeroBuildOfflineMatchupIndex();
    for (const sequence of sequences) {
      matchupIndex.addSequence(sequence, true, [9]);
    }

    const model = new HeroBuildOfflineEvaluationModel(
      policy.policiesByHeroId,
      matchupIndex,
      () => [],
    );
    const prediction = model.predict({
      heroId: 72,
      stateKey: 'EMPTY',
      gameTimeS: 60,
      enemyHeroIds: [9],
    });

    expect(prediction.baseline.covered).toBe(true);
    expect(prediction.baseline.mode).toBe('EXACT');
    expect(prediction.baseline.topActionKey).toBe('BUY:100');
    expect(prediction.contextual.topActionKey).toBe('BUY:100');
    expect(matchupIndex.getSummary()).toEqual({
      heroCount: 1,
      stateCount: 2,
      actionCount: 2,
      observationCount: 6,
    });
  });

  it('runs a leak-free evaluation and exposes a completed report', async () => {
    const matches = new Map(
      [1, 2, 3, 4].map((matchId) => [matchId, createMatch(matchId)]),
    );
    const sourceLastRefreshedAt = new Date('2026-01-05T00:00:00.000Z');
    const recentMatchesWindowService = {
      getStatus: jest.fn(() => ({ lastRefreshedAt: sourceLastRefreshedAt })),
      refresh: jest.fn(),
      getMatchIds: jest.fn(() => [...matches.keys()]),
      getMatch: jest.fn((matchId: number) => matches.get(matchId)),
    } as unknown as RecentMatchesWindowService;
    const recipeAwareTimelineReconciliationService = {
      refreshRecipes: jest.fn(async () => 0),
      getComponentItemIds: jest.fn(() => []),
    } as unknown as RecipeAwareTimelineReconciliationService;
    const service = new HeroBuildOfflineEvaluationService(
      recentMatchesWindowService,
      new MatchTimelineNormalizationService(),
      new InventoryTimelineReplayService(),
      new CanonicalBuildSequenceService(),
      recipeAwareTimelineReconciliationService,
    );

    const initialStatus = service.start({
      trainFraction: 0.75,
      maxMatches: 4,
      errorExampleLimit: 10,
    });
    expect(initialStatus.state).toBe('RUNNING');

    await waitForEvaluation(service);

    const status = service.getStatus();
    const report = service.getReport();
    expect(status.state).toBe('COMPLETE');
    expect(status.reportAvailable).toBe(true);
    expect(report).toBeDefined();
    expect(report?.split).toMatchObject({
      strategy: 'CHRONOLOGICAL_MATCH_HOLDOUT',
      selectedMatchCount: 4,
      trainMatchCount: 3,
      testMatchCount: 1,
      overlappingMatchCount: 0,
    });
    expect(report?.test).toEqual({
      sourcePlayerCount: 2,
      evaluatedPlayerCount: 1,
      excludedPlayerCount: 1,
      evaluatedStepCount: 2,
    });
    expect(report?.overall.baseline).toMatchObject({
      sampleCount: 2,
      coveredCount: 2,
      coveragePercent: 100,
      top1Count: 2,
      top1AccuracyPercent: 100,
      top3Count: 2,
      top3AccuracyPercent: 100,
    });
    expect(report?.overall.contextual.top1AccuracyPercent).toBe(100);
    expect(report?.byHero).toHaveLength(1);
    expect(report?.byHero[0].heroId).toBe(72);
    expect(report?.byPhase.find((group) => group.phase === 'EARLY')?.comparison.baseline.sampleCount).toBe(2);
    expect(report?.warnings[0]).toContain('historical player decisions');
  });

  it('validates controller input and report lifecycle', () => {
    const service = {
      start: jest.fn((request) => request),
      getStatus: jest.fn(() => ({ state: 'IDLE' })),
      getReport: jest.fn(() => undefined),
    } as unknown as HeroBuildOfflineEvaluationService;
    const controller = new HeroBuildOfflineEvaluationController(service);

    expect(() => controller.start({ trainFraction: 0.49 })).toThrow(BadRequestException);
    expect(() => controller.start({ maxMatches: 1 })).toThrow(BadRequestException);
    expect(controller.start({ trainFraction: 0.8, maxMatches: 100 })).toMatchObject({
      trainFraction: 0.8,
      maxMatches: 100,
    });
    expect(() => controller.getReport()).toThrow(NotFoundException);

    (service.getStatus as jest.Mock).mockReturnValue({ state: 'RUNNING' });
    expect(() => controller.getReport()).toThrow(ConflictException);

    const report = { modelVersion: 'test' } as unknown as HeroBuildOfflineEvaluationReport;
    (service.getStatus as jest.Mock).mockReturnValue({ state: 'COMPLETE' });
    (service.getReport as jest.Mock).mockReturnValue(report);
    expect(controller.getReport()).toBe(report);
  });

  it('assigns stable match phases', () => {
    expect(getHeroBuildEvaluationPhase(0)).toBe('EARLY');
    expect(getHeroBuildEvaluationPhase(599)).toBe('EARLY');
    expect(getHeroBuildEvaluationPhase(600)).toBe('MID');
    expect(getHeroBuildEvaluationPhase(1199)).toBe('MID');
    expect(getHeroBuildEvaluationPhase(1200)).toBe('LATE');
  });
});

function descriptor(matchId: number, startTime: string) {
  return { matchId, startTime: new Date(startTime) };
}

function createSequence(playerId: number): CanonicalPlayerBuildSequence {
  return {
    matchId: playerId,
    playerId,
    heroId: 72,
    sourceActionCount: 2,
    canonicalStepCount: 2,
    ignoredActionCount: 0,
    replayDiagnosticCount: 0,
    initialStateKey: 'EMPTY',
    finalStateKey: '100x1|200x1',
    actionSequenceKey: 'BUY:100>BUY:200',
    sequenceKey: 'EMPTY>BUY:100>100x1||100x1>BUY:200>100x1|200x1',
    steps: [
      {
        sequence: 1,
        sourceSequence: 1,
        gameTimeS: 60,
        actionType: 'BUY',
        itemId: 100,
        actionKey: 'BUY:100',
        beforeStateKey: 'EMPTY',
        afterStateKey: '100x1',
        transitionKey: 'EMPTY>BUY:100>100x1',
      },
      {
        sequence: 2,
        sourceSequence: 2,
        gameTimeS: 180,
        actionType: 'BUY',
        itemId: 200,
        actionKey: 'BUY:200',
        beforeStateKey: '100x1',
        afterStateKey: '100x1|200x1',
        transitionKey: '100x1>BUY:200>100x1|200x1',
      },
    ],
  };
}

function createMatch(matchId: number): RecentMatchSnapshot {
  const playerId = matchId * 10 + 1;
  const enemyPlayerId = matchId * 10 + 2;
  return {
    matchId,
    startTime: new Date(Date.UTC(2026, 0, matchId)),
    durationS: 1_800,
    averageBadge: 10,
    winningTeam: 1,
    players: [
      {
        id: playerId,
        matchId,
        heroId: 72,
        team: 1,
        won: true,
        kills: 5,
        deaths: 2,
        assists: 8,
        netWorth: 20_000,
        itemPurchases: [
          {
            id: playerId * 100 + 1,
            itemId: 100,
            purchaseTimeS: 60,
          },
          {
            id: playerId * 100 + 2,
            itemId: 200,
            purchaseTimeS: 180,
          },
        ],
        skillUpgrades: [],
      },
      {
        id: enemyPlayerId,
        matchId,
        heroId: 9,
        team: 2,
        won: false,
        kills: 2,
        deaths: 5,
        assists: 4,
        netWorth: 15_000,
        itemPurchases: [],
        skillUpgrades: [],
      },
    ],
  };
}

async function waitForEvaluation(service: HeroBuildOfflineEvaluationService): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.getStatus().state !== 'RUNNING') {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Offline evaluation did not complete in time.');
}
