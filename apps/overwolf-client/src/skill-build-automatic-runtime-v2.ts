import {
  createEmptySkillLevels,
  HeroSkillBuildResponse,
  SkillLevel,
  SkillLevels,
  SkillSlot,
} from './skill-build-client';
import {
  AutomaticSkillTelemetryConfidence,
  AutomaticSkillTelemetryResult,
  extractAutomaticSkillTelemetry,
} from './skill-build-automatic-telemetry';

const SKILL_SLOTS = [1, 2, 3, 4] as const;
const INFO_POLL_INTERVAL_MS = 500;
const MAX_BUFFERED_PAYLOADS = 100;
const MAX_NORMALIZATION_DEPTH = 12;
const ABILITY_STATE_KEYS = new Set([
  'mvecabilityupgradestate',
  'abilityupgradestate',
  'abilityupgrades',
  'abilitystates',
  'skillupgradestate',
  'skillupgrades',
  'skillstates',
]);

export type AutomaticSkillTrackingStateV2 =
  | 'WAITING_FOR_HERO'
  | 'WAITING_FOR_TELEMETRY'
  | 'SYNCED';

export interface AutomaticSkillTrackingStatusV2 {
  state: AutomaticSkillTrackingStateV2;
  matchId: string;
  heroId?: number;
  levels: SkillLevels;
  confidence?: AutomaticSkillTelemetryConfidence;
  evidence: string[];
  updatedAt: string;
}

interface RuntimeContext {
  matchId: string;
  heroId: number;
  localSteamId?: string;
  build: HeroSkillBuildResponse;
}

interface BufferedPayload {
  value: unknown;
  source: 'getInfo' | 'info-update' | 'new-event';
  eventKey?: string;
  receivedAt: number;
}

interface ReconciledObservation {
  levels: SkillLevels;
  confidence: AutomaticSkillTelemetryConfidence;
  evidence: string[];
}

