export const RECOMMENDATION_VALUE_V5_MODEL_VERSION =
  'RECOMMENDATION_VALUE_V5_MATCH_BALANCED_STATE_ACTION_RESIDUAL_1' as const;

const EPSILON = 1e-9;

export interface RecommendationValueV5SourceRow {
  decisionId: string;
  matchId: string;
  playerWon: boolean;
  stateKeys: string[];
  actionKeys: string[];
}

export interface RecommendationValueV5WeightedRow
  extends RecommendationValueV5SourceRow {
  matchWeight: number;
}

export interface RecommendationValueV5ModelOptions {
  statePriorStrength: number;
  actionPriorStrength: number;
  minimumEffectiveObservations: number;
  maximumAbsoluteStateLogitResidual: number;
  maximumAbsoluteActionLogitResidual: number;
}

export interface RecommendationValueV5WeightedBinaryCount {
  wins: number;
  total: number;
}

export interface RecommendationValueV5Model {
  version: typeof RECOMMENDATION_VALUE_V5_MODEL_VERSION;
  global: RecommendationValueV5WeightedBinaryCount;
  state: Map<string, RecommendationValueV5WeightedBinaryCount>;
  action: Map<string, RecommendationValueV5WeightedBinaryCount>;
}

export interface RecommendationValueV5Prediction {
  stateProbability: number;
  actionProbability: number;
  stateLogitResidual: number;
  actionLogitResidual: number;
  supportedStateKeyCount: number;
  supportedActionKeyCount: number;
}

export interface RecommendationValueV5ScaleSelection {
  actionResidualScale: number;
  tuningLogLoss: number;
  candidates: Array<{
    actionResidualScale: number;
    tuningLogLoss: number;
  }>;
}

export interface RecommendationValueV5Metrics {
  matchCount: number;
  decisionCount: number;
  totalWeight: number;
  logLoss: number;
  brierScore: number;
  accuracy: number;
  averagePrediction: number;
  observedWinRate: number;
}

export function buildRecommendationValueV5MatchBalancedRows(
  rows: readonly RecommendationValueV5SourceRow[],
): RecommendationValueV5WeightedRow[] {
  const decisionCountsByMatch = new Map<string, number>();
  const decisionIds = new Set<string>();
  for (const row of rows) {
    validateSourceRow(row);
    if (decisionIds.has(row.decisionId)) {
      throw new Error(`Duplicate Value V5 decision ID: ${row.decisionId}.`);
    }
    decisionIds.add(row.decisionId);
    decisionCountsByMatch.set(
      row.matchId,
      (decisionCountsByMatch.get(row.matchId) ?? 0) + 1,
    );
  }
  return rows.map((row) => {
    const decisionCount = decisionCountsByMatch.get(row.matchId) ?? 0;
    if (decisionCount <= 0) {
      throw new Error(`Value V5 match ${row.matchId} has no eligible decisions.`);
    }
    return {
      ...row,
      stateKeys: uniqueKeys(row.stateKeys),
      actionKeys: uniqueKeys(row.actionKeys),
      matchWeight: 1 / decisionCount,
    };
  });
}

export function trainRecommendationValueV5Model(
  rows: readonly RecommendationValueV5WeightedRow[],
): RecommendationValueV5Model {
  if (rows.length === 0) {
    throw new Error('Value V5 training requires at least one weighted row.');
  }
  const model: RecommendationValueV5Model = {
    version: RECOMMENDATION_VALUE_V5_MODEL_VERSION,
    global: { wins: 0, total: 0 },
    state: new Map(),
    action: new Map(),
  };
  for (const row of rows) {
    validateWeightedRow(row);
    incrementCount(model.global, row.playerWon, row.matchWeight);
    for (const key of uniqueKeys(row.stateKeys)) {
      incrementTable(model.state, key, row.playerWon, row.matchWeight);
    }
    for (const key of uniqueKeys(row.actionKeys)) {
      incrementTable(model.action, key, row.playerWon, row.matchWeight);
    }
  }
  return model;
}

