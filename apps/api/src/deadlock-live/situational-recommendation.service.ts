import { Injectable } from '@nestjs/common';
import { MinimalItemState, MinimalMatchSnapshot, MinimalMatchState, MinimalPlayerState } from '@deadlock-live-probe/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Item } from './entities/item.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { ShadowModeDecision } from './entities/shadow-mode-decision.entity';
import { ItemComponent } from './entities/item-component.entity';
import { LiveMatchStateService } from './live-match-state.service';
import { AllHeroesAnalysisService, heroIdAliases } from './all-heroes-analysis.service';

type SituationalDecision =
  | 'CONTINUE_CORE'
  | 'BUY_SITUATIONAL_ITEM'
  | 'DELAY_CURRENT_CORE_ITEM'
  | 'SWITCH_ARCHETYPE'
  | 'ABSTAIN';

type RecommendationLifecycleState = 'CANDIDATE' | 'ACTIVE' | 'ACKNOWLEDGED' | 'PURCHASED' | 'EXPIRED' | 'CANCELLED';

type BuildType = 'weapon' | 'spirit' | 'vitality';

type ItemScope =
  | 'SELF_SURVIVAL'
  | 'SELF_DAMAGE'
  | 'TARGETED_DISABLE'
  | 'TEAM_UTILITY'
  | 'AURA'
  | 'ANTI_HEAL'
  | 'MOBILITY'
  | 'OBJECTIVE';

type ThreatVector = {
  heroId: number;
  heroName: string;
  power: number;
  weaponPressure: number;
  spiritPressure: number;
  burst: number;
  healing: number;
  hardCc: number;
  momentum: number;
  sustainedDamage: number;
  mobility: number;
  tankiness: number;
  objectivePressure: number;
  classification: 'NONE' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  confidence: number;
  evidence: string[];
};

type ThreatClassification = ThreatVector['classification'];

type Candidate = {
  itemId: number;
  name: string;
  cost: number;
  slotType: string;
  scope: ItemScope;
  tags: string[];
  purpose: string;
  score: number;
  confidence: number;
  support: number;
  estimatedUplift: number;
  evidence: string[];
  mainThreat?: ThreatVector;
};

type ActiveRecommendation = {
  id: string;
  matchId: string;
  localPlayerKey: string;
  itemId: number;
  threatHeroId: number | null;
  purpose: string;
  state: RecommendationLifecycleState;
  activatedAt: number;
  lastSeenAt: number;
};

export class SituationalRecommendationDto {
  matchId?: string;
  localSteamId?: string;
}

export interface SituationalRecommendationResponse {
  decision: SituationalDecision;
  recommendedItemId: number | null;
  recommendedItemName: string | null;
  currentBuildArchetype: BuildType | 'unknown';
  nextCoreItem: { id: number; name: string; avgPurchaseTimeS?: number } | null;
  shouldDelayCore: boolean;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  stateRevision: string;
  mainThreatHero: { heroId: number; heroName: string } | null;
  counterPurpose: string | null;
  supportingEvidence: string[];
  historicalSampleSize: number;
  estimatedUplift: number;
  expirationConditions: string[];
  fallbackAction: 'CONTINUE_CORE' | 'ABSTAIN';
  recommendationId: string | null;
  recommendationState: RecommendationLifecycleState;
  cooldownUntil: string | null;
  candidates: Array<{
    itemId: number;
    name: string;
    score: number;
    confidence: number;
    support: number;
    purpose: string;
    evidence: string[];
  }>;
}

type ItemsMap = Record<string, { name: string; className: string; slotType: string; cost: number; tier: number }>;

const POLICY_CONFIG = {
  staleStateMs: 15000,
  minRosterPlayers: 8,
  minCandidateConfidence: 0.55,
  minBuyScore: 0.68,
  minSupportForHighConfidence: 100,
  minSupportForMediumConfidence: 30,
  coreInterruptionWeight: 0.18,
  redundancyPenalty: 0.18,
  ownedPenalty: 0.9,
  historicalUpliftWeight: 0.22,
  urgencyWeight: 0.3,
  vulnerabilityWeight: 0.22,
  teamCoverageWeight: 0.12,
  buildCompatibilityWeight: 0.14,
  hysteresisExitScore: 0.54,
  hysteresisExitConfidence: 0.45,
  recommendationCooldownMs: 120000,
} as const;

const HERO_THREAT_PRIORS: Record<string, { orientation: 'weapon' | 'spirit' | 'mixed'; tags: string[] }> = {
  haze: { orientation: 'weapon', tags: ['burst', 'sustained_damage', 'mobility', 'objective_pressure'] },
  infernus: { orientation: 'mixed', tags: ['sustained_damage', 'anti_heal', 'tankiness'] },
  seven: { orientation: 'spirit', tags: ['area_damage', 'burst', 'objective_pressure'] },
  bebop: { orientation: 'spirit', tags: ['hard_cc', 'burst', 'mobility'] },
  vindicta: { orientation: 'weapon', tags: ['long_range', 'burst', 'mobility'] },
  wraith: { orientation: 'weapon', tags: ['burst', 'hard_cc', 'mobility'] },
  abrams: { orientation: 'weapon', tags: ['dive', 'hard_cc', 'tankiness'] },
  kelvin: { orientation: 'spirit', tags: ['sustain', 'area_denial', 'tankiness'] },
  viscous: { orientation: 'spirit', tags: ['sustain', 'escape', 'tankiness'] },
};

@Injectable()
export class SituationalRecommendationService {
  private readonly activeRecommendations = new Map<string, ActiveRecommendation>();
  private readonly cooldowns = new Map<string, number>();
  private readonly matchArchetypes = new Map<string, { current: BuildType | 'unknown'; probability: Record<BuildType, number> }>();
  private readonly benchmarkCache = new Map<number, { netWorthPerSec: number; killsPerSec: number }>();

  constructor(
    private readonly liveMatchStateService: LiveMatchStateService,
    private readonly allHeroesAnalysisService: AllHeroesAnalysisService,
    @InjectRepository(Item)
    private readonly itemRepo: Repository<Item>,
    @InjectRepository(MatchPlayer)
    private readonly matchPlayerRepo: Repository<MatchPlayer>,
    @InjectRepository(ShadowModeDecision)
    private readonly shadowModeDecisionRepo: Repository<ShadowModeDecision>,
    @InjectRepository(ItemComponent)
    private readonly itemComponentRepo: Repository<ItemComponent>,
  ) {}

