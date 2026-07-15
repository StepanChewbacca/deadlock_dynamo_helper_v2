import {
  createEmptySkillLevels,
  createSkillLevelsKey,
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
const INFO_POLL_INTERVAL_MS = 750;
const PRESENTATION_POLL_INTERVAL_MS = 250;
const MAX_BUFFERED_PAYLOADS = 80;

export type AutomaticSkillTrackingState =
  | 'WAITING_FOR_HERO'
  | 'WAITING_FOR_TELEMETRY'
  | 'SYNCED';

export interface AutomaticSkillTrackingStatus {
  state: AutomaticSkillTrackingState;
  matchId: string;
  heroId?: number;
  levels: SkillLevels;
  confidence?: AutomaticSkillTelemetryConfidence;
  evidence: string[];
  updatedAt: string;
}

interface BufferedPayload {
  value: unknown;
  eventKey?: string;
  receivedAt: number;
}

interface RuntimeContext {
  matchId: string;
  heroId: number;
  localSteamId?: string;
  build: HeroSkillBuildResponse;
}

interface ReconciledObservation {
  levels: SkillLevels;
  observedSlots: SkillSlot[];
  complete: boolean;
  confidence: AutomaticSkillTelemetryConfidence;
  evidence: string[];
}

export class AutomaticSkillBuildRuntime {
  private readonly payloads: BufferedPayload[] = [];
  private readonly observedSlots = new Set<SkillSlot>();
  private observedLevels: SkillLevels = createEmptySkillLevels();
  private lastAppliedLevels: SkillLevels = createEmptySkillLevels();
  private lastMatchId = '';
  private lastHeroId?: number;
  private exactObservation = false;
  private getInfoInFlight = false;
  private infoTimer?: ReturnType<typeof setInterval>;
  private presentationTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly overwolfApi: any,
    private readonly mainWindow: any,
  ) {}

  start(): void {
    this.registerEventListeners();
    this.pollGameInfo();
    this.infoTimer = setInterval(() => this.pollGameInfo(), INFO_POLL_INTERVAL_MS);
    this.presentationTimer = setInterval(
      () => this.reconcileFromBufferedPayloads(),
      PRESENTATION_POLL_INTERVAL_MS,
    );
    this.publishStatus('WAITING_FOR_HERO');
  }

  stop(): void {
    if (this.infoTimer) {
      clearInterval(this.infoTimer);
      this.infoTimer = undefined;
    }
    if (this.presentationTimer) {
      clearInterval(this.presentationTimer);
      this.presentationTimer = undefined;
    }
  }

  observe(value: unknown, eventKey?: string): void {
    this.payloads.push({
      value,
      eventKey,
      receivedAt: Date.now(),
    });
    if (this.payloads.length > MAX_BUFFERED_PAYLOADS) {
      this.payloads.splice(0, this.payloads.length - MAX_BUFFERED_PAYLOADS);
    }
    this.reconcileFromBufferedPayloads();
  }

  private registerEventListeners(): void {
    const eventsApi = this.overwolfApi?.games?.events;
    eventsApi?.onInfoUpdates2?.addListener?.((update: any) => {
      this.observe(update?.info, update?.feature);
    });
    eventsApi?.onNewEvents?.addListener?.((batch: any) => {
      const events = Array.isArray(batch?.events) ? batch.events : [];
      for (const event of events) {
        this.observe(parseJsonValue(event?.data), event?.name);
      }
    });
  }

  private pollGameInfo(): void {
    const eventsApi = this.overwolfApi?.games?.events;
    if (this.getInfoInFlight || typeof eventsApi?.getInfo !== 'function') {
      return;
    }

    this.getInfoInFlight = true;
    eventsApi.getInfo((result: any) => {
      this.getInfoInFlight = false;
      if (
        !result ||
        (result.success !== true && result.status !== 'success') ||
        !result.res
      ) {
        return;
      }
      this.observe(result.res, 'getInfo');
    });
  }

  private reconcileFromBufferedPayloads(): void {
    const context = this.getRuntimeContext();
    if (!context) {
      this.publishStatus('WAITING_FOR_HERO');
      return;
    }

    const contextChanged = this.resetForContextChange(context);
    if (contextChanged) {
      this.pollGameInfo();
      this.publishStatus('WAITING_FOR_TELEMETRY', context);
      return;
    }

    const reconciled = reconcileAutomaticSkillObservations(
      this.payloads,
      context,
    );
    if (!reconciled) {
      this.publishStatus('WAITING_FOR_TELEMETRY', context);
      return;
    }

    this.applyObservation(reconciled);
    this.applyLevelsToExistingSkillRuntime(context);
    this.publishStatus(
      reconciled.confidence === 'LOW' ? 'WAITING_FOR_TELEMETRY' : 'SYNCED',
      context,
      reconciled,
    );
  }

  private getRuntimeContext(): RuntimeContext | undefined {
    const presentation = this.mainWindow.latestSkillBuildPresentation;
    if (presentation?.state !== 'READY' || !presentation.build) {
      return undefined;
    }

    const liveSnapshot = this.mainWindow.latestLiveBuildRecommendation;
    const heroId = Number(presentation.build.heroId);
    if (!Number.isSafeInteger(heroId) || heroId <= 0) {
      return undefined;
    }

    return {
      matchId: String(
        liveSnapshot?.matchId ??
          this.mainWindow.__deadlockLiveMatchId ??
          '',
      ),
      heroId,
      localSteamId: normalizeSteamId(liveSnapshot?.steamId),
      build: presentation.build as HeroSkillBuildResponse,
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
    this.observedLevels = createEmptySkillLevels();
    this.observedSlots.clear();
    this.exactObservation = false;
    this.lastAppliedLevels = { ...context.build.currentLevels };
    this.payloads.splice(0);
    return true;
  }

  private applyObservation(observation: ReconciledObservation): void {
    if (observation.complete && observation.confidence !== 'LOW') {
      this.observedLevels = { ...observation.levels };
      this.observedSlots.clear();
      for (const skillSlot of SKILL_SLOTS) {
        this.observedSlots.add(skillSlot);
      }
      this.exactObservation = true;
      return;
    }

    for (const skillSlot of observation.observedSlots) {
      this.observedLevels[skillSlot] = Math.max(
        this.observedLevels[skillSlot],
        observation.levels[skillSlot],
      ) as SkillLevel;
      this.observedSlots.add(skillSlot);
    }
  }

  private applyLevelsToExistingSkillRuntime(context: RuntimeContext): void {
    const recordActualUpgrade = this.mainWindow.recordActualSkillUpgrade;
    if (typeof recordActualUpgrade !== 'function') {
      return;
    }

    let baseline = maxSkillLevels(
      context.build.currentLevels,
      this.lastAppliedLevels,
    );
    const target = this.exactObservation
      ? { ...this.observedLevels }
      : mergePartialLevels(baseline, this.observedLevels, this.observedSlots);

    if (
      this.exactObservation &&
      hasAnyHigherLevel(baseline, target) &&
      typeof this.mainWindow.resetSkillProgress === 'function'
    ) {
      this.mainWindow.resetSkillProgress();
      baseline = createEmptySkillLevels();
    }

    for (const skillSlot of SKILL_SLOTS) {
      for (
        let level = baseline[skillSlot];
        level < target[skillSlot];
        level += 1
      ) {
        recordActualUpgrade(skillSlot);
      }
    }

    this.lastAppliedLevels = { ...target };
  }

  private publishStatus(
    state: AutomaticSkillTrackingState,
    context?: RuntimeContext,
    observation?: ReconciledObservation,
  ): void {
    const status: AutomaticSkillTrackingStatus = {
      state,
      matchId: context?.matchId ?? this.lastMatchId,
      heroId: context?.heroId ?? this.lastHeroId,
      levels: observation
        ? { ...observation.levels }
        : { ...this.observedLevels },
      confidence: observation?.confidence,
      evidence: observation?.evidence ?? [],
      updatedAt: new Date().toISOString(),
    };

    const previous = this.mainWindow.latestAutomaticSkillTrackingStatus as
      | AutomaticSkillTrackingStatus
      | undefined;
    if (previous && getStatusKey(previous) === getStatusKey(status)) {
      return;
    }

    this.mainWindow.latestAutomaticSkillTrackingStatus = status;
    this.mainWindow.inGameAutomaticSkillTrackingUpdate?.(status);
  }
}

export function initializeAutomaticSkillBuildRuntime(
  overwolfApi: any,
  mainWindow: any,
): AutomaticSkillBuildRuntime {
  const existing = mainWindow.__automaticSkillBuildRuntime as
    | AutomaticSkillBuildRuntime
    | undefined;
  if (existing) {
    return existing;
  }

  const runtime = new AutomaticSkillBuildRuntime(overwolfApi, mainWindow);
  mainWindow.__automaticSkillBuildRuntime = runtime;
  runtime.start();
  return runtime;
}

export function isSafeAutomaticSkillObservation(
  observation: AutomaticSkillTelemetryResult,
  payload: Pick<BufferedPayload, 'eventKey'>,
  context: Pick<RuntimeContext, 'localSteamId'>,
): boolean {
  const usesVectorIndex = observation.evidence.some((entry) =>
    entry.includes('vector-index'),
  );
  const usesUnscopedSingleVector = observation.evidence.some((entry) =>
    entry.includes('single-ability-state-vector'),
  );

  if (usesUnscopedSingleVector) {
    return false;
  }
  if (usesVectorIndex) {
    return payload.eventKey === 'getInfo' && Boolean(context.localSteamId);
  }
  return true;
}

export function reconcileAutomaticSkillObservations(
  payloads: readonly BufferedPayload[],
  context: RuntimeContext,
): ReconciledObservation | undefined {
  let latestComplete:
    | { observation: AutomaticSkillTelemetryResult; receivedAt: number }
    | undefined;
  const partialLevels = createEmptySkillLevels();
  const partialSlots = new Set<SkillSlot>();
  const evidence = new Set<string>();
  let bestConfidence: AutomaticSkillTelemetryConfidence = 'LOW';
  let found = false;

  for (const payload of payloads) {
    const observation = extractAutomaticSkillTelemetry(payload.value, {
      abilityIdsBySlot: context.build.abilityIdsBySlot,
      localSteamId: context.localSteamId,
      eventKey: payload.eventKey,
    });
    if (!observation || !isSafeAutomaticSkillObservation(observation, payload, context)) {
      continue;
    }

    found = true;
    if (confidenceRank(observation.confidence) > confidenceRank(bestConfidence)) {
      bestConfidence = observation.confidence;
    }
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
      partialLevels[skillSlot] = Math.max(
        partialLevels[skillSlot],
        observation.levels[skillSlot],
      ) as SkillLevel;
      partialSlots.add(skillSlot);
    }
  }

  if (!found) {
    return undefined;
  }

  if (latestComplete) {
    const levels = { ...latestComplete.observation.levels };
    for (const skillSlot of partialSlots) {
      levels[skillSlot] = Math.max(
        levels[skillSlot],
        partialLevels[skillSlot],
      ) as SkillLevel;
    }
    return {
      levels,
      observedSlots: [...SKILL_SLOTS],
      complete: true,
      confidence: latestComplete.observation.confidence,
      evidence: [...evidence],
    };
  }

  return {
    levels: partialLevels,
    observedSlots: [...partialSlots].sort((left, right) => left - right),
    complete: partialSlots.size === SKILL_SLOTS.length,
    confidence: bestConfidence,
    evidence: [...evidence],
  };
}