export function predictRecommendationValueV5(
  model: RecommendationValueV5Model,
  row: Pick<RecommendationValueV5SourceRow, 'stateKeys' | 'actionKeys'>,
  options: RecommendationValueV5ModelOptions,
  actionResidualScale: number,
): RecommendationValueV5Prediction {
  validateOptions(options);
  if (!Number.isFinite(actionResidualScale) || actionResidualScale < 0) {
    throw new Error('actionResidualScale must be a finite non-negative number.');
  }
  if (model.global.total <= 0) {
    throw new Error('Value V5 model contains no effective training observations.');
  }

  const globalProbability = posteriorProbability(
    model.global,
    0.5,
    options.statePriorStrength,
  );
  const globalLogit = probabilityLogit(globalProbability);
  const stateDeltas = supportedDeltas(
    model.state,
    row.stateKeys,
    globalProbability,
    options.statePriorStrength,
    options.minimumEffectiveObservations,
  );
  const stateLogitResidual = clamp(
    robustAverage(stateDeltas),
    -options.maximumAbsoluteStateLogitResidual,
    options.maximumAbsoluteStateLogitResidual,
  );
  const stateProbability = probabilityFromLogit(
    globalLogit + stateLogitResidual,
  );
  const stateLogit = probabilityLogit(stateProbability);
  const actionDeltas = supportedDeltas(
    model.action,
    row.actionKeys,
    stateProbability,
    options.actionPriorStrength,
    options.minimumEffectiveObservations,
  );
  const actionLogitResidual = clamp(
    actionResidualScale * robustAverage(actionDeltas),
    -options.maximumAbsoluteActionLogitResidual,
    options.maximumAbsoluteActionLogitResidual,
  );

  return {
    stateProbability,
    actionProbability: probabilityFromLogit(stateLogit + actionLogitResidual),
    stateLogitResidual,
    actionLogitResidual,
    supportedStateKeyCount: stateDeltas.length,
    supportedActionKeyCount: actionDeltas.length,
  };
}

export function tuneRecommendationValueV5ActionResidualScale(
  model: RecommendationValueV5Model,
  tuningRows: readonly RecommendationValueV5WeightedRow[],
  options: RecommendationValueV5ModelOptions,
  candidateScales: readonly number[],
): RecommendationValueV5ScaleSelection {
  if (tuningRows.length === 0) {
    throw new Error('Value V5 tuning requires at least one row.');
  }
  const scales = [...new Set(candidateScales)].sort((left, right) => left - right);
  if (
    scales.length === 0 ||
    scales.some((scale) => !Number.isFinite(scale) || scale < 0)
  ) {
    throw new Error('Value V5 action residual scales must be finite non-negative numbers.');
  }
  const candidates = scales.map((actionResidualScale) => ({
    actionResidualScale,
    tuningLogLoss: evaluateRecommendationValueV5(
      model,
      tuningRows,
      options,
      actionResidualScale,
    ).logLoss,
  }));
  candidates.sort(
    (left, right) =>
      left.tuningLogLoss - right.tuningLogLoss ||
      left.actionResidualScale - right.actionResidualScale,
  );
  return {
    actionResidualScale: candidates[0].actionResidualScale,
    tuningLogLoss: candidates[0].tuningLogLoss,
    candidates,
  };
}

export function evaluateRecommendationValueV5(
  model: RecommendationValueV5Model,
  rows: readonly RecommendationValueV5WeightedRow[],
  options: RecommendationValueV5ModelOptions,
  actionResidualScale: number,
): RecommendationValueV5Metrics {
  if (rows.length === 0) {
    throw new Error('Value V5 evaluation requires at least one row.');
  }
  const matches = new Set<string>();
  let totalWeight = 0;
  let logLoss = 0;
  let brierScore = 0;
  let correctWeight = 0;
  let predictionSum = 0;
  let outcomeSum = 0;
  for (const row of rows) {
    validateWeightedRow(row);
    matches.add(row.matchId);
    const prediction = predictRecommendationValueV5(
      model,
      row,
      options,
      actionResidualScale,
    ).actionProbability;
    const outcome = row.playerWon ? 1 : 0;
    totalWeight += row.matchWeight;
    logLoss +=
      row.matchWeight *
      -(outcome * Math.log(prediction) + (1 - outcome) * Math.log(1 - prediction));
    brierScore += row.matchWeight * (prediction - outcome) ** 2;
    correctWeight +=
      row.matchWeight * (Number(prediction >= 0.5) === outcome ? 1 : 0);
    predictionSum += row.matchWeight * prediction;
    outcomeSum += row.matchWeight * outcome;
  }
  if (totalWeight <= 0) {
    throw new Error('Value V5 evaluation has no positive observation weight.');
  }
  return {
    matchCount: matches.size,
    decisionCount: rows.length,
    totalWeight,
    logLoss: logLoss / totalWeight,
    brierScore: brierScore / totalWeight,
    accuracy: correctWeight / totalWeight,
    averagePrediction: predictionSum / totalWeight,
    observedWinRate: outcomeSum / totalWeight,
  };
}

