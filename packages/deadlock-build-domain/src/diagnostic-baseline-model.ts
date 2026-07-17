import {
  DiagnosticBuildActionType,
  DiagnosticGamePhase,
  DiagnosticTrainingExample,
  ParsedDiagnosticMatch,
  createDiagnosticInventoryStateKey,
  getDiagnosticGamePhase,
} from './diagnostic-match-parser';

export type DiagnosticBaselineBackoffLevel =
  | 'HERO_PHASE_STATE'
  | 'HERO_PHASE'
  | 'HERO'
  | 'GLOBAL'
  | 'NO_MATCH';

export interface DiagnosticBaselineQuery {
  heroId?: number;
  gameTimeSec?: number;
  phase?: DiagnosticGamePhase;
  stateKey: string;
  limit?: number;
  minSupport?: number;
}

export interface DiagnosticBaselineRecommendation {
  actionKey: string;
  actionType: DiagnosticBuildActionType;
  itemId: number;
  count: number;
  support: number;
  probability: number;
  backoffLevel: DiagnosticBaselineBackoffLevel;
}

export interface DiagnosticBaselineSummary {
  exampleCount: number;
  heroCount: number;
  actionCount: number;
  exactStateCount: number;
  heroPhaseCount: number;
  globalActionCount: number;
}

export interface DiagnosticBaselineEvaluationByAction {
  actionType: DiagnosticBuildActionType;
  exampleCount: number;
  predictedCount: number;
  top1Hits: number;
  top3Hits: number;
  top1Accuracy: number;
  top3Accuracy: number;
}

export interface DiagnosticBaselineEvaluation {
  matchCount: number;
  exampleCount: number;
  predictedCount: number;
  skippedNoTraining: number;
  skippedNoRecommendation: number;
  top1Hits: number;
  top3Hits: number;
  top1Accuracy: number;
  top3Accuracy: number;
  coverage: number;
  byActionType: DiagnosticBaselineEvaluationByAction[];
}

export interface DiagnosticDatasetSummary {
  matchCount: number;
  playerTimelineCount: number;
  localTimelineCount: number;
  inventorySnapshotCount: number;
  normalizedActionCount: number;
  trainingExampleCount: number;
  markerCount: number;
  matchedMarkerCount: number;
  unmatchedMarkerCount: number;
  diagnosticCount: number;
  examplesByActionType: Record<DiagnosticBuildActionType, number>;
  examplesByPhase: Record<DiagnosticGamePhase, number>;
}

type MutableActionCounts = Map<string, number>;

interface AggregationBucket {
  support: number;
  actionCounts: MutableActionCounts;
}

interface BaselineIndex {
  heroPhaseState: Map<string, AggregationBucket>;
  heroPhase: Map<string, AggregationBucket>;
  hero: Map<string, AggregationBucket>;
  global: AggregationBucket;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SUPPORT = 1;
const BUILD_ACTION_TYPES: DiagnosticBuildActionType[] = ['BUY', 'REBUY', 'UPGRADE', 'SELL'];
const GAME_PHASES: DiagnosticGamePhase[] = ['EARLY', 'MID', 'LATE', 'UNKNOWN'];

export class DiagnosticBaselineModel {
  private readonly index: BaselineIndex;
  private readonly summary: DiagnosticBaselineSummary;

  constructor(examples: readonly DiagnosticTrainingExample[]) {
    this.index = buildIndex(examples);
    this.summary = createSummary(examples, this.index);
  }

  recommend(query: DiagnosticBaselineQuery): DiagnosticBaselineRecommendation[] {
    const phase = query.phase ?? getDiagnosticGamePhase(query.gameTimeSec);
    const limit = normalizePositiveInteger(query.limit, DEFAULT_LIMIT);
    const minSupport = normalizePositiveInteger(query.minSupport, DEFAULT_MIN_SUPPORT);
    const candidates = this.resolveBucket(query.heroId, phase, query.stateKey, minSupport);
    if (!candidates) return [];

    const inventory = parseInventoryStateKey(query.stateKey);
    return [...candidates.bucket.actionCounts.entries()]
      .map(([actionKey, count]) => parseRecommendation(actionKey, count, candidates.bucket.support, candidates.level))
      .filter((recommendation): recommendation is DiagnosticBaselineRecommendation => Boolean(recommendation))
      .filter((recommendation) => isRecommendationLegal(recommendation, inventory))
      .sort(compareRecommendations)
      .slice(0, limit);
  }

