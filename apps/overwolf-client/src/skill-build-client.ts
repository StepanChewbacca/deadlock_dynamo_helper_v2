export type SkillBuildActionType = 'UNLOCK' | 'UPGRADE';

export interface SkillBuildPathStep {
  abilityId: number;
  skillSlot: 1 | 2 | 3 | 4;
  type: SkillBuildActionType;
  fromLevel: 0 | 1 | 2 | 3 | 4;
  toLevel: 1 | 2 | 3 | 4;
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
  totalPointCost: number;
  actions: SkillBuildPathStep[];
}

export type SkillBuildPresentation =
  | { state: 'EMPTY' }
  | { state: 'LOADING'; heroId: number }
  | { state: 'READY'; build: HeroSkillBuildResponse }
  | { state: 'ERROR'; heroId: number; message: string };

export async function fetchHeroSkillBuild(
  apiBaseUrl: string,
  heroId: number,
  fetchImpl: typeof fetch = window.fetch.bind(window),
): Promise<HeroSkillBuildResponse> {
  if (!Number.isSafeInteger(heroId) || heroId <= 0) {
    throw new Error('Hero ID must be a positive safe integer.');
  }

  const baseUrl = apiBaseUrl.replace(/\/$/, '');
  const response = await fetchImpl(
    `${baseUrl}/deadlock/analysis/heroes/${encodeURIComponent(String(heroId))}/skill-build`,
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
    isNonNegativeInteger(value.totalPointCost) &&
    value.actions.every(isSkillBuildPathStep)
  );
}

function isSkillBuildPathStep(value: unknown): value is SkillBuildPathStep {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isPositiveInteger(value.abilityId) &&
    isSkillSlot(value.skillSlot) &&
    (value.type === 'UNLOCK' || value.type === 'UPGRADE') &&
    isNonNegativeInteger(value.fromLevel) &&
    isPositiveInteger(value.toLevel) &&
    isNonNegativeInteger(value.upgradeTier) &&
    isPositiveInteger(value.pointCost) &&
    isPositiveInteger(value.actionIndex) &&
    isPositiveInteger(value.cumulativePointCost) &&
    isNonNegativeInteger(value.sampleSize) &&
    typeof value.pickRate === 'number' &&
    Number.isFinite(value.pickRate)
  );
}

function isSkillSlot(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