function confidenceRank(value: AutomaticSkillTelemetryConfidence): number {
  if (value === 'HIGH') {
    return 3;
  }
  if (value === 'MEDIUM') {
    return 2;
  }
  return 1;
}

function mergePartialLevels(
  baseline: SkillLevels,
  observed: SkillLevels,
  observedSlots: ReadonlySet<SkillSlot>,
): SkillLevels {
  const result = { ...baseline };
  for (const skillSlot of observedSlots) {
    result[skillSlot] = Math.max(
      baseline[skillSlot],
      observed[skillSlot],
    ) as SkillLevel;
  }
  return result;
}

function maxSkillLevels(left: SkillLevels, right: SkillLevels): SkillLevels {
  return {
    1: Math.max(left[1], right[1]) as SkillLevel,
    2: Math.max(left[2], right[2]) as SkillLevel,
    3: Math.max(left[3], right[3]) as SkillLevel,
    4: Math.max(left[4], right[4]) as SkillLevel,
  };
}

function hasAnyHigherLevel(left: SkillLevels, right: SkillLevels): boolean {
  return SKILL_SLOTS.some((skillSlot) => left[skillSlot] > right[skillSlot]);
}

function getStatusKey(status: AutomaticSkillTrackingStatus): string {
  return [
    status.state,
    status.matchId,
    status.heroId ?? '',
    createSkillLevelsKey(status.levels),
    status.confidence ?? '',
    status.evidence.join(','),
  ].join('|');
}

function normalizeSteamId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return normalized;
  }
}