export class AutomaticSkillBuildRuntimeV2 {
  private readonly payloads: BufferedPayload[] = [];
  private lastAppliedLevels = createEmptySkillLevels();
  private lastMatchId = '';
  private lastHeroId?: number;
  private getInfoInFlight = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly overwolfApi: any,
    private readonly mainWindow: any,
  ) {}

  start(): void {
    this.registerEventListeners();
    this.pollGameInfo();
    this.timer = setInterval(() => this.pollGameInfo(), INFO_POLL_INTERVAL_MS);
    this.publishStatus('WAITING_FOR_HERO');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  observe(
    value: unknown,
    source: BufferedPayload['source'],
    eventKey?: string,
  ): void {
    this.payloads.push({ value, source, eventKey, receivedAt: Date.now() });
    if (this.payloads.length > MAX_BUFFERED_PAYLOADS) {
      this.payloads.splice(0, this.payloads.length - MAX_BUFFERED_PAYLOADS);
    }
    this.reconcile();
  }

  private registerEventListeners(): void {
    const eventsApi = this.overwolfApi?.games?.events;
    eventsApi?.onInfoUpdates2?.addListener?.((update: any) => {
      this.observe(update?.info, 'info-update', update?.feature);
    });
    eventsApi?.onNewEvents?.addListener?.((batch: any) => {
      const events = Array.isArray(batch?.events) ? batch.events : [];
      for (const event of events) {
        this.observe(parseJsonValue(event?.data), 'new-event', event?.name);
      }
    });
  }

  private pollGameInfo(): void {
    const getInfo = this.overwolfApi?.games?.events?.getInfo;
    if (this.getInfoInFlight || typeof getInfo !== 'function') {
      return;
    }

    this.getInfoInFlight = true;
    getInfo((result: any) => {
      this.getInfoInFlight = false;
      if (
        !result ||
        (result.success !== true && result.status !== 'success') ||
        !result.res
      ) {
        return;
      }
      this.observe(result.res, 'getInfo', 'getInfo');
    });
  }

  private reconcile(): void {
    const context = this.getRuntimeContext();
    if (!context) {
      this.publishStatus('WAITING_FOR_HERO');
      return;
    }

    if (this.resetForContextChange(context)) {
      this.pollGameInfo();
      this.publishStatus('WAITING_FOR_TELEMETRY', context);
      return;
    }

    const observation = reconcileReliableAutomaticSkillTelemetry(this.payloads, context);
    if (!observation) {
      this.publishStatus('WAITING_FOR_TELEMETRY', context);
      return;
    }

    this.applyLevels(context, observation.levels);
    this.publishStatus('SYNCED', context, observation);
  }

  private getRuntimeContext(): RuntimeContext | undefined {
    const presentation = this.mainWindow.latestSkillBuildPresentation;
    if (presentation?.state !== 'READY' || !presentation.build) {
      return undefined;
    }

    const build = presentation.build as HeroSkillBuildResponse;
    const heroId = Number(build.heroId);
    if (!Number.isSafeInteger(heroId) || heroId <= 0) {
      return undefined;
    }

    const liveSnapshot = this.mainWindow.latestLiveBuildRecommendation;
    return {
      matchId: String(
        liveSnapshot?.matchId ?? this.mainWindow.__deadlockLiveMatchId ?? '',
      ),
      heroId,
      localSteamId: normalizeSteamId(liveSnapshot?.steamId),
      build,
    };
  }

  private resetForContextChange(context: RuntimeContext): boolean {
    if (
      context.matchId === this.lastMatchId &&
      context.heroId === this.lastHeroId
    ) {
      return false;
    }

    this.lastMatchId = context.matchId;
    this.lastHeroId = context.heroId;
    this.lastAppliedLevels = { ...context.build.currentLevels };
    this.payloads.splice(0);
    return true;
  }

  private applyLevels(context: RuntimeContext, target: SkillLevels): void {
    const recordActualUpgrade = this.mainWindow.recordActualSkillUpgrade;
    if (typeof recordActualUpgrade !== 'function') {
      return;
    }

    const baseline = maxSkillLevels(
      context.build.currentLevels,
      this.lastAppliedLevels,
    );
    const monotonicTarget = maxSkillLevels(baseline, target);

    for (const skillSlot of SKILL_SLOTS) {
      for (
        let level = baseline[skillSlot];
        level < monotonicTarget[skillSlot];
        level += 1
      ) {
        recordActualUpgrade(skillSlot);
      }
    }

    this.lastAppliedLevels = monotonicTarget;
  }

  private publishStatus(
    state: AutomaticSkillTrackingStateV2,
    context?: RuntimeContext,
    observation?: ReconciledObservation,
  ): void {
    const status: AutomaticSkillTrackingStatusV2 = {
      state,
      matchId: context?.matchId ?? this.lastMatchId,
      heroId: context?.heroId ?? this.lastHeroId,
      levels: observation
        ? { ...observation.levels }
        : { ...this.lastAppliedLevels },
      confidence: observation?.confidence,
      evidence: observation?.evidence ?? [],
      updatedAt: new Date().toISOString(),
    };

    const previous = this.mainWindow.latestAutomaticSkillTrackingStatus as
      | AutomaticSkillTrackingStatusV2
      | undefined;
    if (previous && createStatusKey(previous) === createStatusKey(status)) {
      return;
    }

    this.mainWindow.latestAutomaticSkillTrackingStatus = status;
    this.mainWindow.inGameAutomaticSkillTrackingUpdate?.(status);
  }
}

export function initializeAutomaticSkillBuildRuntimeV2(
  overwolfApi: any,
  mainWindow: any,
): AutomaticSkillBuildRuntimeV2 {
  const existing = mainWindow.__automaticSkillBuildRuntimeV2 as
    | AutomaticSkillBuildRuntimeV2
    | undefined;
  if (existing) {
    return existing;
  }

  mainWindow.__automaticSkillBuildRuntime?.stop?.();
  const runtime = new AutomaticSkillBuildRuntimeV2(overwolfApi, mainWindow);
  mainWindow.__automaticSkillBuildRuntimeV2 = runtime;
  runtime.start();
  return runtime;
}

export function extractReliableAutomaticSkillTelemetry(
  payload: BufferedPayload,
  context: Pick<RuntimeContext, 'build' | 'localSteamId'>,
): AutomaticSkillTelemetryResult | undefined {
  const normalized = normalizeAutomaticSkillPayload(payload.value);
  const observation = extractAutomaticSkillTelemetry(normalized, {
    abilityIdsBySlot: context.build.abilityIdsBySlot,
    localSteamId: context.localSteamId,
    eventKey: payload.source === 'getInfo' ? 'getInfo' : payload.eventKey,
  });
  if (!observation) {
    return undefined;
  }

  const usesSingleVector = observation.evidence.some((entry) =>
    entry.includes('single-ability-state-vector'),
  );
  const usesVectorIndex = observation.evidence.some((entry) =>
    entry.includes('vector-index'),
  );

  if (usesSingleVector) {
    return payload.source === 'getInfo' &&
      Boolean(context.localSteamId) &&
      observation.complete &&
      observation.confidence !== 'LOW'
      ? observation
      : undefined;
  }

  if (usesVectorIndex) {
    return payload.source === 'getInfo' && Boolean(context.localSteamId)
      ? observation
      : undefined;
  }

  return observation;
}