  async recommend(dto: SituationalRecommendationDto): Promise<SituationalRecommendationResponse> {
    const state = this.resolveState(dto.matchId);
    if (!state) {
      return this.abstain('No live match state is available.', 'no-state');
    }

    const readiness = this.validateReadiness(state);
    if (!readiness.ok) {
      return this.abstain(readiness.reason, state.lastUpdatedAt);
    }

    const localPlayer = this.resolveLocalPlayer(state, dto.localSteamId);
    if (!localPlayer || localPlayer.heroId === undefined || localPlayer.teamId === undefined) {
      return this.abstain('Local player could not be resolved from live state.', state.lastUpdatedAt);
    }

    const players = Object.values(state.playersBySteamId);
    const allies = players.filter((p) => p.teamId === localPlayer.teamId && p.steamId !== localPlayer.steamId);
    const enemies = players.filter((p) => p.teamId !== undefined && p.teamId !== localPlayer.teamId);
    if (enemies.length === 0) {
      return this.abstain('Enemy team is not available in live state.', state.lastUpdatedAt);
    }

    const items = await this.loadItemsMap();

    // Archetype Inference & Smoothing
    let archRecord = this.matchArchetypes.get(state.matchId);
    if (!archRecord) {
      const buildsData = await this.allHeroesAnalysisService.getHeroBuilds(localPlayer.heroId);
      const initialProb = { weapon: 0.33, spirit: 0.33, vitality: 0.33 };
      if (buildsData?.builds?.length > 0) {
        let totalWins = 0;
        for (const b of buildsData.builds) {
          const type = b.buildType as BuildType;
          if (type in initialProb) {
            initialProb[type] = b.winRate || 50;
            totalWins += b.winRate || 50;
          }
        }
        if (totalWins > 0) {
          initialProb.weapon /= totalWins;
          initialProb.spirit /= totalWins;
          initialProb.vitality /= totalWins;
        }
      }
      archRecord = { current: 'unknown', probability: initialProb };
      this.matchArchetypes.set(state.matchId, archRecord);
    }

    const liveArchetype = this.inferBuildArchetype(localPlayer.items, items);
    if (liveArchetype !== 'unknown') {
      const alpha = 0.35;
      archRecord.probability.weapon = (1 - alpha) * archRecord.probability.weapon + (liveArchetype === 'weapon' ? alpha : 0);
      archRecord.probability.spirit = (1 - alpha) * archRecord.probability.spirit + (liveArchetype === 'spirit' ? alpha : 0);
      archRecord.probability.vitality = (1 - alpha) * archRecord.probability.vitality + (liveArchetype === 'vitality' ? alpha : 0);

      const probs = Object.entries(archRecord.probability) as [BuildType, number][];
      const [bestType, bestProb] = probs.sort((a, b) => b[1] - a[1])[0];

      if (bestProb > 0.65 && bestType !== archRecord.current) {
        // Evaluate SWITCH_ARCHETYPE (criteria 23.1)
        const currentBaseBuild = await this.resolveBaseBuild(localPlayer.heroId, archRecord.current);
        const currentCoreItems = currentBaseBuild
          ? [
              ...(currentBaseBuild.phases.early || []),
              ...(currentBaseBuild.phases.mid || []),
              ...(currentBaseBuild.phases.late || []),
            ].map((item: any) => item.id)
          : [];
        const ownedCurrentCoreCount = localPlayer.items.filter((item) => currentCoreItems.includes(item.id)).length;

        if (archRecord.current !== 'unknown' && ownedCurrentCoreCount <= 2) {
          archRecord.current = bestType;
          this.matchArchetypes.set(state.matchId, archRecord);

          const switchResponse: SituationalRecommendationResponse = {
            decision: 'SWITCH_ARCHETYPE',
            recommendedItemId: null,
            recommendedItemName: null,
            currentBuildArchetype: bestType,
            nextCoreItem: null,
            shouldDelayCore: false,
            urgency: 'HIGH',
            confidence: this.round(bestProb),
            stateRevision: state.lastUpdatedAt,
            mainThreatHero: null,
            counterPurpose: `pivot build direction to ${bestType}`,
            supportingEvidence: [
              `Archetype probability of ${bestType} cleared the switch threshold.`,
              `Inventory shift detected: weapon=${this.round(archRecord.probability.weapon)} spirit=${this.round(archRecord.probability.spirit)} vitality=${this.round(archRecord.probability.vitality)}`,
              `Owned core items of previous archetype: ${ownedCurrentCoreCount}`,
            ],
            historicalSampleSize: 0,
            estimatedUplift: 0,
            expirationConditions: ['build archetype switches again'],
            fallbackAction: 'CONTINUE_CORE',
            recommendationId: `switch:${state.matchId}:${bestType}`,
            recommendationState: 'ACTIVE',
            cooldownUntil: null,
            candidates: [],
          };

          await this.saveShadowModeDecision({
            matchId: state.matchId,
            gameTimeSec: state.gameTimeSec || 0,
            localHeroId: localPlayer.heroId,
            decision: switchResponse.decision,
            recommendedItemId: switchResponse.recommendedItemId,
            recommendedItemName: switchResponse.recommendedItemName,
            currentArchetype: switchResponse.currentBuildArchetype,
            nextCoreItemName: null,
            urgency: switchResponse.urgency,
            confidence: switchResponse.confidence,
            candidates: switchResponse.candidates,
            evidence: switchResponse.supportingEvidence,
          });

          return switchResponse;
        }

        archRecord.current = bestType;
      }
    }

    const currentBuildArchetype = archRecord.current !== 'unknown' ? archRecord.current : liveArchetype;
    const baseBuild = await this.resolveBaseBuild(localPlayer.heroId, currentBuildArchetype);
    const nextCoreItem = this.findNextCoreItem(baseBuild, localPlayer.items);
    const momentumBySteamId = this.calculateMomentumBySteamId(state);
    const threats = await this.calculateThreats(enemies, items, momentumBySteamId, state.gameTimeSec || 600);
    const mainThreat = threats[0];
    const vulnerabilities = this.calculateLocalVulnerabilities(localPlayer, mainThreat, items, nextCoreItem);
    const teamCoverage = this.calculateTeamCoverage(allies, items);
    const candidates = await this.generateCandidates({
      localPlayer,
      enemies,
      allies,
      items,
      mainThreat,
      vulnerabilities,
      teamCoverage,
      nextCoreItem,
      currentBuildArchetype,
      currentTimeSec: state.gameTimeSec || 600,
    });

    const rankedCandidates = candidates.sort((a, b) => b.score - a.score);

    // Compute Core Build expected score as comparison action
    const coreSpikeDependency = vulnerabilities.coreSpikeDependency || 0;
    const urgency = mainThreat?.power || 0;
    const coreScore = nextCoreItem
      ? this.clamp(
          (1 - urgency) * 0.35 +
            0.45 * POLICY_CONFIG.buildCompatibilityWeight +
            coreSpikeDependency * 0.25
        )
      : 0.5;

    // Hysteresis Locking Check
    let activeRec: ActiveRecommendation | undefined;
    for (const rec of this.activeRecommendations.values()) {
      if (rec.matchId === state.matchId && rec.localPlayerKey === localPlayer.steamId && rec.state === 'ACTIVE') {
        activeRec = rec;
        break;
      }
    }

    if (activeRec) {
      const activeCandidate = candidates.find((c) => c.itemId === activeRec!.itemId);
      if (activeCandidate) {
        if (await this.playerOwnsItemOrUpgrade(localPlayer, activeRec.itemId)) {
          this.markRecommendationPurchased(activeRec);
        } else if (activeCandidate.score >= POLICY_CONFIG.hysteresisExitScore && activeCandidate.confidence >= POLICY_CONFIG.hysteresisExitConfidence) {
          activeRec.lastSeenAt = Date.now();
          const response = this.buildRecommendationResponse(state, localPlayer, activeCandidate, currentBuildArchetype, nextCoreItem, rankedCandidates, activeRec.id);
          await this.saveShadowModeDecision({
            matchId: state.matchId,
            gameTimeSec: state.gameTimeSec || 0,
            localHeroId: localPlayer.heroId,
            decision: response.decision,
            recommendedItemId: response.recommendedItemId,
            recommendedItemName: response.recommendedItemName,
            currentArchetype: response.currentBuildArchetype,
            nextCoreItemName: response.nextCoreItem?.name || null,
            urgency: response.urgency,
            confidence: response.confidence,
            candidates: response.candidates,
            evidence: response.supportingEvidence,
          });
          return response;
        } else {
          this.expireRecommendation(activeRec);
        }
      }
    }

    if (!mainThreat || mainThreat.classification === 'NONE') {
      const response = this.continueCore('No enemy threat is strong enough to justify delaying the core build.', state, localPlayer, currentBuildArchetype, nextCoreItem, candidates);
      await this.saveShadowModeDecision({
        matchId: state.matchId,
        gameTimeSec: state.gameTimeSec || 0,
        localHeroId: localPlayer.heroId,
        decision: response.decision,
        recommendedItemId: null,
        recommendedItemName: null,
        currentArchetype: response.currentBuildArchetype,
        nextCoreItemName: response.nextCoreItem?.name || null,
        urgency: response.urgency,
        confidence: response.confidence,
        candidates: response.candidates,
        evidence: response.supportingEvidence,
      });
      return response;
    }

    const best = rankedCandidates[0];
    if (!best) {
      const response = this.continueCore('No supported situational candidate was generated.', state, localPlayer, currentBuildArchetype, nextCoreItem, candidates);
      await this.saveShadowModeDecision({
        matchId: state.matchId,
        gameTimeSec: state.gameTimeSec || 0,
        localHeroId: localPlayer.heroId,
        decision: response.decision,
        recommendedItemId: null,
        recommendedItemName: null,
        currentArchetype: response.currentBuildArchetype,
        nextCoreItemName: response.nextCoreItem?.name || null,
        urgency: response.urgency,
        confidence: response.confidence,
        candidates: response.candidates,
        evidence: response.supportingEvidence,
      });
      return response;
    }

    // Evaluate Decision Rule (Section 23 Policy Arbiter)
    // lower_confidence_bound(candidate) > upper_confidence_bound(core) + minimum_margin
    const minMargin = 0.08;
    const lcbBest = best.score - (1 - best.confidence) * 0.15;
    const ucbCore = coreScore + (1 - 0.75) * 0.15;

    const clearedThresholds = lcbBest > (ucbCore + minMargin) && best.confidence >= POLICY_CONFIG.minCandidateConfidence && best.score >= POLICY_CONFIG.minBuyScore;

    if (!clearedThresholds) {
      const response = this.continueCore(
        'Best situational candidate did not clear conservative confidence and margin thresholds.',
        state,
        localPlayer,
        currentBuildArchetype,
        nextCoreItem,
        rankedCandidates,
      );
      await this.saveShadowModeDecision({
        matchId: state.matchId,
        gameTimeSec: state.gameTimeSec || 0,
        localHeroId: localPlayer.heroId,
        decision: response.decision,
        recommendedItemId: null,
        recommendedItemName: null,
        currentArchetype: response.currentBuildArchetype,
        nextCoreItemName: response.nextCoreItem?.name || null,
        urgency: response.urgency,
        confidence: response.confidence,
        candidates: response.candidates,
        evidence: response.supportingEvidence,
      });
      return response;
    }

    const recommendationId = this.recommendationIdentity(state, localPlayer, best);
    const cooldownUntil = this.cooldowns.get(recommendationId);
    if (cooldownUntil && cooldownUntil > Date.now()) {
      const response = this.continueCore(
        'Recommendation is cooling down after a recent lifecycle transition.',
        state,
        localPlayer,
        currentBuildArchetype,
        nextCoreItem,
        rankedCandidates,
        recommendationId,
        cooldownUntil,
      );
      await this.saveShadowModeDecision({
        matchId: state.matchId,
        gameTimeSec: state.gameTimeSec || 0,
        localHeroId: localPlayer.heroId,
        decision: response.decision,
        recommendedItemId: null,
        recommendedItemName: null,
        currentArchetype: response.currentBuildArchetype,
        nextCoreItemName: response.nextCoreItem?.name || null,
        urgency: response.urgency,
        confidence: response.confidence,
        candidates: response.candidates,
        evidence: response.supportingEvidence,
      });
      return response;
    }

    const response = this.buildRecommendationResponse(state, localPlayer, best, currentBuildArchetype, nextCoreItem, rankedCandidates, recommendationId);
    this.activateRecommendation(state, localPlayer, best, recommendationId);

    await this.saveShadowModeDecision({
      matchId: state.matchId,
      gameTimeSec: state.gameTimeSec || 0,
      localHeroId: localPlayer.heroId,
      decision: response.decision,
      recommendedItemId: response.recommendedItemId,
      recommendedItemName: response.recommendedItemName,
      currentArchetype: response.currentBuildArchetype,
      nextCoreItemName: response.nextCoreItem?.name || null,
      urgency: response.urgency,
      confidence: response.confidence,
      candidates: response.candidates,
      evidence: response.supportingEvidence,
    });

    return response;
  }

