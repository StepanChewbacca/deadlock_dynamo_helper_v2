import type { HeroBuildDecisionDatasetV3Row } from './hero-build-decision-dataset-v3.service';
import {
  HERO_BUILD_MAX_BACKOFF_DISTANCE,
  HERO_BUILD_MAX_BACKOFF_STATES,
  HERO_BUILD_MIN_EXACT_OBSERVATIONS,
  parseInventoryStateKey,
  recommendFromPolicy,
  type HeroBuildRecommendationOptions,
} from './hero-build-recommendation.service';
import type {
  HeroBuildPolicy,
  HeroBuildPolicyNextAction,
  HeroBuildPolicyState,
} from './hero-build-transition-aggregation.service';
import {
  candidateActionsFromRecommendationResponse,
  type RecommendationFrozenCandidateGeneratorSnapshot,
  type RecommendationHistoricalCandidateInput,
  type RecommendationHistoricalCatalogItem,
} from './recommendation-historical-pro-replay';
import { sha256StableJson } from './stable-json';

export const RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION = 1;
export const RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION =
  'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_1' as const;

export interface RecommendationSerializedHeroBuildPolicyState {
  stateKey: string;
  observationCount: number;
  nextActionCount: number;
  nextActions: HeroBuildPolicyNextAction[];
}

export interface RecommendationSerializedHeroBuildPolicy {
  heroId: number;
  playerCount: number;
  stateCount: number;
  transitionCount: number;
  states: RecommendationSerializedHeroBuildPolicyState[];
}

export interface RecommendationCandidateGeneratorSnapshotArtifact {
  schemaVersion: typeof RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION;
  artifactVersion: typeof RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION;
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot;
  generatorOptions: HeroBuildRecommendationOptions;
  policies: RecommendationSerializedHeroBuildPolicy[];
  catalog: {
    version: string;
    items: RecommendationHistoricalCatalogItem[];
  };
}

export type RecommendationCandidateGeneratorSnapshotMetadata = Omit<
  RecommendationCandidateGeneratorSnapshotArtifact,
  'policies'
>;

export interface RecommendationPreparedHeroBuildPolicy {
  heroId: number;
  policy: HeroBuildPolicy;
  parsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
  supportPolicy: HeroBuildPolicy;
  supportParsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
}

export interface RecommendationCandidateGeneratorSnapshotRegistryEntry {
  fileName: string;
  artifactSha256: string;
  snapshotId: string;
  trainingWindowEnd: string;
}

export interface RecommendationCandidateGeneratorSnapshotRegistry {
  schemaVersion: 1;
  registryVersion: 'RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_1';
  generatedAt: string;
  snapshots: RecommendationCandidateGeneratorSnapshotRegistryEntry[];
}

export function candidateGeneratorPolicyPayload(
  artifact: RecommendationCandidateGeneratorSnapshotArtifact,
): unknown {
  return {
    generatorOptions: normalizeGeneratorOptions(artifact.generatorOptions),
    policies: normalizePolicies(artifact.policies),
  };
}

export function candidateGeneratorCatalogPayload(
  artifact: RecommendationCandidateGeneratorSnapshotArtifact,
): unknown {
  return {
    version: artifact.catalog.version,
    items: normalizeCatalogItems(artifact.catalog.items),
  };
}

export function validateRecommendationCandidateGeneratorSnapshotMetadata(
  artifact: RecommendationCandidateGeneratorSnapshotMetadata,
): void {
  if (
    artifact.schemaVersion !==
      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION ||
    artifact.artifactVersion !==
      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION
  ) {
    throw new Error('Unsupported recommendation candidate generator snapshot.');
  }
  validateSnapshotIdentity(artifact.snapshot);
  validateGeneratorOptions(artifact.generatorOptions);
  if (
    !artifact.catalog ||
    !Array.isArray(artifact.catalog.items) ||
    !artifact.catalog.version.trim()
  ) {
    throw new Error('Candidate generator snapshot catalog is invalid.');
  }
  if (artifact.catalog.version !== artifact.snapshot.catalogVersion) {
    throw new Error('Candidate generator snapshot catalog version does not match metadata.');
  }
  const normalizedCatalog = normalizeCatalogItems(artifact.catalog.items);
  const itemIds = new Set<number>();
  for (const item of normalizedCatalog) {
    if (itemIds.has(item.itemId)) {
      throw new Error(`Candidate generator snapshot duplicates item ${item.itemId}.`);
    }
    itemIds.add(item.itemId);
  }
}

