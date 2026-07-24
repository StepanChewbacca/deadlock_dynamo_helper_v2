import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRecommendationDecisionDatasetV4,
  RecommendationDecisionDatasetV4Service,
} from '../src/deadlock-live/recommendation-decision-dataset-v4.service';
import type {
  RecommendationActionObservedEvent,
  RecommendationDecisionServedEvent,
  RecommendationDecisionSupersededEvent,
  RecommendationDecisionTelemetryEvent,
  RecommendationDecisionTelemetryService,
  RecommendationMatchOutcomeEvent,
} from '../src/deadlock-live/recommendation-decision-telemetry.service';

describe('recommendation decision dataset V4', () => {
  it('materializes an exact action and outcome eligible row', () => {
    const events: RecommendationDecisionTelemetryEvent[] = [
      createDecisionEvent('decision-1'),
      createObservedEvent('decision-1', ['BUY:200'], 'EXACT_SINGLE_ACTION'),
      createOutcomeEvent(true),
    ];

    const result = buildRecommendationDecisionDatasetV4(events, {
      generatedAt: '2026-07-24T00:00:00.000Z',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      decisionId: 'decision-1',
      observedLabel: {
        observedActionKeys: ['BUY:200'],
        exactActionKey: 'BUY:200',
        reconstructionConfidence: 'EXACT_SINGLE_ACTION',
      },
      outcomeLabel: {
        available: true,
        conflicting: false,
        playerWon: true,
      },
      trainingEligibility: {
        exactAction: true,
        outcome: true,
        actionExclusionReasons: [],
        outcomeExclusionReasons: [],
      },
    });
    expect(result.audit).toMatchObject({
      passed: true,
      rows: {
        rowCount: 1,
        exactActionEligibleCount: 1,
        outcomeEligibleCount: 1,
      },
    });
  });

  it('keeps ambiguous and superseded intervals but excludes them from training', () => {
    const events: RecommendationDecisionTelemetryEvent[] = [
      createDecisionEvent('decision-2'),
      createObservedEvent(
        'decision-2',
        ['UPGRADE:300', 'BUY:400'],
        'AMBIGUOUS_MULTI_ACTION',
      ),
      createSupersededEvent('decision-2'),
    ];

    const result = buildRecommendationDecisionDatasetV4(events);
    const row = result.rows[0];

    expect(row.trainingEligibility.exactAction).toBe(false);
    expect(row.trainingEligibility.outcome).toBe(false);
    expect(row.trainingEligibility.actionExclusionReasons).toEqual([
      'SUPERSEDED_DECISION',
      'AMBIGUOUS_ACTION_INTERVAL',
    ]);
    expect(row.trainingEligibility.outcomeExclusionReasons).toEqual([
      'SUPERSEDED_DECISION',
      'AMBIGUOUS_ACTION_INTERVAL',
      'MISSING_MATCH_OUTCOME',
    ]);
    expect(result.audit.rows.ambiguousActionIntervalCount).toBe(1);
    expect(result.audit.rows.supersededDecisionCount).toBe(1);
  });

  it('excludes duplicate observations and conflicting outcomes', () => {
    const events: RecommendationDecisionTelemetryEvent[] = [
      createDecisionEvent('decision-3'),
      createObservedEvent('decision-3', ['BUY:200'], 'EXACT_SINGLE_ACTION'),
      {
        ...createObservedEvent(
          'decision-3',
          ['BUY:200'],
          'EXACT_SINGLE_ACTION',
        ),
        eventId: 'observed-event-2',
        occurredAt: '2026-07-24T00:00:03.000Z',
      },
      createOutcomeEvent(true),
      {
        ...createOutcomeEvent(false),
        eventId: 'outcome-event-2',
        occurredAt: '2026-07-24T00:00:04.000Z',
      },
    ];

    const result = buildRecommendationDecisionDatasetV4(events);
    const row = result.rows[0];

    expect(row.lifecycle.observedEventCount).toBe(2);
    expect(row.outcomeLabel).toEqual({
      available: false,
      conflicting: true,
      playerWon: undefined,
      source: undefined,
    });
    expect(row.trainingEligibility.actionExclusionReasons).toContain(
      'DUPLICATE_OBSERVED_ACTION',
    );
    expect(row.trainingEligibility.outcomeExclusionReasons).toContain(
      'CONFLICTING_MATCH_OUTCOME',
    );
    expect(result.audit.integrity.conflictingOutcomeKeyCount).toBe(1);
  });

  it('audits orphan lifecycle events without creating fake rows', () => {
    const result = buildRecommendationDecisionDatasetV4([
      createObservedEvent('missing-decision', ['BUY:200'], 'EXACT_SINGLE_ACTION'),
      createSupersededEvent('missing-decision'),
    ]);

    expect(result.rows).toHaveLength(0);
    expect(result.audit.integrity).toMatchObject({
      orphanObservedActionCount: 1,
      orphanSupersededDecisionCount: 1,
    });
    expect(result.audit.passed).toBe(false);
  });

  describe('persistent service', () => {
    let rootDirectory = '';
    let telemetryDirectory = '';
    let datasetDirectory = '';

    beforeEach(async () => {
      rootDirectory = await mkdtemp(
        join(tmpdir(), 'deadlock-recommendation-dataset-v4-'),
      );
      telemetryDirectory = join(rootDirectory, 'telemetry');
      datasetDirectory = join(rootDirectory, 'dataset');
      process.env.DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR =
        datasetDirectory;
    });

    afterEach(async () => {
      delete process.env.DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR;
      await rm(rootDirectory, { recursive: true, force: true });
    });

    it('writes deterministic artifacts and reloads completed status', async () => {
      await writeFile(
        join(rootDirectory, 'placeholder'),
        '',
        'utf8',
      );
      await import('node:fs/promises').then(({ mkdir }) =>
        mkdir(telemetryDirectory, { recursive: true }),
      );
      const eventLogPath = join(telemetryDirectory, 'events.ndjson');
      const events: RecommendationDecisionTelemetryEvent[] = [
        createDecisionEvent('decision-persisted'),
        createObservedEvent(
          'decision-persisted',
          ['BUY:200'],
          'EXACT_SINGLE_ACTION',
        ),
        createOutcomeEvent(false),
      ];
      await writeFile(
        eventLogPath,
        `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
        'utf8',
      );
      const telemetryService = createTelemetryStub(eventLogPath);
      const service = new RecommendationDecisionDatasetV4Service(
        telemetryService,
      );
      await service.onModuleInit();

      expect(service.start().state).toBe('RUNNING');
      await service.waitForIdle();

      expect(service.getStatus()).toMatchObject({
        state: 'COMPLETE',
        rowCount: 1,
        exactActionEligibleCount: 1,
        outcomeEligibleCount: 1,
        datasetAvailable: true,
        manifestAvailable: true,
        auditAvailable: true,
      });
      const dataset = await readFile(
        join(datasetDirectory, 'dataset.ndjson'),
        'utf8',
      );
      expect(JSON.parse(dataset.trim())).toMatchObject({
        decisionId: 'decision-persisted',
        trainingEligibility: {
          exactAction: true,
          outcome: true,
        },
      });
      const manifest = JSON.parse(
        await readFile(join(datasetDirectory, 'manifest.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(manifest).toMatchObject({
        datasetVersion: 'RECOMMENDATION_DECISION_DATASET_V4_1',
        artifact: {
          rowCount: 1,
          format: 'NDJSON',
        },
      });

      const reloaded = new RecommendationDecisionDatasetV4Service(
        telemetryService,
      );
      await reloaded.onModuleInit();
      expect(reloaded.getStatus()).toMatchObject({
        state: 'COMPLETE',
        rowCount: 1,
        exactActionEligibleCount: 1,
        outcomeEligibleCount: 1,
      });
    });
  });
});

function createDecisionEvent(
  decisionId: string,
): RecommendationDecisionServedEvent {
  return {
    schemaVersion: 1,
    eventId: `decision-event-${decisionId}`,
    eventType: 'DECISION_SERVED',
    occurredAt: '2026-07-24T00:00:00.000Z',
    decisionId,
    matchId: 'match-1',
    steamId: 'steam-1',
    heroId: 72,
    teamId: 1,
    itemIds: [100],
    alliedHeroIds: [2, 3, 4, 5, 6],
    enemyHeroIds: [13, 14, 15, 16, 17],
    previousActionKeys: ['BUY:100'],
    inventoryStateKey: '100x1',
    gameTimeS: 120,
    timeBucket: 1,
    traversalKey: `match-1:steam-1:72:${decisionId}`,
    recommendationModel: 'CONTEXTUAL_V3',
    modelVersion: 'MODEL-1',
    modelSha256: 'model-sha',
    candidateSetPolicy: 'POLICY-1',
    candidateLimit: 128,
    buildArchetypeId: 'ARCHETYPE-1',
    servedActionKey: 'BUY:200',
    candidateActions: [
      {
        actionKey: 'BUY:200',
        actionType: 'BUY',
        sourceActionType: 'BUY',
        itemId: 200,
        score: 0.8,
        confidence: 0.7,
        historicalCount: 50,
        historicalProbability: 0.5,
        predictedStateKey: '100x1|200x1',
        matchupSignals: [],
      },
    ],
    elapsedMs: 14,
  };
}

function createObservedEvent(
  decisionId: string,
  observedActionKeys: string[],
  reconstructionConfidence: RecommendationActionObservedEvent['reconstructionConfidence'],
): RecommendationActionObservedEvent {
  return {
    schemaVersion: 1,
    eventId: `observed-event-${decisionId}`,
    eventType: 'ACTION_OBSERVED',
    occurredAt: '2026-07-24T00:00:02.000Z',
    decisionId,
    matchId: 'match-1',
    steamId: 'steam-1',
    heroId: 72,
    teamId: 1,
    observedActionKeys,
    observedInventoryStateKey: '100x1|200x1',
    observedAtGameTimeS: 125,
    reconstructionConfidence,
  };
}

function createSupersededEvent(
  decisionId: string,
): RecommendationDecisionSupersededEvent {
  return {
    schemaVersion: 1,
    eventId: `superseded-event-${decisionId}`,
    eventType: 'DECISION_SUPERSEDED',
    occurredAt: '2026-07-24T00:00:01.000Z',
    decisionId,
    matchId: 'match-1',
    steamId: 'steam-1',
    traversalKey: `match-1:steam-1:72:${decisionId}`,
    reason: 'NEW_DECISION_SERVED',
  };
}

function createOutcomeEvent(playerWon: boolean): RecommendationMatchOutcomeEvent {
  return {
    schemaVersion: 1,
    eventId: 'outcome-event-1',
    eventType: 'MATCH_OUTCOME',
    occurredAt: '2026-07-24T00:00:05.000Z',
    matchId: 'match-1',
    steamId: 'steam-1',
    heroId: 72,
    teamId: 1,
    playerWon,
    source: 'MANUAL',
  };
}

function createTelemetryStub(
  eventLogPath: string,
): RecommendationDecisionTelemetryService {
  return {
    getStatus: () => ({ eventLogPath }),
    waitForIdle: async () => undefined,
  } as unknown as RecommendationDecisionTelemetryService;
}