  private buildRecommendationResponse(
    state: MinimalMatchState,
    localPlayer: MinimalPlayerState,
    candidate: Candidate,
    archetype: BuildType | 'unknown',
    nextCoreItem: { id: number; name: string; avgPurchaseTimeS?: number } | null,
    rankedCandidates: Candidate[],
    recommendationId: string,
  ): SituationalRecommendationResponse {
    const decision: SituationalDecision = nextCoreItem ? 'BUY_SITUATIONAL_ITEM' : 'DELAY_CURRENT_CORE_ITEM';
    return {
      decision,
      recommendedItemId: candidate.itemId,
      recommendedItemName: candidate.name,
      currentBuildArchetype: archetype,
      nextCoreItem,
      shouldDelayCore: nextCoreItem !== null,
      urgency: this.urgencyLabel(candidate.score),
      confidence: this.round(candidate.confidence),
      stateRevision: state.lastUpdatedAt,
      mainThreatHero: candidate.mainThreat ? { heroId: candidate.mainThreat.heroId, heroName: candidate.mainThreat.heroName } : null,
      counterPurpose: candidate.purpose,
      supportingEvidence: candidate.evidence,
      historicalSampleSize: candidate.support,
      estimatedUplift: this.round(candidate.estimatedUplift),
      expirationConditions: [
        'local player buys the recommended item or an upgrade in the same item family',
        'main threat drops below elevated classification',
        'telemetry becomes stale',
        'core path advances past the recommended insertion point',
      ],
      fallbackAction: 'CONTINUE_CORE',
      recommendationId,
      recommendationState: 'ACTIVE',
      cooldownUntil: null,
      candidates: this.serializeCandidates(rankedCandidates),
    };
  }

