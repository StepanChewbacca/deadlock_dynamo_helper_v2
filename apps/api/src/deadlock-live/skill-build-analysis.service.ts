import { Injectable, NotFoundException } from '@nestjs/common';
import {
  findMostPopularSkillBuildPath,
  SkillBuildDiagnostic,
  SkillBuildGraphAccumulator,
  SkillBuildPathStep,
  SkillSlot,
} from '@deadlock-live-probe/build-domain';
import { HERO_ABILITY_MAP } from './hero-abilities';
import { canonicalHeroId, heroIdAliases } from './hero-id-aliases';
import {
  RECENT_MATCH_WINDOW_DAYS,
  RecentMatchesWindowService,
} from './recent-matches-window.service';

export const SKILL_BUILD_MAX_POINT_BUDGET = 36;

export interface HeroSkillBuildDiagnosticSummary {
  code: SkillBuildDiagnostic['code'];
  count: number;
}

export interface HeroSkillBuildResponse {
  heroId: number;
  requestedHeroId: number;
  windowDays: number;
  sourcePlayerCount: number;
  validPlayerCount: number;
  partialPlayerCount: number;
  rejectedPlayerCount: number;
  diagnostics: HeroSkillBuildDiagnosticSummary[];
  totalPointCost: number;
  actions: SkillBuildPathStep[];
}

@Injectable()
export class SkillBuildAnalysisService {
  constructor(private readonly recentMatchesWindowService: RecentMatchesWindowService) {}

  getHeroSkillBuild(heroId: number, maxPointBudget = SKILL_BUILD_MAX_POINT_BUDGET): HeroSkillBuildResponse {
    const canonicalId = canonicalHeroId(heroId);
    const aliases = heroIdAliases(canonicalId);
    const players = this.recentMatchesWindowService.getPlayersByHeroIds([...aliases]);

    if (players.length === 0) {
      throw new NotFoundException(
        `No recent match data exists for hero ${heroId} in the last ${RECENT_MATCH_WINDOW_DAYS} days.`,
      );
    }

    const accumulator = new SkillBuildGraphAccumulator();
    const diagnosticCounts = new Map<SkillBuildDiagnostic['code'], number>();
    let validPlayerCount = 0;
    let partialPlayerCount = 0;
    let rejectedPlayerCount = 0;

    for (const player of players) {
      if (player.skillUpgrades.length === 0) {
        rejectedPlayerCount += 1;
        continue;
      }

      const abilityMap = HERO_ABILITY_MAP[player.heroId];
      if (!abilityMap) {
        rejectedPlayerCount += 1;
        diagnosticCounts.set(
          'UNKNOWN_ABILITY',
          (diagnosticCounts.get('UNKNOWN_ABILITY') ?? 0) + 1,
        );
        continue;
      }

      const replay = accumulator.addPath(
        player.skillUpgrades,
        abilityMap as Readonly<Record<number, SkillSlot>>,
      );

      for (const diagnostic of replay.diagnostics) {
        diagnosticCounts.set(
          diagnostic.code,
          (diagnosticCounts.get(diagnostic.code) ?? 0) + 1,
        );
      }

      if (replay.valid) {
        validPlayerCount += 1;
      } else if (replay.actions.length > 0) {
        partialPlayerCount += 1;
      } else {
        rejectedPlayerCount += 1;
      }
    }

    const graph = accumulator.build();
    const actions = findMostPopularSkillBuildPath(graph, { maxPointBudget });

    if (actions.length === 0) {
      throw new NotFoundException(
        `No valid skill upgrade path exists for hero ${heroId} in the last ${RECENT_MATCH_WINDOW_DAYS} days.`,
      );
    }

    return {
      heroId: canonicalId,
      requestedHeroId: heroId,
      windowDays: RECENT_MATCH_WINDOW_DAYS,
      sourcePlayerCount: players.length,
      validPlayerCount,
      partialPlayerCount,
      rejectedPlayerCount,
      diagnostics: [...diagnosticCounts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
      totalPointCost: actions.at(-1)?.cumulativePointCost ?? 0,
      actions,
    };
  }
}