export function validateRecommendationCandidateGeneratorSnapshotArtifact(
  artifact: RecommendationCandidateGeneratorSnapshotArtifact,
): void {
  if (
    artifact.schemaVersion !==
      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION ||
    artifact.artifactVersion !==
      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION
  ) {
    throw new Error('Unsupported recommendation candidate generator snapshot.');
  }
  validateSnapshotIdentity(artifact.snapshot);
  validateGeneratorOptions(artifact.generatorOptions);

  const policies = artifact.policies;
  if (policies.length === 0) {
    throw new Error('Candidate generator snapshot contains no hero policies.');
  }
  const heroIds = new Set<number>();
  for (const policy of policies) {
    if (heroIds.has(policy.heroId)) {
      throw new Error(`Candidate generator snapshot duplicates hero ${policy.heroId}.`);
    }
    heroIds.add(policy.heroId);
    validateSerializedPolicy(policy);
  }

  const normalizedCatalog = normalizeCatalogItems(artifact.catalog.items);
  if (!artifact.catalog.version.trim()) {
    throw new Error('Candidate generator snapshot catalog version is required.');
  }
  if (artifact.catalog.version !== artifact.snapshot.catalogVersion) {
    throw new Error('Candidate generator snapshot catalog version does not match metadata.');
  }
  const itemIds = new Set<number>();
  for (const item of normalizedCatalog) {
    if (itemIds.has(item.itemId)) {
      throw new Error(`Candidate generator snapshot duplicates item ${item.itemId}.`);
    }
    itemIds.add(item.itemId);
  }

  const actualPolicySha256 = sha256StableJson({
    generatorOptions: artifact.generatorOptions,
    policies: artifact.policies,
  });
  if (actualPolicySha256 !== artifact.snapshot.policySha256) {
    throw new Error(
      `Candidate generator policy SHA-256 mismatch: ${actualPolicySha256} versus ` +
        `${artifact.snapshot.policySha256}.`,
    );
  }
  const actualCatalogSha256 = sha256StableJson(
    candidateGeneratorCatalogPayload(artifact),
  );
  if (actualCatalogSha256 !== artifact.snapshot.catalogSha256) {
    throw new Error(
      `Candidate generator catalog SHA-256 mismatch: ${actualCatalogSha256} versus ` +
        `${artifact.snapshot.catalogSha256}.`,
    );
  }
}

export function selectRecommendationCandidateGeneratorSnapshotArtifact(
  artifacts: readonly RecommendationCandidateGeneratorSnapshotArtifact[],
  matchStartTime: string,
): RecommendationCandidateGeneratorSnapshotArtifact | undefined {
  const matchTime = requiredTimestamp(matchStartTime, 'matchStartTime');
  return [...artifacts]
    .filter((artifact) => {
      validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);
      return (
        requiredTimestamp(
          artifact.snapshot.trainingWindowEnd,
          'trainingWindowEnd',
        ) < matchTime
      );
    })
    .sort(
      (left, right) =>
        requiredTimestamp(
          right.snapshot.trainingWindowEnd,
          'trainingWindowEnd',
        ) -
          requiredTimestamp(
            left.snapshot.trainingWindowEnd,
            'trainingWindowEnd',
          ) ||
        left.snapshot.snapshotId.localeCompare(right.snapshot.snapshotId),
    )[0];
}

export function generateRecommendationHistoricalCandidatesFromSnapshot(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  artifact: RecommendationCandidateGeneratorSnapshotArtifact;
}): RecommendationHistoricalCandidateInput[] {
  validateRecommendationCandidateGeneratorSnapshotArtifact(input.artifact);
  return generateRecommendationHistoricalCandidatesFromValidatedSnapshot(input);
}

