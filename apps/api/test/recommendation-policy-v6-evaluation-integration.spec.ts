import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION } from '../src/deadlock-live/recommendation-behavioral-v4-training.service';
import { RECOMMENDATION_DECISION_DATASET_V5_VERSION } from '../src/deadlock-live/recommendation-decision-dataset-v5.service';
import { RecommendationPolicyV6EvaluationService } from '../src/deadlock-live/recommendation-policy-v6-evaluation.service';
import { RECOMMENDATION_VALUE_V6_MODEL_VERSION } from '../src/deadlock-live/recommendation-value-v6-model';

describe('Recommendation Policy V6 evaluation service', () => {
  let rootDirectory = '';
  let behavioralDirectory = '';
  let valueDirectory = '';
  let outputDirectory = '';
  const previousEnvironment = {
    behavioral: process.env.DEADLOCK_RECOMMENDATION_POLICY_V6_BEHAVIORAL_DIR,
    value: process.env.DEADLOCK_RECOMMENDATION_POLICY_V6_VALUE_DIR,
    output: process.env.DEADLOCK_RECOMMENDATION_POLICY_V6_OUTPUT_DIR,
  };

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'recommendation-policy-v6-'));
    behavioralDirectory = join(rootDirectory, 'behavioral');
    valueDirectory = join(rootDirectory, 'value');
    outputDirectory = join(rootDirectory, 'output');
    await Promise.all([
      mkdir(behavioralDirectory, { recursive: true }),
      mkdir(valueDirectory, { recursive: true }),
      mkdir(outputDirectory, { recursive: true }),
    ]);
    process.env.DEADLOCK_RECOMMENDATION_POLICY_V6_BEHAVIORAL_DIR =
      behavioralDirectory;
    process.env.DEADLOCK_RECOMMENDATION_POLICY_V6_VALUE_DIR = valueDirectory;
    process.env.DEADLOCK_RECOMMENDATION_POLICY_V6_OUTPUT_DIR = outputDirectory;
  });

  afterEach(async () => {
    restoreEnvironment(
      'DEADLOCK_RECOMMENDATION_POLICY_V6_BEHAVIORAL_DIR',
      previousEnvironment.behavioral,
    );
    restoreEnvironment(
      'DEADLOCK_RECOMMENDATION_POLICY_V6_VALUE_DIR',
      previousEnvironment.value,
    );
    restoreEnvironment(
      'DEADLOCK_RECOMMENDATION_POLICY_V6_OUTPUT_DIR',
      previousEnvironment.output,
    );
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it('joins held-out artifacts and persists match-balanced OPE results', async () => {
    const behavioralRows = [
      behavioralRow('decision-1', 'match-1', 'BUY:A'),
      behavioralRow('decision-2', 'match-2', 'BUY:B'),
    ];
    const behavioralModel = {
      modelVersion: RECOMMENDATION_BEHAVIORAL_V4_MODEL_VERSION,
      options: {
        smoothing: 1,
        minContextObservations: 1,
      },
      weights: {
        inventoryDelta: 0.55,
        previousActionTailDelta: 0.35,
        alliedRosterDeltaAverage: 0.08,
        enemyRosterDeltaAverage: 0.12,
      },
      counts: {
        hero: {
          '15': { 'BUY:A': 10, 'BUY:B': 5 },
        },
        heroTime: {
          '15|1': { 'BUY:A': 10, 'BUY:B': 5 },
        },
        heroTimeInventory: {
          '15|1|INV': { 'BUY:A': 8, 'BUY:B': 4 },
        },
        heroTimePreviousTail: {
          '15|1|EMPTY': { 'BUY:A': 7, 'BUY:B': 3 },
        },
        ally: {},
        enemy: {},
      },
    };
    const valueRows = [
      valueRow('decision-1', 'match-1', 'BUY:A', 0.6),
      valueRow('decision-2', 'match-2', 'BUY:B', -0.2),
    ];
    const valueModel = {
      modelVersion: RECOMMENDATION_VALUE_V6_MODEL_VERSION,
    };

    const behavioralValidationPath = join(
      behavioralDirectory,
      'validation.ndjson',
    );
    const behavioralModelPath = join(behavioralDirectory, 'model.json');
    const valuePredictionPath = join(valueDirectory, 'prediction-evaluation.ndjson');
    const valueModelPath = join(valueDirectory, 'model.json');
    await Promise.all([
      writeNdjson(behavioralValidationPath, behavioralRows),
      writeJson(behavioralModelPath, behavioralModel),
      writeNdjson(valuePredictionPath, valueRows),
      writeJson(valueModelPath, valueModel),
    ]);

    const [behavioralValidationSha, behavioralModelSha, valuePredictionSha, valueModelSha] =
      await Promise.all([
        hashFile(behavioralValidationPath),
        hashFile(behavioralModelPath),
        hashFile(valuePredictionPath),
        hashFile(valueModelPath),
      ]);

    await Promise.all([
      writeJson(join(behavioralDirectory, 'audit.json'), { passed: true }),
      writeJson(join(behavioralDirectory, 'manifest.json'), {
        auditPassed: true,
        releaseGatePassed: true,
        artifacts: {
          validation: { sha256: behavioralValidationSha },
          model: { sha256: behavioralModelSha },
        },
      }),
      writeJson(join(valueDirectory, 'audit.json'), { passed: true }),
      writeJson(join(valueDirectory, 'manifest.json'), {
        releaseGatePassed: true,
        source: {
          datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        },
        artifacts: {
          predictionEvaluation: { sha256: valuePredictionSha },
          model: { sha256: valueModelSha },
        },
      }),
    ]);

    const service = new RecommendationPolicyV6EvaluationService();
    await service.onModuleInit();
    await service.start({
      bootstrapReplicates: 50,
      bootstrapSeed: 42,
      minBehaviorProbability: 0.0001,
      maxImportanceWeight: 5,
    });
    await service.waitForIdle();

    expect(service.getStatus()).toMatchObject({
      state: 'COMPLETE',
      phase: 'COMPLETE',
      joinedDecisionCount: 2,
      candidateCoveredDecisionCount: 2,
      supportedDecisionCount: 2,
      evaluatedDecisionCount: 2,
      evaluatedMatchCount: 2,
    });
    expect(service.getAudit()).toMatchObject({
      passed: true,
      leakage: {
        matchLevelBootstrap: true,
        matchBalancedEvaluationWeights: true,
        causalInterpretationAllowed: false,
        productionRolloutAuthorized: false,
      },
    });
    expect(service.getEvaluation()).toMatchObject({
      causalInterpretationAllowed: false,
      rolloutAuthorization: 'FORBIDDEN',
      coverage: {
        evaluatedDecisionCount: 2,
        evaluatedMatchCount: 2,
        evaluationWeightSum: 2,
      },
      bootstrap: {
        replicateCount: 50,
        seed: 42,
      },
    });

    const decisionLines = (await readFile(
      join(outputDirectory, 'decision-evaluation.ndjson'),
      'utf8',
    ))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(decisionLines).toHaveLength(2);
    expect(decisionLines.every((line) => line.eligible === true)).toBe(true);
  });
});