export function sumRecommendationValueV5WeightsByMatch(
  rows: readonly RecommendationValueV5WeightedRow[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(row.matchId, (result.get(row.matchId) ?? 0) + row.matchWeight);
  }
  return result;
}

function supportedDeltas(
  table: ReadonlyMap<string, RecommendationValueV5WeightedBinaryCount>,
  keys: readonly string[],
  priorProbability: number,
  priorStrength: number,
  minimumEffectiveObservations: number,
): number[] {
  const priorLogit = probabilityLogit(priorProbability);
  return uniqueKeys(keys)
    .map((key) => table.get(key))
    .filter(
      (count): count is RecommendationValueV5WeightedBinaryCount =>
        Boolean(count && count.total >= minimumEffectiveObservations),
    )
    .map(
      (count) =>
        probabilityLogit(
          posteriorProbability(count, priorProbability, priorStrength),
        ) - priorLogit,
    );
}

function robustAverage(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const trimCount = sorted.length >= 5 ? Math.floor(sorted.length * 0.1) : 0;
  const retained = sorted.slice(trimCount, sorted.length - trimCount);
  return retained.reduce((sum, value) => sum + value, 0) / retained.length;
}

function posteriorProbability(
  count: RecommendationValueV5WeightedBinaryCount,
  priorProbability: number,
  priorStrength: number,
): number {
  return clampProbability(
    (count.wins + priorProbability * priorStrength) /
      (count.total + priorStrength),
  );
}

function incrementTable(
  table: Map<string, RecommendationValueV5WeightedBinaryCount>,
  key: string,
  won: boolean,
  weight: number,
): void {
  const count = table.get(key) ?? { wins: 0, total: 0 };
  incrementCount(count, won, weight);
  table.set(key, count);
}

function incrementCount(
  count: RecommendationValueV5WeightedBinaryCount,
  won: boolean,
  weight: number,
): void {
  count.total += weight;
  count.wins += won ? weight : 0;
}

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))].sort();
}

function validateSourceRow(row: RecommendationValueV5SourceRow): void {
  if (!row.decisionId.trim()) {
    throw new Error('Value V5 decisionId is required.');
  }
  if (!row.matchId.trim()) {
    throw new Error(`Value V5 decision ${row.decisionId} has no matchId.`);
  }
  if (row.stateKeys.length === 0) {
    throw new Error(`Value V5 decision ${row.decisionId} has no state keys.`);
  }
  if (row.actionKeys.length === 0) {
    throw new Error(`Value V5 decision ${row.decisionId} has no action keys.`);
  }
}

function validateWeightedRow(row: RecommendationValueV5WeightedRow): void {
  validateSourceRow(row);
  if (!Number.isFinite(row.matchWeight) || row.matchWeight <= 0) {
    throw new Error(`Value V5 decision ${row.decisionId} has invalid match weight.`);
  }
}

function validateOptions(options: RecommendationValueV5ModelOptions): void {
  for (const [fieldName, value] of Object.entries(options)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${fieldName} must be a finite non-negative number.`);
    }
  }
  if (options.statePriorStrength <= 0 || options.actionPriorStrength <= 0) {
    throw new Error('Value V5 prior strengths must be greater than zero.');
  }
}

function probabilityLogit(probability: number): number {
  const value = clampProbability(probability);
  return Math.log(value / (1 - value));
}

function probabilityFromLogit(logit: number): number {
  return clampProbability(1 / (1 + Math.exp(-logit)));
}

function clampProbability(value: number): number {
  return clamp(value, EPSILON, 1 - EPSILON);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