export function generateRecommendationHistoricalCandidatesFromValidatedSnapshot(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  artifact: RecommendationCandidateGeneratorSnapshotArtifact;
}): RecommendationHistoricalCandidateInput[] {
  const policyValue = input.artifact.policies.find(
    (policy) => policy.heroId === input.decision.heroId,
  );
  return generateRecommendationHistoricalCandidatesFromPreparedPolicy({
    decision: input.decision,
    snapshot: input.artifact.snapshot,
    generatorOptions: input.artifact.generatorOptions,
    catalog: input.artifact.catalog,
    policy: policyValue
      ? prepareRecommendationSerializedHeroBuildPolicy(policyValue)
      : undefined,
  });
}

export function validateRecommendationSerializedHeroBuildPolicy(
  value: RecommendationSerializedHeroBuildPolicy,
): void {
  validateSerializedPolicy(value);
}

export function prepareRecommendationSerializedHeroBuildPolicy(
  value: RecommendationSerializedHeroBuildPolicy,
): RecommendationPreparedHeroBuildPolicy {
  validateRecommendationSerializedHeroBuildPolicy(value);
  const policy = deserializePolicy(value);
  const parsedStates = [...policy.statesByKey.values()]
    .map((state) => ({
      state,
      itemCounts: parseInventoryStateKey(state.stateKey),
    }))
    .filter(
      (
        item,
      ): item is {
        state: HeroBuildPolicyState;
        itemCounts: ReadonlyMap<number, number>;
      } => item.itemCounts !== undefined,
    );
  const support = buildHistoricalSupportPolicy(value);
  return {
    heroId: value.heroId,
    policy,
    parsedStates,
    supportPolicy: support.policy,
    supportParsedStates: support.parsedStates,
  };
}

export function generateRecommendationHistoricalCandidatesFromPreparedPolicy(input: {
  decision: HeroBuildDecisionDatasetV3Row;
  snapshot: RecommendationFrozenCandidateGeneratorSnapshot;
  generatorOptions: HeroBuildRecommendationOptions;
  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];
  policy?: RecommendationPreparedHeroBuildPolicy;
  componentsByParent?: ReadonlyMap<number, number[]>;
}): RecommendationHistoricalCandidateInput[] {
  const matchTime = requiredTimestamp(
    input.decision.matchStartTime,
    'decision.matchStartTime',
  );
  const trainingEnd = requiredTimestamp(
    input.snapshot.trainingWindowEnd,
    'trainingWindowEnd',
  );
  if (trainingEnd >= matchTime) {
    throw new Error(
      'Candidate generator snapshot training window must end before the replay match.',
    );
  }
  if (!input.policy) {
    return [];
  }
  if (input.policy.heroId !== input.decision.heroId) {
    throw new Error('Prepared candidate policy hero does not match the replay decision.');
  }

  const inventory = parseInventoryStateKey(
    input.decision.inventoryBeforeStateKey,
  );
  if (!inventory) {
    throw new Error(
      `Invalid replay inventory state ${input.decision.inventoryBeforeStateKey}.`,
    );
  }
  const itemIds = [...inventory.entries()].flatMap(([itemId, count]) =>
    Array.from({ length: count }, () => itemId),
  );
  const componentsByParent =
    input.componentsByParent ??
    new Map<number, number[]>(
      input.catalog.items.map((item) => [
        item.itemId,
        [...item.componentItemIds],
      ]),
    );
  const request = {
    heroId: input.decision.heroId,
    itemIds,
    gameTimeS: input.decision.gameTimeS,
    limit: input.generatorOptions.limit,
  };
  const recipeResolver = (parentItemId: number): readonly number[] =>
    componentsByParent.get(parentItemId) ?? [];
  const response = recommendFromPolicy(
    request,
    input.decision.inventoryBeforeStateKey,
    input.policy.policy,
    input.policy.parsedStates,
    recipeResolver,
    normalizeGeneratorOptions(input.generatorOptions),
  );
  const supportResponse = recommendFromPolicy(
    request,
    input.decision.inventoryBeforeStateKey,
    input.policy.supportPolicy,
    input.policy.supportParsedStates,
    recipeResolver,
    {
      minExactObservations: 1,
      maxBackoffDistance: 64,
      maxBackoffStates: 1,
      limit: input.generatorOptions.limit,
    },
  );
  return mergeHistoricalCandidateActions(
    candidateActionsFromRecommendationResponse(response),
    candidateActionsFromRecommendationResponse(supportResponse),
    input.generatorOptions.limit,
  );
}