  private resolveState(matchId?: string): MinimalMatchState | undefined {
    if (matchId) {
      return this.liveMatchStateService.getState(matchId);
    }

    return this.liveMatchStateService
      .getAllStates()
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))[0];
  }

  private validateReadiness(state: MinimalMatchState): { ok: true } | { ok: false; reason: string } {
    if (!state.matchId || state.matchId === 'unknown') {
      return { ok: false, reason: 'Live match ID is not ready.' };
    }
    if (Date.now() - Date.parse(state.lastUpdatedAt) > POLICY_CONFIG.staleStateMs) {
      return { ok: false, reason: 'Live state is stale.' };
    }
    const players = Object.values(state.playersBySteamId);
    if (players.length < POLICY_CONFIG.minRosterPlayers) {
      return { ok: false, reason: 'Roster is incomplete.' };
    }
    if (state.gameTimeSec === undefined) {
      return { ok: false, reason: 'Match clock is unavailable.' };
    }
    if (!players.some((p) => p.items.length > 0)) {
      return { ok: false, reason: 'Item feed is not available yet.' };
    }
    return { ok: true };
  }

  private resolveLocalPlayer(state: MinimalMatchState, localSteamId?: string): MinimalPlayerState | undefined {
    if (localSteamId && state.playersBySteamId[localSteamId]) {
      return state.playersBySteamId[localSteamId];
    }

    return Object.values(state.playersBySteamId).find((p) => p.isLocal);
  }

  private async loadItemsMap(): Promise<ItemsMap> {
    const items = await this.itemRepo.find();
    return items.reduce<ItemsMap>((acc, item) => {
      acc[String(item.itemId)] = {
        name: item.name,
        className: item.className,
        slotType: item.itemSlotType,
        cost: item.cost,
        tier: item.itemTier,
      };
      return acc;
    }, {});
  }

  private inferBuildArchetype(items: MinimalItemState[], itemMap: ItemsMap): BuildType | 'unknown' {
    const spend: Record<BuildType, number> = { weapon: 0, spirit: 0, vitality: 0 };
    for (const item of items) {
      const meta = itemMap[String(item.id)];
      if (!meta) continue;
      if (meta.slotType === 'weapon' || meta.slotType === 'spirit' || meta.slotType === 'vitality') {
        spend[meta.slotType] += meta.cost || 0;
      }
    }

    const entries = Object.entries(spend) as [BuildType, number][];
    const [bestType, bestSpend] = entries.sort((a, b) => b[1] - a[1])[0];
    return bestSpend > 0 ? bestType : 'unknown';
  }

  private async resolveBaseBuild(heroId: number, archetype: BuildType | 'unknown'): Promise<any | null> {
    try {
      const buildData = await this.allHeroesAnalysisService.getHeroBuilds(heroId);
      if (!buildData.builds.length) return null;
      return buildData.builds.find((build: any) => build.buildType === archetype) ?? buildData.builds[0];
    } catch {
      return null;
    }
  }

  private findNextCoreItem(baseBuild: any | null, liveItems: MinimalItemState[]): { id: number; name: string; avgPurchaseTimeS?: number } | null {
    if (!baseBuild?.phases) return null;

    const owned = new Set(liveItems.map((item) => item.id));
    const sequence = [
      ...(baseBuild.phases.early || []),
      ...(baseBuild.phases.mid || []),
      ...(baseBuild.phases.late || []),
    ].sort((a: any, b: any) => (a.avgPurchaseTimeS || 0) - (b.avgPurchaseTimeS || 0));

    const next = sequence.find((item: any) => !owned.has(item.id));
    return next ? { id: next.id, name: next.name, avgPurchaseTimeS: next.avgPurchaseTimeS } : null;
  }

  private async getHeroBenchmarks(heroId: number): Promise<{ netWorthPerSec: number; killsPerSec: number }> {
    const cached = this.benchmarkCache.get(heroId);
    if (cached) return cached;

    try {
      const aliases = heroIdAliases(heroId);
      const result = await this.matchPlayerRepo.createQueryBuilder('mp')
        .innerJoin('mp.match', 'm')
        .select('AVG(CAST(mp.netWorth AS FLOAT) / NULLIF(m.durationS, 0))', 'netWorthPerSec')
        .addSelect('AVG(CAST(mp.kills AS FLOAT) / NULLIF(m.durationS, 0))', 'killsPerSec')
        .where('mp.heroId IN (:...heroIds)', { heroIds: aliases })
        .getRawOne();

      const nw = parseFloat(result?.netWorthPerSec) || 8.5;
      const kills = parseFloat(result?.killsPerSec) || 0.005;
      const benchmarks = { netWorthPerSec: nw, killsPerSec: kills };
      this.benchmarkCache.set(heroId, benchmarks);
      return benchmarks;
    } catch {
      return { netWorthPerSec: 8.5, killsPerSec: 0.005 };
    }
  }

  private async calculateThreats(
    enemies: MinimalPlayerState[],
    itemMap: ItemsMap,
    momentumBySteamId: Record<string, { score: number; evidence: string[] }>,
    gameTimeSec: number,
  ): Promise<ThreatVector[]> {
    const maxSouls = Math.max(1, ...enemies.map((p) => p.souls || 0));
    const maxHeroDamage = Math.max(1, ...enemies.map((p) => p.heroDamage || 0));

    const vectors: ThreatVector[] = [];
    for (const enemy of enemies) {
      if (enemy.heroId === undefined) continue;
      const heroName = enemy.heroName || `Hero_${enemy.heroId}`;
      const prior = HERO_THREAT_PRIORS[this.normalizeName(heroName)] ?? { orientation: 'mixed', tags: [] };
      const itemPressure = this.itemPressure(enemy.items, itemMap);
      const momentum = momentumBySteamId[enemy.steamId] ?? { score: 0, evidence: [] };
      const kdaImpact = ((enemy.kills || 0) + (enemy.assists || 0) * 0.6) / Math.max(1, enemy.deaths || 0);

      const benchmarks = await this.getHeroBenchmarks(enemy.heroId);
      const expectedNetWorth = benchmarks.netWorthPerSec * gameTimeSec;
      const deviation = (enemy.souls || 0) / Math.max(1, expectedNetWorth);

      const power = this.clamp(
        ((enemy.souls || 0) / maxSouls) * 0.25 +
          ((enemy.heroDamage || 0) / maxHeroDamage) * 0.25 +
          Math.min(1, kdaImpact / 8) * 0.15 +
          Math.min(1, (enemy.level || 0) / 20) * 0.1 +
          momentum.score * 0.12 +
          Math.min(1, deviation / 2) * 0.13,
      );

      const weaponPressure = this.clamp((prior.orientation === 'weapon' ? 0.35 : prior.orientation === 'mixed' ? 0.18 : 0.05) + itemPressure.weapon);
      const spiritPressure = this.clamp((prior.orientation === 'spirit' ? 0.35 : prior.orientation === 'mixed' ? 0.18 : 0.05) + itemPressure.spirit);
      const burst = this.clamp((prior.tags.includes('burst') ? 0.3 : 0.05) + power * 0.35);
      const healing = prior.tags.includes('sustain') || prior.tags.includes('anti_heal') ? 0.45 : 0.08;
      const hardCc = prior.tags.includes('hard_cc') ? 0.5 : 0.08;
      const sustainedDamage = this.clamp((prior.tags.includes('sustained_damage') ? 0.35 : 0.1) + power * 0.25);
      const mobility = prior.tags.includes('mobility') ? 0.45 : 0.12;
      const tankiness = prior.tags.includes('tankiness') ? 0.5 : 0.15;
      const objectivePressure = prior.tags.includes('objective_pressure') ? 0.4 : 0.1;

      const classification: ThreatClassification =
        power > 0.82 ? 'CRITICAL' : power > 0.65 ? 'HIGH' : power > 0.48 ? 'ELEVATED' : 'NONE';

      vectors.push({
        heroId: enemy.heroId,
        heroName,
        power,
        weaponPressure,
        spiritPressure,
        burst,
        healing,
        hardCc,
        sustainedDamage,
        mobility,
        tankiness,
        objectivePressure,
        momentum: momentum.score,
        classification,
        confidence: this.clamp(
          0.45 +
            (enemy.souls !== undefined ? 0.15 : 0) +
            (enemy.heroDamage !== undefined ? 0.15 : 0) +
            (enemy.items.length > 0 ? 0.15 : 0) +
            (momentum.score > 0 ? 0.08 : 0),
        ),
        evidence: [
          `threat classification ${classification}`,
          `souls ${enemy.souls ?? 'unknown'}, hero damage ${enemy.heroDamage ?? 'unknown'}`,
          `item pressure weapon=${this.round(weaponPressure)} spirit=${this.round(spiritPressure)}`,
          ...momentum.evidence,
        ],
      });
    }

    return vectors.sort((a, b) => b.power - a.power);
  }

  private calculateMomentumBySteamId(state: MinimalMatchState): Record<string, { score: number; evidence: string[] }> {
    const snapshots = this.liveMatchStateService.getSnapshots(state.matchId);
    if (state.gameTimeSec === undefined || snapshots.length === 0) {
      return {};
    }

    const baseline = this.findMomentumBaseline(snapshots, state.gameTimeSec);
    if (!baseline) {
      return {};
    }

    return Object.entries(state.playersBySteamId).reduce<Record<string, { score: number; evidence: string[] }>>((acc, [steamId, player]) => {
      const previous = baseline.playersBySteamId[steamId];
      if (!previous) {
        return acc;
      }

      const soulsDelta = Math.max(0, (player.souls || 0) - (previous.souls || 0));
      const damageDelta = Math.max(0, (player.heroDamage || 0) - (previous.heroDamage || 0));
      const takedownDelta =
        Math.max(0, (player.kills || 0) - (previous.kills || 0)) +
        Math.max(0, (player.assists || 0) - (previous.assists || 0)) * 0.5;
      const newItems = player.items.filter((item) => !previous.itemIds.includes(item.id)).length;

      const score = this.clamp(
        Math.min(1, soulsDelta / 4500) * 0.35 +
          Math.min(1, damageDelta / 4500) * 0.35 +
          Math.min(1, takedownDelta / 4) * 0.2 +
          Math.min(1, newItems / 2) * 0.1,
      );

      acc[steamId] = {
        score,
        evidence: score > 0.12
          ? [`recent momentum souls+${soulsDelta}, heroDamage+${damageDelta}, takedowns+${this.round(takedownDelta)}, newItems+${newItems}`]
          : [],
      };
      return acc;
    }, {});
  }

  private findMomentumBaseline(snapshots: MinimalMatchSnapshot[], currentGameTimeSec: number): MinimalMatchSnapshot | undefined {
    const targetStart = currentGameTimeSec - 300;
    const targetEnd = currentGameTimeSec - 120;
    return [...snapshots]
      .reverse()
      .find((snapshot) => snapshot.gameTimeSec !== undefined && snapshot.gameTimeSec >= targetStart && snapshot.gameTimeSec <= targetEnd);
  }

  private itemPressure(items: MinimalItemState[], itemMap: ItemsMap): { weapon: number; spirit: number; vitality: number } {
    const spend = { weapon: 0, spirit: 0, vitality: 0 };
    for (const item of items) {
      const slot = itemMap[String(item.id)]?.slotType;
      const cost = itemMap[String(item.id)]?.cost || 0;
      if (slot === 'weapon' || slot === 'spirit' || slot === 'vitality') {
        spend[slot] += cost;
      }
    }
    const total = Math.max(1, spend.weapon + spend.spirit + spend.vitality);
    return {
      weapon: (spend.weapon / total) * 0.45,
      spirit: (spend.spirit / total) * 0.45,
      vitality: (spend.vitality / total) * 0.35,
    };
  }

  private calculateLocalVulnerabilities(
    local: MinimalPlayerState,
    threat: ThreatVector | undefined,
    itemMap: ItemsMap,
    nextCoreItem: { id: number; name: string; avgPurchaseTimeS?: number } | null,
  ): Record<string, number> {
    const tags = this.playerItemTags(local.items, itemMap);
    const healthRatio = local.health !== undefined && local.maxHealth ? local.health / local.maxHealth : 1;
    const deathPressure = Math.min(1, (local.deaths || 0) / 8);
    const coreSpikeDependency = nextCoreItem
      ? this.clamp(1 - Math.max(0, (nextCoreItem.avgPurchaseTimeS || 1600) - (local.souls || 0)) / 1500)
      : 0;

    return {
      missingBulletDefense: this.clamp((threat?.weaponPressure || 0) + deathPressure * 0.25 + (tags.has('anti_bullet') ? -0.55 : 0)),
      missingSpiritDefense: this.clamp((threat?.spiritPressure || 0) + deathPressure * 0.25 + (tags.has('anti_spirit') ? -0.55 : 0)),
      missingCleanse: this.clamp((threat?.hardCc || 0) + (tags.has('cleanse') ? -0.65 : 0)),
      missingEscape: this.clamp((threat?.mobility || 0) + deathPressure * 0.2 + (tags.has('escape') || tags.has('mobility') ? -0.5 : 0)),
      missingAntiBurst: this.clamp((threat?.burst || 0) + (healthRatio < 0.45 ? 0.2 : 0) + (tags.has('anti_burst') ? -0.55 : 0)),
      missingSustain: this.clamp((threat?.sustainedDamage || 0) * 0.8 + (tags.has('sustain') ? -0.6 : 0)),
      missingHardDisable: this.clamp((threat?.burst || 0) * 0.5 + (threat?.mobility || 0) * 0.5 + (tags.has('hard_disable') ? -0.55 : 0)),
      missingAntiHeal: this.clamp((threat?.healing || 0) + (tags.has('anti_heal') ? -0.6 : 0)),
      recentDeathPressure: deathPressure,
      coreSpikeDependency,
    };
  }

  private calculateTeamCoverage(allies: MinimalPlayerState[], itemMap: ItemsMap): Record<string, number> {
    const coverage: Record<string, number> = {};
    for (const ally of allies) {
      for (const item of ally.items) {
        const meta = itemMap[String(item.id)];
        if (!meta) continue;
        const scope = this.inferScope(meta.name, meta.className);
        if (scope === 'SELF_SURVIVAL' || scope === 'MOBILITY') {
          continue;
        }
        for (const tag of this.inferItemTags(meta.name, meta.className)) {
          coverage[tag] = Math.min(1, (coverage[tag] || 0) + 0.35);
        }
      }
    }
    return coverage;
  }

  private async generateCandidates(input: {
    localPlayer: MinimalPlayerState;
    enemies: MinimalPlayerState[];
    allies: MinimalPlayerState[];
    items: ItemsMap;
    mainThreat?: ThreatVector;
    vulnerabilities: Record<string, number>;
    teamCoverage: Record<string, number>;
    nextCoreItem: { id: number; name: string; avgPurchaseTimeS?: number } | null;
    currentBuildArchetype: BuildType | 'unknown';
    currentTimeSec: number;
  }): Promise<Candidate[]> {
    const localOwned = new Set(input.localPlayer.items.map((item) => item.id));
    const desiredTags = this.desiredCounterTags(input.vulnerabilities, input.mainThreat);
    if (desiredTags.length === 0) return [];

    const candidateItems = Object.entries(input.items)
      .map(([id, meta]) => ({ id: Number(id), ...meta, tags: this.inferItemTags(meta.name, meta.className), scope: this.inferScope(meta.name, meta.className) }))
      .filter((item) => item.cost > 0 && item.cost <= 6400)
      .filter((item) => desiredTags.some((tag) => item.tags.includes(tag)));

    const supportMap = await this.calculateHistoricalSupport(
      input.localPlayer.heroId!,
      input.enemies,
      candidateItems.map((item) => item.id),
      input.currentTimeSec,
    );

    return candidateItems.map((item) => {
      const ownedPenalty = localOwned.has(item.id) ? POLICY_CONFIG.ownedPenalty : 0;
      const redundancyPenalty = this.redundancyPenalty(item.tags, item.scope, input.teamCoverage);
      const historical = supportMap[item.id] ?? { support: 0, uplift: 0 };
      const urgency = input.mainThreat?.power || 0;
      const vulnerability = this.matchingVulnerabilityScore(item.tags, input.vulnerabilities);
      const buildCompatibility = item.slotType === input.currentBuildArchetype ? 0.45 : item.scope === 'SELF_SURVIVAL' || item.scope === 'TEAM_UTILITY' ? 0.3 : 0.12;
      const coreInterruption = input.nextCoreItem ? this.clamp((item.cost / Math.max(800, input.nextCoreItem.avgPurchaseTimeS || 1600)) * 0.05) : 0;
      const supportConfidence = historical.support >= POLICY_CONFIG.minSupportForHighConfidence
        ? 0.25
        : historical.support >= POLICY_CONFIG.minSupportForMediumConfidence
        ? 0.14
        : 0.04;

      const score = this.clamp(
        urgency * POLICY_CONFIG.urgencyWeight +
          vulnerability * POLICY_CONFIG.vulnerabilityWeight +
          Math.max(0, historical.uplift) * POLICY_CONFIG.historicalUpliftWeight +
          buildCompatibility * POLICY_CONFIG.buildCompatibilityWeight +
          this.teamCoverageBenefit(item.tags, item.scope, input.teamCoverage) * POLICY_CONFIG.teamCoverageWeight -
          coreInterruption * POLICY_CONFIG.coreInterruptionWeight -
          redundancyPenalty -
          ownedPenalty,
      );
      const confidence = this.clamp(0.35 + supportConfidence + (input.mainThreat?.confidence || 0) * 0.22 + vulnerability * 0.18 - redundancyPenalty - ownedPenalty);

      return {
        itemId: item.id,
        name: item.name,
        cost: item.cost,
        slotType: item.slotType,
        scope: item.scope,
        tags: item.tags,
        purpose: this.counterPurpose(item.tags),
        score,
        confidence,
        support: historical.support,
        estimatedUplift: historical.uplift,
        mainThreat: input.mainThreat,
        evidence: [
          ...(input.mainThreat?.evidence || []),
          `covers ${item.tags.filter((tag) => desiredTags.includes(tag)).join(', ')}`,
          `historical support ${historical.support}, uplift ${this.round(historical.uplift)}`,
          `redundancy penalty ${this.round(redundancyPenalty)}`,
        ],
      };
    });
  }

  private async calculateHistoricalSupport(
    heroId: number,
    enemies: MinimalPlayerState[],
    candidateItemIds: number[],
    currentTimeSec: number,
  ): Promise<Record<number, { support: number; uplift: number }>> {
    if (candidateItemIds.length === 0) return {};
    const dbHeroIds = heroIdAliases(heroId);
    const dbEnemyIds = enemies
      .map((enemy) => enemy.heroId)
      .filter((id): id is number => id !== undefined)
      .flatMap((id) => heroIdAliases(id));
    const players = await this.matchPlayerRepo.find({
      where: { heroId: In(dbHeroIds) },
      order: { crawledAt: 'DESC' },
      take: 1000,
      relations: { itemPurchases: true, match: { players: true } },
    });

    if (players.length === 0) return {};
    const currentEnemiesSet = new Set(dbEnemyIds);

    return candidateItemIds.reduce<Record<number, { support: number; uplift: number }>>((acc, itemId) => {
      let sumWeightWith = 0;
      let sumWeightWithWin = 0;
      let sumWeightWithout = 0;
      let sumWeightWithoutWin = 0;
      let countWith = 0;

      for (const player of players) {
        const matchPlayers = player.match?.players || [];
        const matchEnemyIds = matchPlayers.filter((mp) => mp.team !== player.team).map((mp) => mp.heroId);
        const commonEnemies = matchEnemyIds.filter((id) => currentEnemiesSet.has(id)).length;

        const hasItemRecord = (player.itemPurchases || []).find((item) => Number(item.itemId) === itemId);
        const purchaseTime = hasItemRecord?.purchaseTimeS ?? currentTimeSec;
        const timeDiff = Math.abs(purchaseTime - currentTimeSec);
        const badgeDiff = Math.abs((player.match?.averageBadge || 65) - 65);

        const weight = Math.exp(- (timeDiff / 480) - (badgeDiff / 30) - (5 - commonEnemies) * 0.15);

        if (hasItemRecord) {
          countWith++;
          sumWeightWith += weight;
          if (player.won) sumWeightWithWin += weight;
        } else {
          sumWeightWithout += weight;
          if (player.won) sumWeightWithoutWin += weight;
        }
      }

      const wrWith = sumWeightWith > 0 ? sumWeightWithWin / sumWeightWith : 0.5;
      const wrWithout = sumWeightWithout > 0 ? sumWeightWithoutWin / sumWeightWithout : 0.5;
      const uplift = wrWith - wrWithout;

      acc[itemId] = { support: countWith, uplift };
      return acc;
    }, {});
  }

  private desiredCounterTags(vulnerabilities: Record<string, number>, threat?: ThreatVector): string[] {
    const tags: string[] = [];
    if ((vulnerabilities.missingBulletDefense || 0) >= 0.35) tags.push('anti_bullet', 'anti_burst');
    if ((vulnerabilities.missingSpiritDefense || 0) >= 0.35) tags.push('anti_spirit', 'anti_burst');
    if ((vulnerabilities.missingCleanse || 0) >= 0.35 || (vulnerabilities.missingEscape || 0) >= 0.35) tags.push('cleanse', 'escape');
    if ((vulnerabilities.missingAntiBurst || 0) >= 0.35 || (vulnerabilities.missingSustain || 0) >= 0.35) tags.push('anti_burst', 'sustain');
    if ((vulnerabilities.missingAntiHeal || 0) >= 0.35 || (threat?.healing || 0) >= 0.35) tags.push('anti_heal');
    if ((threat?.hardCc || 0) >= 0.35 || (vulnerabilities.missingHardDisable || 0) >= 0.35) tags.push('hard_disable', 'silence');
    return [...new Set(tags)];
  }

  private inferItemTags(name: string, className: string): string[] {
    const text = `${name} ${className}`.toLowerCase();
    const tags: string[] = [];
    if (/armor|bullet|metal|return_fire|combat_barrier/.test(text)) tags.push('anti_bullet');
    if (/spirit|tech|enchanter|veil|resist/.test(text)) tags.push('anti_spirit');
    if (/barrier|shield|reactive|lifestrike|leech|restore|healing|regen|fortitude/.test(text)) tags.push('anti_burst', 'sustain');
    if (/debuff|cleanse|unstoppable|ethereal|warp|fleetfoot|stamina|majestic/.test(text)) tags.push('cleanse', 'escape', 'mobility');
    if (/heal.?bane|decay|toxic|inhibitor|silence/.test(text)) tags.push('anti_heal');
    if (/knockdown|curse|slowing|hex|silence|stun|disable/.test(text)) tags.push('hard_disable', 'silence');
    if (/monster|shred|hunter|burst|glass|headshot|rounds|reload|fire/.test(text)) tags.push('self_damage');
    return [...new Set(tags)];
  }

  private inferScope(name: string, className: string): ItemScope {
    const text = `${name} ${className}`.toLowerCase();
    if (/aura|nova|rescue|barrier/.test(text)) return 'TEAM_UTILITY';
    if (/heal.?bane|decay|toxic/.test(text)) return 'ANTI_HEAL';
    if (/knockdown|curse|silence|hex/.test(text)) return 'TARGETED_DISABLE';
    if (/warp|fleetfoot|stamina|majestic/.test(text)) return 'MOBILITY';
    if (/armor|skin|shield|regen|fortitude|reactive|debuff|unstoppable/.test(text)) return 'SELF_SURVIVAL';
    if (/monster|objective/.test(text)) return 'OBJECTIVE';
    return 'SELF_DAMAGE';
  }

  private playerItemTags(items: MinimalItemState[], itemMap: ItemsMap): Set<string> {
    const tags = new Set<string>();
    for (const item of items) {
      const meta = itemMap[String(item.id)];
      if (!meta) continue;
      this.inferItemTags(meta.name, meta.className).forEach((tag) => tags.add(tag));
    }
    return tags;
  }

  private matchingVulnerabilityScore(tags: string[], vulnerabilities: Record<string, number>): number {
    const values: number[] = [];
    if (tags.includes('anti_bullet')) values.push(vulnerabilities.missingBulletDefense || 0);
    if (tags.includes('anti_spirit')) values.push(vulnerabilities.missingSpiritDefense || 0);
    if (tags.includes('cleanse') || tags.includes('escape')) values.push(vulnerabilities.missingCleanse || 0, vulnerabilities.missingEscape || 0);
    if (tags.includes('anti_burst') || tags.includes('sustain')) values.push(vulnerabilities.missingAntiBurst || 0, vulnerabilities.missingSustain || 0);
    if (tags.includes('anti_heal')) values.push(vulnerabilities.missingAntiHeal || 0);
    return values.length ? Math.max(...values) : 0;
  }

  private redundancyPenalty(tags: string[], scope: ItemScope, teamCoverage: Record<string, number>): number {
    if (scope === 'SELF_SURVIVAL' || scope === 'MOBILITY') return 0;
    const maxCoverage = Math.max(0, ...tags.map((tag) => teamCoverage[tag] || 0));
    if (scope === 'TEAM_UTILITY' || scope === 'AURA' || scope === 'ANTI_HEAL') {
      return maxCoverage * POLICY_CONFIG.redundancyPenalty;
    }
    return maxCoverage * (POLICY_CONFIG.redundancyPenalty * 0.55);
  }

  private teamCoverageBenefit(tags: string[], scope: ItemScope, teamCoverage: Record<string, number>): number {
    if (scope !== 'TEAM_UTILITY' && scope !== 'ANTI_HEAL' && scope !== 'TARGETED_DISABLE') return 0;
    const current = Math.max(0, ...tags.map((tag) => teamCoverage[tag] || 0));
    return 1 - current;
  }

  private counterPurpose(tags: string[]): string {
    if (tags.includes('anti_bullet')) return 'personal anti-weapon survival';
    if (tags.includes('anti_spirit')) return 'personal anti-spirit survival';
    if (tags.includes('anti_heal')) return 'anti-heal coverage';
    if (tags.includes('hard_disable')) return 'threat suppression';
    if (tags.includes('cleanse')) return 'cleanse or escape coverage';
    return 'situational coverage';
  }

  private continueCore(
    reason: string,
    state: MinimalMatchState,
    localPlayer: MinimalPlayerState | null,
    archetype: BuildType | 'unknown',
    nextCoreItem: { id: number; name: string; avgPurchaseTimeS?: number } | null,
    candidates: Candidate[],
    recommendationId: string | null = null,
    cooldownUntilMs: number | null = null,
  ): SituationalRecommendationResponse {
    this.expireOwnedRecommendations(state, localPlayer);

    return {
      decision: 'CONTINUE_CORE',
      recommendedItemId: null,
      recommendedItemName: null,
      currentBuildArchetype: archetype,
      nextCoreItem,
      shouldDelayCore: false,
      urgency: 'LOW',
      confidence: 0.62,
      stateRevision: state.lastUpdatedAt,
      mainThreatHero: null,
      counterPurpose: null,
      supportingEvidence: [reason],
      historicalSampleSize: 0,
      estimatedUplift: 0,
      expirationConditions: ['next live evaluation trigger'],
      fallbackAction: 'CONTINUE_CORE',
      recommendationId,
      recommendationState: 'CANDIDATE',
      cooldownUntil: cooldownUntilMs ? new Date(cooldownUntilMs).toISOString() : null,
      candidates: this.serializeCandidates(candidates),
    };
  }

  private abstain(reason: string, stateRevision: string): SituationalRecommendationResponse {
    return {
      decision: 'ABSTAIN',
      recommendedItemId: null,
      recommendedItemName: null,
      currentBuildArchetype: 'unknown',
      nextCoreItem: null,
      shouldDelayCore: false,
      urgency: 'LOW',
      confidence: 0,
      stateRevision,
      mainThreatHero: null,
      counterPurpose: null,
      supportingEvidence: [reason],
      historicalSampleSize: 0,
      estimatedUplift: 0,
      expirationConditions: ['live state becomes ready'],
      fallbackAction: 'ABSTAIN',
      recommendationId: null,
      recommendationState: 'CANDIDATE',
      cooldownUntil: null,
      candidates: [],
    };
  }

  private retainActiveRecommendationIfValid(
    state: MinimalMatchState,
    localPlayer: MinimalPlayerState,
    candidate: Candidate,
    archetype: BuildType | 'unknown',
    nextCoreItem: { id: number; name: string; avgPurchaseTimeS?: number } | null,
    rankedCandidates: Candidate[],
  ): SituationalRecommendationResponse | null {
    const recommendationId = this.recommendationIdentity(state, localPlayer, candidate);
    const active = this.activeRecommendations.get(recommendationId);
    if (!active || active.state !== 'ACTIVE') {
      return null;
    }

    if (this.playerOwnsItem(localPlayer, candidate.itemId)) {
      this.markRecommendationPurchased(active);
      return null;
    }

    if (candidate.score < POLICY_CONFIG.hysteresisExitScore || candidate.confidence < POLICY_CONFIG.hysteresisExitConfidence) {
      this.expireRecommendation(active);
      return null;
    }

    active.lastSeenAt = Date.now();
    return this.buildRecommendationResponse(state, localPlayer, candidate, archetype, nextCoreItem, rankedCandidates, recommendationId);
  }

  private activateRecommendation(
    state: MinimalMatchState,
    localPlayer: MinimalPlayerState,
    candidate: Candidate,
    recommendationId: string,
  ): void {
    const now = Date.now();
    this.activeRecommendations.set(recommendationId, {
      id: recommendationId,
      matchId: state.matchId,
      localPlayerKey: localPlayer.steamId,
      itemId: candidate.itemId,
      threatHeroId: candidate.mainThreat?.heroId ?? null,
      purpose: candidate.purpose,
      state: 'ACTIVE',
      activatedAt: now,
      lastSeenAt: now,
    });
  }

  private expireOwnedRecommendations(state: MinimalMatchState, localPlayer: MinimalPlayerState | null): void {
    if (!localPlayer) {
      return;
    }

    for (const active of this.activeRecommendations.values()) {
      if (active.matchId !== state.matchId || active.localPlayerKey !== localPlayer.steamId || active.state !== 'ACTIVE') {
        continue;
      }
      if (this.playerOwnsItem(localPlayer, active.itemId)) {
        this.markRecommendationPurchased(active);
      }
    }
  }

  private markRecommendationPurchased(active: ActiveRecommendation): void {
    active.state = 'PURCHASED';
    this.cooldowns.set(active.id, Date.now() + POLICY_CONFIG.recommendationCooldownMs);
  }

  private expireRecommendation(active: ActiveRecommendation): void {
    active.state = 'EXPIRED';
    this.cooldowns.set(active.id, Date.now() + POLICY_CONFIG.recommendationCooldownMs);
  }

  private recommendationIdentity(state: MinimalMatchState, localPlayer: MinimalPlayerState, candidate: Candidate): string {
    return [
      state.matchId,
      localPlayer.steamId || `${localPlayer.heroId ?? 'unknown'}:${localPlayer.teamId ?? 'unknown'}`,
      candidate.itemId,
      candidate.mainThreat?.heroId ?? 'no-threat',
      candidate.purpose,
    ].join(':');
  }

  private playerOwnsItem(player: MinimalPlayerState, itemId: number): boolean {
    return player.items.some((item) => item.id === itemId);
  }

  private async playerOwnsItemOrUpgrade(player: MinimalPlayerState, itemId: number): Promise<boolean> {
    const ownedIds = player.items.map((item) => item.id);
    if (ownedIds.includes(itemId)) {
      return true;
    }

    try {
      const relation = await this.itemComponentRepo.findOne({
        where: {
          componentItemId: itemId,
          parentItemId: In(ownedIds),
        },
      });
      if (relation) {
        return true;
      }
    } catch {
      // safe fallback
    }

    return false;
  }

  private serializeCandidates(candidates: Candidate[]): SituationalRecommendationResponse['candidates'] {
    return candidates.slice(0, 5).map((candidate) => ({
      itemId: candidate.itemId,
      name: candidate.name,
      score: this.round(candidate.score),
      confidence: this.round(candidate.confidence),
      support: candidate.support,
      purpose: candidate.purpose,
      evidence: candidate.evidence.slice(0, 4),
    }));
  }

  private urgencyLabel(score: number): SituationalRecommendationResponse['urgency'] {
    if (score >= 0.86) return 'CRITICAL';
    if (score >= 0.72) return 'HIGH';
    if (score >= 0.55) return 'MEDIUM';
    return 'LOW';
  }

  private normalizeName(value: string): string {
    return value.toLowerCase().replace(/^hero_/, '').replace(/[_\s-]+/g, ' ').trim();
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async saveShadowModeDecision(data: {
    matchId: string;
    gameTimeSec: number;
    localHeroId: number;
    decision: string;
    recommendedItemId: number | null;
    recommendedItemName: string | null;
    currentArchetype: string;
    nextCoreItemName: string | null;
    urgency: string;
    confidence: number;
    candidates: any[];
    evidence: string[];
  }): Promise<void> {
    try {
      const decision = new ShadowModeDecision();
      decision.matchId = data.matchId;
      decision.gameTimeSec = data.gameTimeSec;
      decision.localHeroId = data.localHeroId;
      decision.decision = data.decision;
      decision.recommendedItemId = data.recommendedItemId;
      decision.recommendedItemName = data.recommendedItemName;
      decision.currentArchetype = data.currentArchetype;
      decision.nextCoreItemName = data.nextCoreItemName;
      decision.urgency = data.urgency;
      decision.confidence = data.confidence;
      decision.candidatesJson = JSON.stringify(data.candidates);
      decision.supportingEvidenceJson = JSON.stringify(data.evidence);
      await this.shadowModeDecisionRepo.save(decision);
    } catch {
      // safe fallback
    }
  }

  // Baseline comparisons for evaluation (Spec Section 31)
  evaluateBaselines(
    nextCoreItem: { id: number; name: string } | null,
    threat: ThreatVector | undefined,
    vulnerabilities: Record<string, number>,
    candidates: Candidate[],
  ): Record<string, string | null> {
    // 1. Static popular build
    const staticPopular = nextCoreItem ? nextCoreItem.name : null;

    // 2. Deadlock API item-flow next item
    const itemFlow = staticPopular; // proxy fallback

    // 3. Rule-only threat counters
    let ruleOnly: string | null = null;
    if (threat) {
      if (threat.weaponPressure > 0.6) ruleOnly = 'Metal Skin';
      else if (threat.spiritPressure > 0.6) ruleOnly = 'Ethereal Shift';
      else if (threat.healing > 0.5) ruleOnly = 'Healbane';
      else if (threat.hardCc > 0.5) ruleOnly = 'Unstoppable';
    }

    // 4. Nearest-neighbor recommendation
    const sortedBySupport = [...candidates].sort((a, b) => b.support - a.support);
    const nearestNeighbor = sortedBySupport.length > 0 ? sortedBySupport[0].name : null;

    // 5. Full situation-aware policy (this engine)
    const sortedByScore = [...candidates].sort((a, b) => b.score - a.score);
    const situationAware = sortedByScore.length > 0 ? sortedByScore[0].name : null;

    return {
      staticPopular,
      itemFlow,
      ruleOnly,
      nearestNeighbor,
      situationAware,
    };
  }
}
