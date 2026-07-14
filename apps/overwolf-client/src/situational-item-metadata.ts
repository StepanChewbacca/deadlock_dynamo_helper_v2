import {
  LiveBuildRecommendationAction,
  LiveBuildRecommendationSnapshot,
} from './live-build-recommendation-poller';

export interface SituationalItemWarning {
  key: string;
  matchId: string;
  actionKey: string;
  itemName: string;
  enemyHeroId: number;
  enemyHeroName: string;
  wasInsertedByMatchup: boolean;
  lower95OddsRatio?: number;
  matchupObservationCount?: number;
}

export type HeroNameMap = Record<string | number, string>;

export function createSituationalItemWarning(
  snapshot: LiveBuildRecommendationSnapshot,
  heroNames: HeroNameMap = {},
): SituationalItemWarning | undefined {
  const action = snapshot.recommendation?.action;
  const enemyHeroId = Number(action?.situationalAgainstHeroId);
  if (
    snapshot.state !== 'READY' ||
    !action?.wasPromotedByMatchup ||
    !action.isSituational ||
    !action.item ||
    !Number.isSafeInteger(enemyHeroId) ||
    enemyHeroId <= 0
  ) {
    return undefined;
  }

  return {
    key: [snapshot.matchId, action.actionKey, enemyHeroId].join(':'),
    matchId: snapshot.matchId,
    actionKey: action.actionKey,
    itemName: action.item.name,
    enemyHeroId,
    enemyHeroName: resolveHeroName(enemyHeroId, heroNames),
    wasInsertedByMatchup: Boolean(action.wasInsertedByMatchup),
    lower95OddsRatio: finitePositive(action.situationalLower95OddsRatio),
    matchupObservationCount: safeNonNegativeInteger(
      action.matchupObservationCount,
    ),
  };
}

export function createSituationalBadgeText(
  action: LiveBuildRecommendationAction,
  heroNames: HeroNameMap = {},
): string | undefined {
  const enemyHeroId = Number(action.situationalAgainstHeroId);
  if (
    !action.isSituational ||
    !Number.isSafeInteger(enemyHeroId) ||
    enemyHeroId <= 0
  ) {
    return undefined;
  }

  return `Situational vs ${resolveHeroName(enemyHeroId, heroNames)}`;
}

export function createSituationalEvidenceText(
  action: LiveBuildRecommendationAction,
): string | undefined {
  if (!action.isSituational) {
    return undefined;
  }

  const parts: string[] = [];
  const lowerBound = finitePositive(action.situationalLower95OddsRatio);
  if (lowerBound !== undefined) {
    parts.push(`95% lower OR x${lowerBound.toFixed(2)}`);
  }

  const observationCount = safeNonNegativeInteger(
    action.matchupObservationCount,
  );
  if (observationCount !== undefined) {
    parts.push(`n=${observationCount}`);
  }

  if (action.wasInsertedByMatchup) {
    parts.push('inserted into build');
  } else if (action.wasPromotedByMatchup) {
    parts.push('promoted in build');
  }

  return parts.join(' | ') || undefined;
}

export function resolveHeroName(
  heroId: number,
  heroNames: HeroNameMap = {},
): string {
  const rawName = heroNames[heroId] ?? heroNames[String(heroId)];
  const normalized = normalizeHeroName(rawName);
  return normalized || `Hero ${heroId}`;
}

function normalizeHeroName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value
    .trim()
    .replace(/^hero_/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ');

  return normalized.replace(/\b\p{L}/gu, (character) => character.toUpperCase());
}

function finitePositive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}
