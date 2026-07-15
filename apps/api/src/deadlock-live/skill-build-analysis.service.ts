import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createInitialSkillBuildState,
  createSkillBuildStateKey,
  findBestSkillBuildPath,
  getSkillBuildSpentPoints,
  SkillBuildDiagnostic,
  SkillBuildGraph,
  SkillBuildGraphAccumulator,
  SkillBuildPathStep,
  SkillBuildState,
  SkillLevel,
  SkillSlot,
  SkillUpgradeObservation,
} from '@deadlock-live-probe/build-domain';
import { HERO_ABILITY_MAP } from './hero-abilities';
import {
  RECENT_MATCH_WINDOW_DAYS,
  RecentMatchSkillSnapshot,
  RecentMatchesWindowService,
} from './recent-matches-window.service';

export const SKILL_BUILD_MAX_POINT_BUDGET = 36;

export type HeroSkillLevels = Readonly<Record<SkillSlot, SkillLevel>>;

export interface HeroSkillBuildOptions {
  maxPointBudget?: number;
  currentLevels?: HeroSkillLevels;
}

export interface HeroSkillBuildDiagnosticSummary {
  code: SkillBuildDiagnostic['code'];
  count: number;
}

export interface HeroSkillBuildResponse {
  heroId: number;
  windowDays: number;
  sourcePlayerCount: number;
  validPlayerCount: number;
  partialPlayerCount: number;
  rejectedPlayerCount: number;
  diagnostics: HeroSkillBuildDiagnosticSummary[];
  abilityIdsBySlot: Readonly<Record<SkillSlot, number>>;
  currentLevels: HeroSkillLevels;
  currentPointCost: number;
  totalPointCost: number;
  nextAction?: SkillBuildPathStep;
  actions: SkillBuildPathStep[];
}

interface CachedHeroSkillGraph {
  windowVersion: string;
  graph: SkillBuildGraph;
  abilityIdsBySlot: Readonly<Record<SkillSlot, number>>;
  sourcePlayerCount: number;
  validPlayerCount: number;
  partialPlayerCount: number;
  rejectedPlayerCount: number;
  diagnostics: HeroSkillBuildDiagnosticSummary[];
}

@Injectable()
export class SkillBuildAnalysisService {
  private readonly cacheByHeroId = new Map<number, CachedHeroSkillGraph>();

  constructor(private readonly recentMatchesWindowService: RecentMatchesWindowService) {}

  async getHeroSkillBuild(
    heroId: number,
    options: HeroSkillBuildOptions = {},
  ): Promise<HeroSkillBuildResponse> {
    const abilitySlotById = HERO_ABILITY_MAP[heroId] as
      | Readonly<Record<number, SkillSlot>>
      | undefined;
    if (!abilitySlotById) {
      throw new NotFoundException(`No ability mapping exists for hero ${heroId}.`);
    }

    await this.ensureRecentMatchesLoaded();

    const cached = this.getOrBuildCachedGraph(heroId, abilitySlotById);
    const currentState = createCurrentState(options.currentLevels);
    const currentPointCost = getSkillBuildSpentPoints(currentState);
    const maxPointBudget = options.maxPointBudget ?? SKILL_BUILD_MAX_POINT_BUDGET;
    const remainingPointBudget = Math.max(0, maxPointBudget - currentPointCost);
    const actions = findBestSkillBuildPath(cached.graph, {
      startStateKey: createSkillBuildStateKey(currentState),
      maxPointBudget: remainingPointBudget,
      initialPointCost: currentPointCost,
    });

    if (
      actions.length === 0 &&
      remainingPointBudget > 0 &&
      !isCompleteSkillState(currentState)
    ) {
      throw new NotFoundException(
        `No valid skill upgrade path exists for hero ${heroId} from state ` +
          `${createSkillBuildStateKey(currentState)}.`,
      );
    }

    return {
      heroId,
      windowDays: RECENT_MATCH_WINDOW_DAYS,
      sourcePlayerCount: cached.sourcePlayerCount,
      validPlayerCount: cached.validPlayerCount,
      partialPlayerCount: cached.partialPlayerCount,
      rejectedPlayerCount: cached.rejectedPlayerCount,
      diagnostics: cached.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      abilityIdsBySlot: { ...cached.abilityIdsBySlot },
      currentLevels: { ...currentState.levels },
      currentPointCost,
      totalPointCost: actions[actions.length - 1]?.cumulativePointCost ?? currentPointCost,
      nextAction: actions[0] ? { ...actions[0] } : undefined,
      actions,
    };
  }

