import type { CanonicalPlayerBuildSequence } from '../src/deadlock-live/canonical-build-sequence.service';
import {
  createHeroBuildDecisionRows,
  HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
} from '../src/deadlock-live/hero-build-decision-dataset-v3.service';
import type { HeroBuildOfflineLoadedHeroSample } from '../src/deadlock-live/hero-build-offline-evaluation-data-loader.service';

const sample: HeroBuildOfflineLoadedHeroSample = {
  descriptor: {
    matchId: 1001,
    startTime: new Date('2026-07-20T12:00:00.000Z'),
  },
  player: {
    id: 77,
    matchId: 1001,
    heroId: 66,
    team: 0,
    won: true,
    kills: 20,
    deaths: 1,
    assists: 12,
    netWorth: 99_999,
    itemPurchases: [],
    skillUpgrades: [],
  },
  sequence: createSequence(),
  enemyHeroIds: [7, 8, 9, 10, 11, 12],
};

describe('Contextual V3 decision dataset rows', () => {
  it('emits leak-safe next-item decisions and keeps excluded sells in history', () => {
    const result = createHeroBuildDecisionRows(
      sample,
      [2, 3, 4, 5, 6],
      false,
    );

    expect(result.excludedSellActionCount).toBe(1);
    expect(result.nonMonotonicGameTimeCount).toBe(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      schemaVersion: HERO_BUILD_DECISION_DATASET_V3_SCHEMA_VERSION,
      decisionId: '1001:77:1',
      heroId: 66,
      actualActionKey: 'BUY:100',
      buildPrefixKey: 'EMPTY',
      alliedHeroIds: [2, 3, 4, 5, 6],
      enemyHeroIds: [7, 8, 9, 10, 11, 12],
      outcomeLabel: { playerWon: true },
    });
    expect(result.rows[1].previousActionKeys).toEqual([
      'BUY:100',
      'SELL:100',
    ]);
    expect(result.rows[1].buildPrefixKey).toBe('BUY:100>SELL:100');

    const serialized = JSON.stringify(result.rows);
    expect(serialized).not.toContain('netWorth');
    expect(serialized).not.toContain('kills');
    expect(serialized).not.toContain('deaths');
    expect(serialized).not.toContain('assists');
  });

  it('can include sell actions for diagnostic exports', () => {
    const result = createHeroBuildDecisionRows(
      sample,
      [2, 3, 4, 5, 6],
      true,
    );

    expect(result.excludedSellActionCount).toBe(0);
    expect(result.rows.map((row) => row.actualActionKey)).toEqual([
      'BUY:100',
      'SELL:100',
      'BUY:200',
    ]);
  });
});

function createSequence(): CanonicalPlayerBuildSequence {
  return {
    matchId: 1001,
    playerId: 77,
    heroId: 66,
    sourceActionCount: 3,
    canonicalStepCount: 3,
    ignoredActionCount: 0,
    replayDiagnosticCount: 0,
    initialStateKey: 'EMPTY',
    finalStateKey: '200x1',
    actionSequenceKey: 'BUY:100>SELL:100>BUY:200',
    sequenceKey:
      'EMPTY>BUY:100>100x1||100x1>SELL:100>EMPTY||EMPTY>BUY:200>200x1',
    steps: [
      {
        sequence: 1,
        sourceSequence: 1,
        gameTimeS: 300,
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
        gameTimeS: 600,
        actionType: 'SELL',
        itemId: 100,
        actionKey: 'SELL:100',
        beforeStateKey: '100x1',
        afterStateKey: 'EMPTY',
        transitionKey: '100x1>SELL:100>EMPTY',
      },
      {
        sequence: 3,
        sourceSequence: 3,
        gameTimeS: 900,
        actionType: 'BUY',
        itemId: 200,
        actionKey: 'BUY:200',
        beforeStateKey: 'EMPTY',
        afterStateKey: '200x1',
        transitionKey: 'EMPTY>BUY:200>200x1',
      },
    ],
  };
}
