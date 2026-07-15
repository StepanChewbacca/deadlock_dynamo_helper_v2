import {
  createEmptySkillLevels,
  createSkillLevelsKey,
  HeroSkillBuildResponse,
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

    this.resetForContextChange(context);

    let bestObservation: AutomaticSkillTelemetryResult | undefined;
    for (const payload of this.payloads) {
      const observation = extractAutomaticSkillTelemetry(payload.value, {
        abilityIdsBySlot: context.build.abilityIdsBySlot,
        localSteamId: context.localSteamId,
        eventKey: payload.eventKey,
      });
      if (!observation || !isBetterObservation(observation, bestObservation)) {
        continue;
      }
      bestObservation = observation;
    }

    if (!bestObservation) {
      this.publishStatus('WAITING_FOR_TELEMETRY', context);
      return;
    }

    this.applyObservation(bestObservation);
    this.applyLevelsToExistingSkillRuntime(context);
    this.publishStatus('SYNCED', context, bestObservation);
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

  private resetForContextChange(context: RuntimeContext): void {
    if (
      context.matchId === this.lastMatchId &&
      context.heroId === this.lastHeroId
    ) {
      return;
    }

    this.lastMatchId = context.matchId;
    this.lastHeroId = context.heroId;
    this.observedLevels = createEmptySkillLevels();
    this.observedSlots.clear();
    this.exactObservation = false;
    this.lastAppliedLevels = { ...context.build.currentLevels };

    const cutoff = Date.now() - 10_000;
    const recentPayloads = this.payloads.filter(
      (payload) => payload.receivedAt >= cutoff,
    );
    this.payloads.splice(0, this.payloads.length, ...recentPayloads);
  }

  private applyObservation(observation: AutomaticSkillTelemetryResult): void {
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
      ) as SkillLevels[SkillSlot];
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
    observation?: AutomaticSkillTelemetryResult,
  ): void {
    const status: AutomaticSkillTrackingStatus = {
      state,
      matchId: context?.matchId ?? this.lastMatchId,
      heroId: context?.heroId ?? this.lastHeroId,
      levels: { ...this.observedLevels },
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

function isBetterObservation(
  candidate: AutomaticSkillTelemetryResult,
  current: AutomaticSkillTelemetryResult | undefined,
): boolean {
  if (!current) {
    return true;
  }

  const confidenceDifference =
    confidenceRank(candidate.confidence) - confidenceRank(current.confidence);
  if (confidenceDifference !== 0) {
    return confidenceDifference > 0;
  }
  if (candidate.complete !== current.complete) {
    return candidate.complete;
  }
  if (candidate.observedSlots.length !== current.observedSlots.length) {
    return candidate.observedSlots.length > current.observedSlots.length;
  }
  return getTotalLevel(candidate.levels) > getTotalLevel(current.levels);
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
    ) as SkillLevels[SkillSlot];
  }
  return result;
}

function maxSkillLevels(left: SkillLevels, right: SkillLevels): SkillLevels {
  return {
    1: Math.max(left[1], right[1]) as SkillLevels[1],
    2: Math.max(left[2], right[2]) as SkillLevels[2],
    3: Math.max(left[3], right[3]) as SkillLevels[3],
    4: Math.max(left[4], right[4]) as SkillLevels[4],
  };
}

function hasAnyHigherLevel(left: SkillLevels, right: SkillLevels): boolean {
  return SKILL_SLOTS.some((skillSlot) => left[skillSlot] > right[skillSlot]);
}

function getTotalLevel(levels: SkillLevels): number {
  return SKILL_SLOTS.reduce((total, skillSlot) => total + levels[skillSlot], 0);
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
