import {
  applySkillBuildAction,
  createEmptySkillLevels,
  incrementSkillLevel,
  SkillBuildPathStep,
  SkillLevel,
  SkillLevels,
  SkillSlot,
} from './skill-build-client';

export interface SkillBuildProgress {
  matchId: string;
  heroId: number;
  levels: SkillLevels;
  manualHistory: SkillSlot[];
}

export interface AbilityItemCounts {
  1: number;
  2: number;
  3: number;
  4: number;
}

export interface SkillBuildObservationBaseline {
  levels: SkillLevels;
  abilityItemCounts: AbilityItemCounts;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = 'deadlock-live-skill-progress';
const SKILL_SLOTS = [1, 2, 3, 4] as const;

export function createSkillBuildProgress(
  matchId: string,
  heroId: number,
): SkillBuildProgress {
  return {
    matchId,
    heroId,
    levels: createEmptySkillLevels(),
    manualHistory: [],
  };
}

export function loadSkillBuildProgress(
  storage: StorageLike,
  matchId: string,
  heroId: number,
): SkillBuildProgress {
  const fallback = createSkillBuildProgress(matchId, heroId);
  const raw = storage.getItem(createStorageKey(matchId, heroId));
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isSkillBuildProgress(parsed, matchId, heroId) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveSkillBuildProgress(
  storage: StorageLike,
  progress: SkillBuildProgress,
): void {
  storage.setItem(createStorageKey(progress.matchId, progress.heroId), JSON.stringify(progress));
}

export function clearSkillBuildProgress(
  storage: StorageLike,
  matchId: string,
  heroId: number,
): SkillBuildProgress {
  storage.removeItem(createStorageKey(matchId, heroId));
  return createSkillBuildProgress(matchId, heroId);
}

export function confirmRecommendedSkillAction(
  progress: SkillBuildProgress,
  action: SkillBuildPathStep,
): SkillBuildProgress {
  return {
    ...progress,
    levels: applySkillBuildAction(progress.levels, action),
    manualHistory: [...progress.manualHistory, action.skillSlot],
  };
}

export function recordActualSkillUpgrade(
  progress: SkillBuildProgress,
  skillSlot: SkillSlot,
): SkillBuildProgress {
  const levels = incrementSkillLevel(progress.levels, skillSlot);
  if (levels[skillSlot] === progress.levels[skillSlot]) {
    return progress;
  }

  return {
    ...progress,
    levels,
    manualHistory: [...progress.manualHistory, skillSlot],
  };
}

export function undoLastManualSkillUpgrade(
  progress: SkillBuildProgress,
): SkillBuildProgress {
  const skillSlot = progress.manualHistory[progress.manualHistory.length - 1];
  if (!skillSlot) {
    return progress;
  }

  const currentLevel = progress.levels[skillSlot];
  return {
    ...progress,
    levels: {
      ...progress.levels,
      [skillSlot]: Math.max(0, currentLevel - 1) as SkillLevel,
    },
    manualHistory: progress.manualHistory.slice(0, -1),
  };
}

export function getAbilityItemCounts(
  itemIds: readonly number[],
  abilityIdsBySlot: Readonly<Record<SkillSlot, number>>,
): AbilityItemCounts {
  const result: AbilityItemCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const slotByAbilityId = new Map<number, SkillSlot>(
    SKILL_SLOTS.map((skillSlot) => [abilityIdsBySlot[skillSlot], skillSlot]),
  );

  for (const itemId of itemIds) {
    const skillSlot = slotByAbilityId.get(itemId);
    if (skillSlot) {
      result[skillSlot] += 1;
    }
  }

  return result;
}

export function createSkillBuildObservationBaseline(
  progress: SkillBuildProgress,
  abilityItemCounts: AbilityItemCounts,
): SkillBuildObservationBaseline {
  return {
    levels: { ...progress.levels },
    abilityItemCounts: { ...abilityItemCounts },
  };
}

export function reconcileSkillProgressFromAbilityCounts(
  progress: SkillBuildProgress,
  baseline: SkillBuildObservationBaseline,
  currentCounts: AbilityItemCounts,
): SkillBuildProgress {
  let changed = false;
  const levels = { ...progress.levels };

  for (const skillSlot of SKILL_SLOTS) {
    const detectedIncrease = Math.max(
      0,
      currentCounts[skillSlot] - baseline.abilityItemCounts[skillSlot],
    );
    const detectedLevel = Math.min(
      4,
      baseline.levels[skillSlot] + detectedIncrease,
    ) as SkillLevel;
    if (detectedLevel > levels[skillSlot]) {
      levels[skillSlot] = detectedLevel;
      changed = true;
    }
  }

  return changed ? { ...progress, levels } : progress;
}

function createStorageKey(matchId: string, heroId: number): string {
  return `${STORAGE_PREFIX}:${matchId}:${heroId}`;
}

function isSkillBuildProgress(
  value: unknown,
  matchId: string,
  heroId: number,
): value is SkillBuildProgress {
  if (!isRecord(value) || value.matchId !== matchId || value.heroId !== heroId) {
    return false;
  }
  if (!isRecord(value.levels) || !Array.isArray(value.manualHistory)) {
    return false;
  }

  return SKILL_SLOTS.every((skillSlot) => isSkillLevel(value.levels[skillSlot])) &&
    value.manualHistory.every(isSkillSlot);
}

function isSkillSlot(value: unknown): value is SkillSlot {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isSkillLevel(value: unknown): value is SkillLevel {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4;
}

function isRecord(value: unknown): value is Record<string | number, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
