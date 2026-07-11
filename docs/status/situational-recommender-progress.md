# Situational Build Recommender Progress

Last updated: 2026-07-10

## Implemented

- Added `POST /deadlock/analysis/situational/recommend` for live situational build decisions.
- Added `SituationalRecommendationService` with conservative policy states: `ABSTAIN`, `CONTINUE_CORE`, `BUY_SITUATIONAL_ITEM`, `DELAY_CURRENT_CORE_ITEM`.
- Added live-state readiness checks: match id, fresh telemetry, roster size, match clock, item feed availability, local player, enemy team.
- Added local player resolution from `isLocal` or explicit `localSteamId`.
- Added build archetype inference from current live inventory spend: `weapon`, `spirit`, `vitality`, `unknown`.
- Added next-core-item lookup from historical hero build phases sorted by real average purchase time.
- Added enemy threat vector scoring from souls, hero damage, KDA, level, items, hero threat priors, and rolling momentum.
- Added local vulnerability scoring for missing bullet defense, spirit defense, cleanse, anti-burst, and anti-heal.
- Added team coverage and redundancy penalties so duplicate team utility is less likely to be recommended.
- Added candidate generation from Postgres `items` metadata; no runtime item JSON mapping is used.
- Added historical support and uplift scoring from Postgres `match_players` and `match_player_items`.
- Added structured response fields for confidence, evidence, historical sample size, estimated uplift, fallback action, expiration conditions, and top candidates.

## Implemented In This Step

- Added rolling live snapshots in `LiveMatchStateService`.
- Snapshot triggers:
  - every 30 seconds of game time;
  - immediately when a player's item set changes.
- Snapshot retention is capped at 120 snapshots per match.
- Added recent momentum features from snapshots:
  - souls delta;
  - hero damage delta;
  - takedown delta;
  - newly seen item count.
- Threat scoring now uses recent momentum and exposes it as evidence.
- Added recommendation lifecycle fields:
  - `recommendationId`;
  - `recommendationState`;
  - `cooldownUntil`.
- Added in-memory active recommendation tracking per match/local player/item/threat/purpose.
- Added hysteresis retention so an active recommendation does not flicker off immediately when score drops below the buy threshold but remains above exit thresholds.
- Added cooldown after recommendation purchase/expiration to avoid repeated immediate re-recommendation.

## Data Storage State

- Heroes are stored in Postgres `heroes`.
- Items are stored in Postgres `items`.
- Item component recipes are stored in Postgres `item_components`.
- Matches are stored in Postgres `matches`.
- Match players are stored in Postgres `match_players`.
- Per-player item event history is stored in Postgres `match_player_items`.
- Crawler progress/state is stored in Postgres crawler-state tables/services.
- Runtime `heroes-map.json` and `items-map.json` are removed from the data path.

## Verification

- `yarn workspace @deadlock-live-probe/api test --runTestsByPath test/situational-recommendation.service.spec.ts test/live-match-state.service.spec.ts`
- Targeted result: 2 suites passed, 11 tests passed.
- `yarn workspace @deadlock-live-probe/api build`
- API build result: passed.

## Current Endpoint

```http
POST /deadlock/analysis/situational/recommend
Content-Type: application/json

{
  "matchId": "optional-live-match-id",
  "localSteamId": "optional-local-player-steam-id"
}
```

If `matchId` is omitted, the service evaluates the freshest live match state.

## Not Finished Yet

- Persist recommendation lifecycle to Postgres. Current lifecycle state is in-memory and resets on API restart.
- Add explicit client feedback endpoints for `ACKNOWLEDGED`, `CANCELLED`, and manual `PURCHASED` transitions.
- Add item-family/component-aware purchase detection so buying an upgraded item can close recommendations for its components and same-family items.
- Add stronger matchup-specific item priors once enough clean item-event data exists.
- Add frontend UI for situational recommendations, lifecycle state, cooldown, evidence, and "why this item" explanation.
- Add admin/observability page showing active recommendations, last live state revision, snapshot count, and last decision.
- Re-run remote crawler long enough to rebuild a larger clean sample after item-event ingestion changes.

## Suggested Next Step

Persist recommendation lifecycle in Postgres with a `situational_recommendations` table and expose lifecycle transition endpoints. This makes recommendations auditable, survives deploy/restart, and gives the frontend a stable state model.