export function reconcileReliableAutomaticSkillTelemetry(
  payloads: readonly BufferedPayload[],
  context: RuntimeContext,
): ReconciledObservation | undefined {
  let latestComplete:
    | { observation: AutomaticSkillTelemetryResult; receivedAt: number }
    | undefined;
  const levels = createEmptySkillLevels();
  const evidence = new Set<string>();
  let confidence: AutomaticSkillTelemetryConfidence = 'LOW';
  let found = false;

  for (const payload of payloads) {
    const observation = extractReliableAutomaticSkillTelemetry(payload, context);
    if (!observation) {
      continue;
    }

    found = true;
    confidence = higherConfidence(confidence, observation.confidence);
    for (const entry of observation.evidence) {
      evidence.add(entry);
    }

    if (observation.complete && observation.confidence !== 'LOW') {
      if (!latestComplete || payload.receivedAt >= latestComplete.receivedAt) {
        latestComplete = { observation, receivedAt: payload.receivedAt };
      }
      continue;
    }

    for (const skillSlot of observation.observedSlots) {
      levels[skillSlot] = Math.max(
        levels[skillSlot],
        observation.levels[skillSlot],
      ) as SkillLevel;
    }
  }

  if (!found) {
    return undefined;
  }

  if (latestComplete) {
    for (const skillSlot of SKILL_SLOTS) {
      levels[skillSlot] = Math.max(
        levels[skillSlot],
        latestComplete.observation.levels[skillSlot],
      ) as SkillLevel;
    }
    confidence = higherConfidence(
      confidence,
      latestComplete.observation.confidence,
    );
  }

  return { levels, confidence, evidence: [...evidence] };
}

export function normalizeAutomaticSkillPayload(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_NORMALIZATION_DEPTH) {
    return value;
  }

  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed.map((entry) => normalizeAutomaticSkillPayload(entry, depth + 1));
  }
  if (!isRecord(parsed)) {
    return parsed;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(parsed)) {
    if (ABILITY_STATE_KEYS.has(normalizeKey(key))) {
      normalized[key] = normalizeAbilityStateVector(nested, depth + 1);
    } else {
      normalized[key] = normalizeAutomaticSkillPayload(nested, depth + 1);
    }
  }
  return normalized;
}

function normalizeAbilityStateVector(value: unknown, depth: number): unknown {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed) || parsed.length !== SKILL_SLOTS.length) {
    return normalizeAutomaticSkillPayload(parsed, depth);
  }

  const integers = parsed.map(toInteger);
  if (integers.some((entry) => entry === undefined)) {
    return parsed.map((entry) => normalizeAutomaticSkillPayload(entry, depth));
  }

  const values = integers as number[];
  const packed = values.some((entry) => entry > 4);
  const direct = !packed && values.some((entry) => entry === 0 || entry >= 2);
  if (!packed && !direct) {
    return parsed;
  }

  return values.map((entry, index) =>
    packed
      ? { ability_slot: index + 1, m_nUpgradeInfo: entry }
      : { ability_slot: index + 1, level: entry },
  );
}

function maxSkillLevels(left: SkillLevels, right: SkillLevels): SkillLevels {
  return {
    1: Math.max(left[1], right[1]) as SkillLevel,
    2: Math.max(left[2], right[2]) as SkillLevel,
    3: Math.max(left[3], right[3]) as SkillLevel,
    4: Math.max(left[4], right[4]) as SkillLevel,
  };
}

function higherConfidence(
  left: AutomaticSkillTelemetryConfidence,
  right: AutomaticSkillTelemetryConfidence,
): AutomaticSkillTelemetryConfidence {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  return rank[right] > rank[left] ? right : left;
}

function createStatusKey(status: AutomaticSkillTrackingStatusV2): string {
  return [
    status.state,
    status.matchId,
    status.heroId ?? '',
    status.levels[1],
    status.levels[2],
    status.levels[3],
    status.levels[4],
    status.confidence ?? '',
    status.evidence.join(','),
  ].join('|');
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function toInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeSteamId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