function mergeHistoricalCandidateActions(
  primary: readonly RecommendationHistoricalCandidateInput[],
  support: readonly RecommendationHistoricalCandidateInput[],
  limit: number,
): RecommendationHistoricalCandidateInput[] {
  const unique = new Map<string, RecommendationHistoricalCandidateInput>();
  for (const candidate of [...primary, ...support]) {
    const actionKey = `${candidate.actionType}:${candidate.itemId}`;
    if (unique.has(actionKey)) {
      continue;
    }
    unique.set(actionKey, {
      ...candidate,
      actionKey,
      rank: unique.size + 1,
    });
    if (unique.size >= limit) {
      break;
    }
  }
  return [...unique.values()];
}

function buildHistoricalSupportPolicy(
  value: RecommendationSerializedHeroBuildPolicy,
): {
  policy: HeroBuildPolicy;
  parsedStates: Array<{
    state: HeroBuildPolicyState;
    itemCounts: ReadonlyMap<number, number>;
  }>;
} {
  const aggregates = new Map<
    string,
    {
      actionType: HeroBuildPolicyNextAction['actionType'];
      itemId: number;
      actionKey: string;
      count: number;
      totalGameTimeS: number;
      afterStateCounts: Map<string, number>;
    }
  >();
  let observationCount = 0;
  let transitionCount = 0;

  for (const state of value.states) {
    observationCount += state.observationCount;
    for (const action of state.nextActions) {
      const key = `${action.actionType}:${action.itemId}`;
      const aggregate = aggregates.get(key) ?? {
        actionType: action.actionType,
        itemId: action.itemId,
        actionKey: key,
        count: 0,
        totalGameTimeS: 0,
        afterStateCounts: new Map<string, number>(),
      };
      aggregate.count += action.count;
      aggregate.totalGameTimeS += action.averageGameTimeS * action.count;
      transitionCount += action.count;
      for (const afterState of action.afterStates) {
        aggregate.afterStateCounts.set(
          afterState.afterStateKey,
          (aggregate.afterStateCounts.get(afterState.afterStateKey) ?? 0) +
            afterState.count,
        );
      }
      aggregates.set(key, aggregate);
    }
  }

  const nextActions = [...aggregates.values()]
    .map((aggregate): HeroBuildPolicyNextAction => ({
      actionType: aggregate.actionType,
      itemId: aggregate.itemId,
      actionKey: aggregate.actionKey,
      count: aggregate.count,
      probability:
        transitionCount > 0 ? aggregate.count / transitionCount : 0,
      averageGameTimeS:
        aggregate.count > 0
          ? aggregate.totalGameTimeS / aggregate.count
          : 0,
      afterStates: [...aggregate.afterStateCounts.entries()]
        .map(([afterStateKey, count]) => ({
          afterStateKey,
          count,
          probability:
            aggregate.count > 0 ? count / aggregate.count : 0,
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
  const state: HeroBuildPolicyState = {
    heroId: value.heroId,
    stateKey: 'EMPTY',
    observationCount: Math.max(1, observationCount),
    nextActionCount: nextActions.length,
    nextActions,
  };
  return {
    policy: {
      heroId: value.heroId,
      playerCount: value.playerCount,
      stateCount: 1,
      transitionCount,
      statesByKey: new Map([[state.stateKey, state]]),
    },
    parsedStates: [{ state, itemCounts: new Map<number, number>() }],
  };
}

export function createRecommendationCandidateGeneratorSnapshotArtifact(input: {
  snapshot: Omit<
    RecommendationFrozenCandidateGeneratorSnapshot,
    'policySha256' | 'catalogSha256'
  >;
  generatorOptions?: Partial<HeroBuildRecommendationOptions>;
  policies: RecommendationSerializedHeroBuildPolicy[];
  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];
}): RecommendationCandidateGeneratorSnapshotArtifact {
  return createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies({
    ...input,
    policies: normalizePolicies(input.policies),
  });
}

export function createRecommendationCandidateGeneratorSnapshotArtifactFromNormalizedPolicies(input: {
  snapshot: Omit<
    RecommendationFrozenCandidateGeneratorSnapshot,
    'policySha256' | 'catalogSha256'
  >;
  generatorOptions?: Partial<HeroBuildRecommendationOptions>;
  policies: RecommendationSerializedHeroBuildPolicy[];
  catalog: RecommendationCandidateGeneratorSnapshotArtifact['catalog'];
}): RecommendationCandidateGeneratorSnapshotArtifact {
  const artifact = {
    schemaVersion:
      RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_SCHEMA_VERSION,
    artifactVersion: RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_VERSION,
    snapshot: {
      ...input.snapshot,
      policySha256: '',
      catalogSha256: '',
    },
    generatorOptions: normalizeGeneratorOptions({
      minExactObservations:
        input.generatorOptions?.minExactObservations ??
        HERO_BUILD_MIN_EXACT_OBSERVATIONS,
      maxBackoffDistance:
        input.generatorOptions?.maxBackoffDistance ??
        HERO_BUILD_MAX_BACKOFF_DISTANCE,
      maxBackoffStates:
        input.generatorOptions?.maxBackoffStates ??
        HERO_BUILD_MAX_BACKOFF_STATES,
      limit: input.generatorOptions?.limit ?? 100,
    }),
    policies: input.policies,
    catalog: {
      version: input.catalog.version,
      items: normalizeCatalogItems(input.catalog.items),
    },
  } satisfies RecommendationCandidateGeneratorSnapshotArtifact;
  artifact.snapshot.policySha256 = sha256StableJson({
    generatorOptions: artifact.generatorOptions,
    policies: artifact.policies,
  });
  artifact.snapshot.catalogSha256 = sha256StableJson(
    candidateGeneratorCatalogPayload(artifact),
  );
  validateRecommendationCandidateGeneratorSnapshotArtifact(artifact);
  return artifact;
}

function deserializePolicy(
  value: RecommendationSerializedHeroBuildPolicy,
): HeroBuildPolicy {
  const statesByKey = new Map<string, HeroBuildPolicyState>();
  for (const state of value.states) {
    statesByKey.set(state.stateKey, {
      heroId: value.heroId,
      stateKey: state.stateKey,
      observationCount: state.observationCount,
      nextActionCount: state.nextActionCount,
      nextActions: state.nextActions.map(cloneNextAction),
    });
  }
  return {
    heroId: value.heroId,
    playerCount: value.playerCount,
    stateCount: statesByKey.size,
    transitionCount: value.transitionCount,
    statesByKey,
  };
}

function normalizePolicies(
  values: readonly RecommendationSerializedHeroBuildPolicy[],
): RecommendationSerializedHeroBuildPolicy[] {
  return values
    .map((policy) => ({
      heroId: policy.heroId,
      playerCount: policy.playerCount,
      stateCount: policy.states.length,
      transitionCount: policy.transitionCount,
      states: policy.states
        .map((state) => ({
          stateKey: state.stateKey,
          observationCount: state.observationCount,
          nextActionCount: state.nextActions.length,
          nextActions: state.nextActions
            .map(cloneNextAction)
            .sort(
              (left, right) =>
                right.count - left.count ||
                left.actionKey.localeCompare(right.actionKey),
            ),
        }))
        .sort((left, right) => left.stateKey.localeCompare(right.stateKey)),
    }))
    .sort((left, right) => left.heroId - right.heroId);
}

function normalizeCatalogItems(
  values: readonly RecommendationHistoricalCatalogItem[],
): RecommendationHistoricalCatalogItem[] {
  return values
    .map((item) => ({
      itemId: item.itemId,
      name: item.name,
      cost: item.cost,
      tier: item.tier,
      slotType: item.slotType,
      itemType: item.itemType,
      isActiveItem: item.isActiveItem,
      activationType: item.activationType,
      tags: [...item.tags].sort(),
      componentItemIds: [...item.componentItemIds].sort(
        (left, right) => left - right,
      ),
    }))
    .sort((left, right) => left.itemId - right.itemId);
}

function cloneNextAction(
  action: HeroBuildPolicyNextAction,
): HeroBuildPolicyNextAction {
  return {
    actionType: action.actionType,
    itemId: action.itemId,
    actionKey: action.actionKey,
    count: action.count,
    probability: action.probability,
    averageGameTimeS: action.averageGameTimeS,
    afterStates: action.afterStates
      .map((state) => ({ ...state }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.afterStateKey.localeCompare(right.afterStateKey),
      ),
  };
}

function normalizeGeneratorOptions(
  value: HeroBuildRecommendationOptions,
): HeroBuildRecommendationOptions {
  return {
    minExactObservations: value.minExactObservations,
    maxBackoffDistance: value.maxBackoffDistance,
    maxBackoffStates: value.maxBackoffStates,
    limit: value.limit,
  };
}

function validateSerializedPolicy(
  policy: RecommendationSerializedHeroBuildPolicy,
): void {
  positiveInteger(policy.heroId, 'policy.heroId');
  nonNegativeInteger(policy.playerCount, 'policy.playerCount');
  nonNegativeInteger(policy.transitionCount, 'policy.transitionCount');
  const stateKeys = new Set<string>();
  for (const state of policy.states) {
    if (!state.stateKey.trim()) {
      throw new Error('Candidate generator policy stateKey is required.');
    }
    if (stateKeys.has(state.stateKey)) {
      throw new Error(
        `Candidate generator policy duplicates state ${state.stateKey}.`,
      );
    }
    stateKeys.add(state.stateKey);
    positiveInteger(state.observationCount, 'state.observationCount');
    const actionKeys = new Set<string>();
    for (const action of state.nextActions) {
      if (!action.actionKey.trim()) {
        throw new Error('Candidate generator actionKey is required.');
      }
      if (actionKeys.has(action.actionKey)) {
        throw new Error(
          `Candidate generator state ${state.stateKey} duplicates ` +
            `${action.actionKey}.`,
        );
      }
      actionKeys.add(action.actionKey);
      positiveInteger(action.itemId, 'action.itemId');
      positiveInteger(action.count, 'action.count');
      finiteNumber(action.probability, 'action.probability');
      finiteNumber(action.averageGameTimeS, 'action.averageGameTimeS');
    }
  }
}

function validateSnapshotIdentity(
  value: RecommendationFrozenCandidateGeneratorSnapshot,
): void {
  for (const [name, field] of Object.entries({
    snapshotId: value.snapshotId,
    generatorVersion: value.generatorVersion,
    policyVersion: value.policyVersion,
    catalogVersion: value.catalogVersion,
  })) {
    if (!field.trim()) {
      throw new Error(`Candidate generator snapshot ${name} is required.`);
    }
  }
  requiredSha(value.policySha256, 'policySha256');
  requiredSha(value.catalogSha256, 'catalogSha256');
  const start = requiredTimestamp(
    value.trainingWindowStart,
    'trainingWindowStart',
  );
  const end = requiredTimestamp(value.trainingWindowEnd, 'trainingWindowEnd');
  if (end <= start) {
    throw new Error(
      'Candidate generator snapshot training window end must follow its start.',
    );
  }
}

function validateGeneratorOptions(
  value: HeroBuildRecommendationOptions,
): void {
  positiveInteger(value.minExactObservations, 'minExactObservations');
  nonNegativeInteger(value.maxBackoffDistance, 'maxBackoffDistance');
  positiveInteger(value.maxBackoffStates, 'maxBackoffStates');
  positiveInteger(value.limit, 'limit');
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

function finiteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }
}

function requiredSha(value: string, name: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }
  return normalized;
}

function requiredTimestamp(value: string, name: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new Error(`${name} must be an ISO timestamp.`);
  }
  return result;
}