  getSummary(): DiagnosticBaselineSummary {
    return { ...this.summary };
  }

  private resolveBucket(
    heroId: number | undefined,
    phase: DiagnosticGamePhase,
    stateKey: string,
    minSupport: number,
  ): { bucket: AggregationBucket; level: DiagnosticBaselineBackoffLevel } | undefined {
    if (heroId !== undefined) {
      const exact = this.index.heroPhaseState.get(heroPhaseStateKey(heroId, phase, stateKey));
      if (exact && exact.support >= minSupport) {
        return { bucket: exact, level: 'HERO_PHASE_STATE' };
      }

      const phaseBucket = this.index.heroPhase.get(heroPhaseKey(heroId, phase));
      if (phaseBucket && phaseBucket.support >= minSupport) {
        return { bucket: phaseBucket, level: 'HERO_PHASE' };
      }

      const heroBucket = this.index.hero.get(String(heroId));
      if (heroBucket && heroBucket.support >= minSupport) {
        return { bucket: heroBucket, level: 'HERO' };
      }
    }

    if (this.index.global.support >= minSupport) {
      return { bucket: this.index.global, level: 'GLOBAL' };
    }
    return undefined;
  }
}

export function trainDiagnosticBaseline(
  matchesOrExamples: readonly ParsedDiagnosticMatch[] | readonly DiagnosticTrainingExample[],
): DiagnosticBaselineModel {
  return new DiagnosticBaselineModel(toExamples(matchesOrExamples));
}

export function evaluateDiagnosticBaseline(
  matches: readonly ParsedDiagnosticMatch[],
  options: Pick<DiagnosticBaselineQuery, 'minSupport'> = {},
): DiagnosticBaselineEvaluation {
  const perAction = new Map<DiagnosticBuildActionType, MutableEvaluation>();
  for (const actionType of BUILD_ACTION_TYPES) perAction.set(actionType, emptyMutableEvaluation());

  let exampleCount = 0;
  let predictedCount = 0;
  let skippedNoTraining = 0;
  let skippedNoRecommendation = 0;
  let top1Hits = 0;
  let top3Hits = 0;

  for (const heldOutMatch of matches) {
    const trainingExamples = matches
      .filter((match) => match.matchId !== heldOutMatch.matchId)
      .flatMap((match) => match.trainingExamples);
    const model = trainingExamples.length ? new DiagnosticBaselineModel(trainingExamples) : undefined;

    for (const example of heldOutMatch.trainingExamples) {
      exampleCount += 1;
      const actionEvaluation = perAction.get(example.actionType) as MutableEvaluation;
      actionEvaluation.exampleCount += 1;

      if (!model) {
        skippedNoTraining += 1;
        continue;
      }

      const recommendations = model.recommend({
        heroId: example.heroId,
        gameTimeSec: example.gameTimeSec,
        phase: example.phase,
        stateKey: example.beforeStateKey,
        minSupport: options.minSupport,
        limit: 3,
      });
      if (!recommendations.length) {
        skippedNoRecommendation += 1;
        continue;
      }

      predictedCount += 1;
      actionEvaluation.predictedCount += 1;
      const top1 = recommendations[0]?.actionKey === example.actionKey;
      const top3 = recommendations.some((recommendation) => recommendation.actionKey === example.actionKey);
      if (top1) {
        top1Hits += 1;
        actionEvaluation.top1Hits += 1;
      }
      if (top3) {
        top3Hits += 1;
        actionEvaluation.top3Hits += 1;
      }
    }
  }

  return {
    matchCount: matches.length,
    exampleCount,
    predictedCount,
    skippedNoTraining,
    skippedNoRecommendation,
    top1Hits,
    top3Hits,
    top1Accuracy: ratio(top1Hits, predictedCount),
    top3Accuracy: ratio(top3Hits, predictedCount),
    coverage: ratio(predictedCount, exampleCount),
    byActionType: BUILD_ACTION_TYPES.map((actionType) =>
      finalizeActionEvaluation(actionType, perAction.get(actionType) as MutableEvaluation),
    ),
  };
}

export function summarizeDiagnosticDataset(matches: readonly ParsedDiagnosticMatch[]): DiagnosticDatasetSummary {
  const examplesByActionType = createActionCountRecord();
  const examplesByPhase = createPhaseCountRecord();
  let playerTimelineCount = 0;
  let localTimelineCount = 0;
  let inventorySnapshotCount = 0;
  let normalizedActionCount = 0;
  let markerCount = 0;
  let matchedMarkerCount = 0;
  let unmatchedMarkerCount = 0;
  let diagnosticCount = 0;

  for (const match of matches) {
    playerTimelineCount += match.timelines.length;
    localTimelineCount += match.timelines.filter((timeline) => timeline.player.isLocal).length;
    inventorySnapshotCount += match.timelines.reduce((sum, timeline) => sum + timeline.snapshots.length, 0);
    normalizedActionCount += match.timelines.reduce((sum, timeline) => sum + timeline.actions.length, 0);
    markerCount += match.markerResults.length;
    matchedMarkerCount += match.markerResults.filter((marker) => marker.status === 'MATCHED').length;
    unmatchedMarkerCount += match.markerResults.filter((marker) => marker.status === 'UNMATCHED').length;
    diagnosticCount += match.diagnostics.length;
    for (const example of match.trainingExamples) {
      examplesByActionType[example.actionType] += 1;
      examplesByPhase[example.phase] += 1;
    }
  }

  return {
    matchCount: matches.length,
    playerTimelineCount,
    localTimelineCount,
    inventorySnapshotCount,
    normalizedActionCount,
    trainingExampleCount: matches.reduce((sum, match) => sum + match.trainingExamples.length, 0),
    markerCount,
    matchedMarkerCount,
    unmatchedMarkerCount,
    diagnosticCount,
    examplesByActionType,
    examplesByPhase,
  };
}

export function createDiagnosticBaselineQueryFromTimeline(
  match: ParsedDiagnosticMatch,
  playerKey: string,
  limit = DEFAULT_LIMIT,
): DiagnosticBaselineQuery | undefined {
  const timeline = match.timelines.find((candidate) => candidate.playerKey === playerKey);
  if (!timeline) return undefined;
  const latestSnapshot = timeline.snapshots[timeline.snapshots.length - 1];
  return {
    heroId: timeline.player.heroId,
    gameTimeSec: latestSnapshot?.gameTimeSec,
    stateKey: timeline.finalStateKey,
    limit,
  };
}

function buildIndex(examples: readonly DiagnosticTrainingExample[]): BaselineIndex {
  const index: BaselineIndex = {
    heroPhaseState: new Map(),
    heroPhase: new Map(),
    hero: new Map(),
    global: createBucket(),
  };

  for (const example of examples) {
    addObservation(index.global, example.actionKey);
    if (example.heroId === undefined) continue;
    addToIndex(
      index.heroPhaseState,
      heroPhaseStateKey(example.heroId, example.phase, example.beforeStateKey),
      example.actionKey,
    );
    addToIndex(index.heroPhase, heroPhaseKey(example.heroId, example.phase), example.actionKey);
    addToIndex(index.hero, String(example.heroId), example.actionKey);
  }
  return index;
}

function createSummary(
  examples: readonly DiagnosticTrainingExample[],
  index: BaselineIndex,
): DiagnosticBaselineSummary {
  return {
    exampleCount: examples.length,
    heroCount: new Set(examples.map((example) => example.heroId).filter((heroId): heroId is number => heroId !== undefined)).size,
    actionCount: new Set(examples.map((example) => example.actionKey)).size,
    exactStateCount: index.heroPhaseState.size,
    heroPhaseCount: index.heroPhase.size,
    globalActionCount: index.global.actionCounts.size,
  };
}

function toExamples(
  matchesOrExamples: readonly ParsedDiagnosticMatch[] | readonly DiagnosticTrainingExample[],
): DiagnosticTrainingExample[] {
  const first = matchesOrExamples[0];
  if (!first) return [];
  if ('trainingExamples' in first) {
    return (matchesOrExamples as readonly ParsedDiagnosticMatch[]).flatMap((match) => match.trainingExamples);
  }
  return [...(matchesOrExamples as readonly DiagnosticTrainingExample[])];
}

function createBucket(): AggregationBucket {
  return { support: 0, actionCounts: new Map() };
}

function addToIndex(index: Map<string, AggregationBucket>, key: string, actionKey: string): void {
  const bucket = index.get(key) ?? createBucket();
  addObservation(bucket, actionKey);
  index.set(key, bucket);
}

function addObservation(bucket: AggregationBucket, actionKey: string): void {
  bucket.support += 1;
  bucket.actionCounts.set(actionKey, (bucket.actionCounts.get(actionKey) ?? 0) + 1);
}

function heroPhaseStateKey(heroId: number, phase: DiagnosticGamePhase, stateKey: string): string {
  return `${heroId}|${phase}|${normalizeStateKey(stateKey)}`;
}

function heroPhaseKey(heroId: number, phase: DiagnosticGamePhase): string {
  return `${heroId}|${phase}`;
}

function normalizeStateKey(stateKey: string): string {
  const inventory = parseInventoryStateKey(stateKey);
  return createDiagnosticInventoryStateKey(
    [...inventory.entries()].flatMap(([itemId, count]) => Array.from({ length: count }, () => itemId)),
  );
}

function parseInventoryStateKey(stateKey: string): Map<number, number> {
  const result = new Map<number, number>();
  if (!stateKey || stateKey === 'EMPTY') return result;

  for (const token of stateKey.split('|')) {
    const match = /^(\d+)x(\d+)$/.exec(token.trim());
    if (!match) continue;
    const itemId = Number(match[1]);
    const count = Number(match[2]);
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || !Number.isSafeInteger(count) || count <= 0) continue;
    result.set(itemId, (result.get(itemId) ?? 0) + count);
  }
  return result;
}

