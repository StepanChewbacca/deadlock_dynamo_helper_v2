#!/usr/bin/env python3
from pathlib import Path
import re

path = Path('apps/api/src/deadlock-live/recommendation-value-v6-training.service.ts')
source = path.read_text()

import_marker = "} from './recommendation-value-v6-model';\n"
shared_import = """} from './recommendation-value-v6-model';
import {
  buildRecommendationValueV6ActionKeys,
  buildRecommendationValueV6StateKeys,
} from './recommendation-value-v6-features';
export { classifyRecommendationValueV6TeamEconomy } from './recommendation-value-v6-features';
"""
if "buildRecommendationValueV6StateKeys" not in source:
    if import_marker not in source:
        raise SystemExit('model import marker was not found')
    source = source.replace(import_marker, shared_import, 1)

source = source.replace('const PREVIOUS_ACTION_TAIL_SIZE = 5;\n', '')

start = source.find('  const previousActions = strings(trajectory.fullPreviousActionKeys);')
end = source.find('  const finalUtility = playerWon ? 1 : -1;', start)
if start < 0 or end < 0:
    if 'buildSharedActionKeys' not in source:
        raise SystemExit('offline feature construction block was not found')
else:
    replacement = """  const previousActions = strings(trajectory.fullPreviousActionKeys);
  const teamId = text(identity.teamId) ?? String(numeric(identity.teamId));
  const inventory = record(features.inventory);
  const timeline = record(state.playerTimelineSnapshot);
  const teamEconomy = record(state.teamEconomy);
  const stateKeys = buildRecommendationValueV6StateKeys({
    heroId,
    teamId: teamId || 'UNKNOWN',
    timeBucket,
    inventoryStateKey,
    previousActionKeys: previousActions,
    alliedHeroIds: numbers(state.alliedHeroIds),
    enemyHeroIds: numbers(state.enemyHeroIds),
    inventoryTotalCost: numeric(inventory.totalCost),
    inventoryHighestTier: numeric(inventory.highestTier),
    playerNetWorth:
      timeline.available === true ? numeric(timeline.netWorth) : undefined,
    playerKills:
      timeline.available === true ? numeric(timeline.kills) : undefined,
    playerDeaths:
      timeline.available === true ? numeric(timeline.deaths) : undefined,
    playerAssists:
      timeline.available === true ? numeric(timeline.assists) : undefined,
    teamNetWorthDelta:
      teamEconomy.available === true
        ? numeric(teamEconomy.netWorthDelta)
        : undefined,
    teamRelativeNetWorthDelta:
      teamEconomy.available === true
        ? numeric(teamEconomy.relativeNetWorthDelta)
        : undefined,
    playerNetWorthRankInTeam:
      numeric(teamEconomy.playerNetWorthRankInTeam) > 0
        ? numeric(teamEconomy.playerNetWorthRankInTeam)
        : undefined,
    playerNetWorthShare:
      teamEconomy.available === true
        ? numeric(teamEconomy.playerNetWorthShare)
        : undefined,
  });
  const teamEconomyBand = stateKeys
    .find((key) => key.startsWith(`TEAM_ECONOMY_BAND:${heroId}|`))
    ?.split('|')[1];
  const buildSharedActionKeys = (
    actionKey: string,
    feature: Record<string, unknown>,
  ): string[] => {
    const item = record(feature.item);
    return buildRecommendationValueV6ActionKeys({
      heroId,
      timeBucket,
      inventoryStateKey,
      previousActionKeys: previousActions,
      teamEconomyBand:
        teamEconomyBand === 'FAR_BEHIND' ||
        teamEconomyBand === 'BEHIND' ||
        teamEconomyBand === 'EVEN' ||
        teamEconomyBand === 'AHEAD' ||
        teamEconomyBand === 'FAR_AHEAD'
          ? teamEconomyBand
          : undefined,
      actionKey,
      slotType: text(item.slotType),
      tier: numeric(item.tier),
      cost: numeric(item.cost),
      isActiveItem: item.isActiveItem === true,
      tags: strings(item.tags),
      interactionKeys: strings(feature.interactionKeys),
    });
  };
  const observedFeature =
    featureCandidates.get(observedActionKey) ?? record(features.observedAction);
  const actionKeys = buildSharedActionKeys(observedActionKey, observedFeature);
  const candidateActions = candidateActionKeys.map((actionKey) => ({
    actionKey,
    actionKeys: buildSharedActionKeys(
      actionKey,
      featureCandidates.get(actionKey) ?? {},
    ),
  }));
"""
    source = source[:start] + replacement + source[end:]

obsolete_pattern = re.compile(
    r"\nfunction buildActionKeys\(input: \{.*?\n\}\n\n\nexport function classifyRecommendationValueV6TeamEconomy\(.*?\n\}\n\n(?=function predictCandidates)",
    re.DOTALL,
)
source, removed = obsolete_pattern.subn('\n', source, count=1)
if removed == 0 and '\nfunction buildActionKeys(input:' in source:
    raise SystemExit('obsolete feature functions were not removed')

path.write_text(source)
