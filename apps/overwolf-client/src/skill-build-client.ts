export type SkillBuildActionType = 'UNLOCK' | 'UPGRADE';
export type SkillSlot = 1 | 2 | 3 | 4;
export type SkillLevel = 0 | 1 | 2 | 3 | 4;

export interface SkillLevels {
  1: SkillLevel;
  2: SkillLevel;
  3: SkillLevel;
  4: SkillLevel;
}

export interface SkillBuildPathStep {
  abilityId: number;
  skillSlot: SkillSlot;
  type: SkillBuildActionType;
  fromLevel: SkillLevel;
  toLevel: Exclude<SkillLevel, 0>;
  upgradeTier: 0 | 1 | 2 | 3;
  pointCost: number;
  actionIndex: number;
  cumulativePointCost: number;
  sampleSize: number;
  pickRate: number;
  averageUpgradeTimeS?: number;
}

export interface HeroSkillBuildResponse {
  heroId: number;
  windowDays: number;
  sourcePlayerCount: number;
  validPlayerCount: number;
  partialPlayerCount: number;
  rejectedPlayerCount: number;
  diagnostics: Array<{ code: string; count: number }>;
  abilityIdsBySlot: Record<SkillSlot, number>;
  currentLevels: SkillLevels;
  currentPointCost: number;
  totalPointCost: number;
  nextAction?: SkillBuildPathStep;
  actions: SkillBuildPathStep[];
}

export type SkillBuildPresentation =
  | { state: 'EMPTY' }
  | { state: 'LOADING'; heroId: number; levels: SkillLevels }
  | { state: 'READY'; build: HeroSkillBuildResponse }
  | { state: 'ERROR'; heroId: number; levels: SkillLevels; message: string };

export function createEmptySkillLevels(): SkillLevels {
  return { 1: 0, 2: 0, 3: 0, 4: 0 };
}

export function createSkillLevelsKey(levels: SkillLevels): string {
  return `${levels[1]}:${levels[2]}:${levels[3]}:${levels[4]}`;
}

export function applySkillBuildAction(
  levels: SkillLevels,
  action: SkillBuildPathStep,
): SkillLevels {
  if (levels[action.skillSlot] !== action.fromLevel) {
    throw new Error(
      `Skill ${action.skillSlot} expected level ${action.fromLevel}, got ${levels[action.skillSlot]}.`,
    );
  }

  return {
    ...levels,
    [action.skillSlot]: action.toLevel,
  };
}

export function incrementSkillLevel(levels: SkillLevels, skillSlot: SkillSlot): SkillLevels {
  const currentLevel = levels[skillSlot];
  if (currentLevel >= 4) {
    return { ...levels };
  }

  return {
    ...levels,
    [skillSlot]: (currentLevel + 1) as SkillLevel,
  };
}

export async function fetchHeroSkillBuild(
  apiBaseUrl: string,
  heroId: number,
  levels: SkillLevels = createEmptySkillLevels(),
  fetchImpl: typeof fetch = window.fetch.bind(window),
): Promise<HeroSkillBuildResponse> {
  if (!Number.isSafeInteger(heroId) || heroId <= 0) {
    throw new Error('Hero ID must be a positive safe integer.');
  }

  const baseUrl = apiBaseUrl.replace(/\/$/, '');
  const query = new URLSearchParams({
    levels: [levels[1], levels[2], levels[3], levels[4]].join(','),
  });
  const response = await fetchImpl(
    `${baseUrl}/deadlock/analysis/heroes/${encodeURIComponent(String(heroId))}/skill-build?${query}`,
    { method: 'GET', cache: 'no-store' },
  );

  if (!response.ok) {
    throw new Error(`Skill build request failed with HTTP ${response.status}.`);
  }

  const parsed = await response.json() as unknown;
  if (!isHeroSkillBuildResponse(parsed)) {
    throw new Error('Skill build response has an invalid shape.');
  }

  return parsed;
}

export function isHeroSkillBuildResponse(value: unknown): value is HeroSkillBuildResponse {
  if (!isRecord(value) || !Array.isArray(value.actions)) {
    return false;
  }

  return (
    isPositiveInteger(value.heroId) &&
    isPositiveInteger(value.windowDays) &&
    isNonNegativeInteger(value.sourcePlayerCount) &&
    isNonNegativeInteger(value.validPlayerCount) &&
    isNonNegativeInteger(value.partialPlayerCount) &&
    isNonNegativeInteger(value.rejectedPlayerCount) &&
    isAbilityIdsBySlot(value.abilityIdsBySlot) &&
    isSkillLevels(value.currentLevels) &&
    isNonNegativeInteger(value.currentPointCost) &&
    isNonNegativeInteger(value.totalPointCost) &&
    (value.nextAction === undefined || isSkillBuildPathStep(value.nextAction)) &&
    value.actions.every(isSkillBuildPathStep)
  );
}

export function isSkillLevels(value: unknown): value is SkillLevels {
  if (!isRecord(value)) {
    return false;
  }
  return [1, 2, 3, 4].every((slot) => isSkillLevel(value[slot]));
}

function isAbilityIdsBySlot(value: unknown): value is Record<SkillSlot, number> {
  if (!isRecord(value)) {
    return false;
  }
  return [1, 2, 3, 4].every((slot) => isPositiveInteger(value[slot]));
}

function isSkillBuildPathStep(value: unknown): value is SkillBuildPathStep {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveInteger(value.abilityId) &&
    isSkillSlot(value.skillSlot) &&
    (value.type === 'UNLOCK' || value.type === 'UPGRADE') &&
    isSkillLevel(value.fromLevel) &&
    isPositiveInteger(value.toLevel) &&
    value.toLevel <= 4 &&
    isNonNegativeInteger(value.upgradeTier) &&
    value.upgradeTier <= 3 &&
    isPositiveInteger(value.pointCost) &&
    isPositiveInteger(value.actionIndex) &&
    isPositiveInteger(value.cumulativePointCost) &&
    isNonNegativeInteger(value.sampleSize) &&
    typeof value.pickRate === 'number' &&
    Number.isFinite(value.pickRate)
  );
}

function isSkillSlot(value: unknown): value is SkillSlot {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isSkillLevel(value: unknown): value is SkillLevel {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string | number, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