function parseRecommendation(
  actionKey: string,
  count: number,
  support: number,
  backoffLevel: DiagnosticBaselineBackoffLevel,
): DiagnosticBaselineRecommendation | undefined {
  const match = /^(BUY|REBUY|UPGRADE|SELL):(\d+)$/.exec(actionKey);
  if (!match) return undefined;
  const itemId = Number(match[2]);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return undefined;
  return {
    actionKey,
    actionType: match[1] as DiagnosticBuildActionType,
    itemId,
    count,
    support,
    probability: ratio(count, support),
    backoffLevel,
  };
}

function isRecommendationLegal(
  recommendation: DiagnosticBaselineRecommendation,
  inventory: ReadonlyMap<number, number>,
): boolean {
  const ownedCount = inventory.get(recommendation.itemId) ?? 0;
  if (recommendation.actionType === 'SELL') return ownedCount > 0;
  if (recommendation.actionType === 'BUY' || recommendation.actionType === 'REBUY') return ownedCount === 0;
  if (recommendation.actionType === 'UPGRADE') return ownedCount === 0;
  return true;
}

function compareRecommendations(
  left: DiagnosticBaselineRecommendation,
  right: DiagnosticBaselineRecommendation,
): number {
  if (right.probability !== left.probability) return right.probability - left.probability;
  if (right.count !== left.count) return right.count - left.count;
  if (left.actionType !== right.actionType) return left.actionType.localeCompare(right.actionType);
  return left.itemId - right.itemId;
}

interface MutableEvaluation {
  exampleCount: number;
  predictedCount: number;
  top1Hits: number;
  top3Hits: number;
}

function emptyMutableEvaluation(): MutableEvaluation {
  return { exampleCount: 0, predictedCount: 0, top1Hits: 0, top3Hits: 0 };
}

function finalizeActionEvaluation(
  actionType: DiagnosticBuildActionType,
  value: MutableEvaluation,
): DiagnosticBaselineEvaluationByAction {
  return {
    actionType,
    ...value,
    top1Accuracy: ratio(value.top1Hits, value.predictedCount),
    top3Accuracy: ratio(value.top3Hits, value.predictedCount),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function createActionCountRecord(): Record<DiagnosticBuildActionType, number> {
  return { BUY: 0, REBUY: 0, UPGRADE: 0, SELL: 0 };
}

function createPhaseCountRecord(): Record<DiagnosticGamePhase, number> {
  return GAME_PHASES.reduce(
    (result, phase) => {
      result[phase] = 0;
      return result;
    },
    {} as Record<DiagnosticGamePhase, number>,
  );
}
