from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'apps/api/src/deadlock-live/live-build-recommendation-traversal.service.ts'
source = path.read_text(encoding='utf-8')

old_request = """        const recommendationRequest: HeroBuildContextualRecommendationRequest = {
          heroId: input.heroId,
          teamId: input.teamId,
          itemIds: [...input.itemIds],
"""
new_request = """        const recommendationRequest: HeroBuildContextualRecommendationRequest = {
          heroId: input.heroId,
          itemIds: [...input.itemIds],
"""
if old_request not in source:
    raise SystemExit('Generated recommendation request did not contain the expected teamId insertion.')
source = source.replace(old_request, new_request, 1)

old_snapshot = """          state: 'READY',
          matchId: input.matchId,
          steamId: input.steamId,
          heroId: input.heroId,
          itemIds: [...input.itemIds],
"""
new_snapshot = """          state: 'READY',
          matchId: input.matchId,
          steamId: input.steamId,
          heroId: input.heroId,
          teamId: input.teamId,
          itemIds: [...input.itemIds],
"""
if old_snapshot not in source:
    raise SystemExit('Generated ready snapshot block was not found.')
source = source.replace(old_snapshot, new_snapshot, 1)
path.write_text(source, encoding='utf-8')

(ROOT / 'scripts/fix-recommendation-telemetry-build.py').unlink(missing_ok=True)