  private getOrBuildCachedGraph(
    heroId: number,
    abilitySlotById: Readonly<Record<number, SkillSlot>>,
  ): CachedHeroSkillGraph {
    const windowVersion = this.getWindowVersion();
    const cached = this.cacheByHeroId.get(heroId);
    if (cached?.windowVersion === windowVersion) {
      return cached;
    }

    const abilityIdsBySlot = createAbilityIdByStoredSlot(abilitySlotById);
    const players = this.recentMatchesWindowService.getPlayersByHeroIds([heroId]);
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

      const replay = accumulator.addPath(
        player.skillUpgrades.map((upgrade) =>
          normalizePersistedSkillUpgrade(upgrade, abilityIdsBySlot),
        ),
        abilitySlotById,
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
    if (graph.statesByKey.get(graph.rootStateKey)?.outgoingTransitions.length === 0) {
      throw new NotFoundException(
        `No valid skill upgrade path exists for hero ${heroId} in the last ${RECENT_MATCH_WINDOW_DAYS} days.`,
      );
    }

    const nextCache: CachedHeroSkillGraph = {
      windowVersion,
      graph,
      abilityIdsBySlot,
      sourcePlayerCount: players.length,
      validPlayerCount,
      partialPlayerCount,
      rejectedPlayerCount,
      diagnostics: [...diagnosticCounts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
    };
    this.cacheByHeroId.set(heroId, nextCache);
    return nextCache;
  }

  private async ensureRecentMatchesLoaded(): Promise<void> {
    if (this.recentMatchesWindowService.getStatus().lastRefreshedAt) {
      return;
    }

    await this.recentMatchesWindowService.refresh();
  }

  private getWindowVersion(): string {
    return this.recentMatchesWindowService.getStatus().lastRefreshedAt?.toISOString() ?? 'empty';
  }
}

function createAbilityIdByStoredSlot(
  abilitySlotById: Readonly<Record<number, SkillSlot>>,
): Readonly<Record<SkillSlot, number>> {
  return Object.fromEntries(
    Object.entries(abilitySlotById).map(([abilityId, skillSlot]) => [
      skillSlot,
      Number(abilityId),
    ]),
  ) as Readonly<Record<SkillSlot, number>>;
}

function createCurrentState(currentLevels?: HeroSkillLevels): SkillBuildState {
  if (!currentLevels) {
    return createInitialSkillBuildState();
  }

  return {
    levels: {
      1: currentLevels[1],
      2: currentLevels[2],
      3: currentLevels[3],
      4: currentLevels[4],
    },
  };
}

function isCompleteSkillState(state: SkillBuildState): boolean {
  return state.levels[1] === 4 &&
    state.levels[2] === 4 &&
    state.levels[3] === 4 &&
    state.levels[4] === 4;
}

function normalizePersistedSkillUpgrade(
  upgrade: RecentMatchSkillSnapshot,
  abilityIdByStoredSlot: Readonly<Record<SkillSlot, number>>,
): SkillUpgradeObservation {
  return {
    abilityId: abilityIdByStoredSlot[upgrade.abilityId as SkillSlot] ?? upgrade.abilityId,
    upgradeOrder: upgrade.upgradeOrder,
    upgradeTimeS: upgrade.upgradeTimeS,
  };
}