function behavioralRow(
  decisionId: string,
  matchId: string,
  actionKey: string,
): Record<string, unknown> {
  return {
    decisionId,
    matchId,
    decisionOccurredAt: '2026-01-01T00:00:00.000Z',
    features: {
      heroId: 15,
      teamId: 2,
      timeBucket: 1,
      inventoryStateKey: 'INV',
      previousActionTailKey: 'EMPTY',
      alliedHeroIds: [16],
      enemyHeroIds: [20],
      candidateActionKeys: ['BUY:A', 'BUY:B'],
    },
    target: { actionKey },
  };
}

function valueRow(
  decisionId: string,
  matchId: string,
  observedActionKey: string,
  targetUtility: number,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modelVersion: RECOMMENDATION_VALUE_V6_MODEL_VERSION,
    decisionId,
    matchId,
    playerWon: targetUtility > 0,
    targetUtility,
    matchWeight: 1,
    observedActionKey,
    observedActionUtility: observedActionKey === 'BUY:A' ? 0.35 : 0.15,
    candidateRanking: [
      {
        rank: 1,
        actionKey: 'BUY:A',
        actionUtility: 0.35,
        actionAdvantage: 0.2,
        actionWinProbability: 0.55,
        supportedActionKeyCount: 3,
      },
      {
        rank: 2,
        actionKey: 'BUY:B',
        actionUtility: 0.15,
        actionAdvantage: -0.05,
        actionWinProbability: 0.48,
        supportedActionKeyCount: 2,
      },
    ],
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

async function writeNdjson(path: string, values: unknown[]): Promise<void> {
  await writeFile(
    path,
    `${values.map((value) => JSON.stringify(value)).join('\n')}\n`,
    'utf8',
  );
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
