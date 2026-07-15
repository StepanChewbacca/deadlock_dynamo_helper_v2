# Skill Build MVP

The skill build model uses matches whose start time is within the rolling 14-day window.

## Stored data format

The crawler converts raw ability item IDs to skill slot numbers before persistence. Therefore, `match_player_skill_upgrades.abilityId` contains values `1-4`, despite the legacy field name.

A known ability item that does not belong to the player hero is stored as slot `0`. It is never silently converted to skill 1. During analysis, slot `0` produces an `UNKNOWN_ABILITY` diagnostic and only the valid sequence prefix is retained.

At the API boundary, the analysis service converts stored slots `1-4` back to the resolved hero's raw ability item IDs before replay. Domain actions and API responses therefore keep `abilityId` semantically correct while using the existing database format.

## Hero ID namespaces

Historical matches and ability maps use Valve/API hero IDs. The Overwolf live roster uses GEP hero IDs.

The skill endpoint accepts `heroIdSource=gep` to resolve the live ID through `GEP_TO_VALVE_ID` before querying historical data. The response contains:

- `heroId`: the ID supplied by the caller.
- `resolvedHeroId`: the Valve/API ID used for historical data and ability mapping.

The Overwolf client always sends `heroIdSource=gep`. Direct API callers use Valve/API semantics by default.

## Rules

- Learn ability: 1 AP.
- Upgrade level 1: 1 AP.
- Upgrade level 2: 2 AP.
- Upgrade level 3: 5 AP.

A skill level state uses the following values:

- `0`: not learned.
- `1`: learned.
- `2`: upgrade level 1 applied.
- `3`: upgrade level 2 applied.
- `4`: upgrade level 3 applied.

## Historical graph

1. Query recent `MatchPlayer` rows only for the exact resolved Valve/API hero ID.
2. Filter by match start time within the last 14 days.
3. Load the selected players' skill upgrades in batches.
4. Convert persisted skill slots `1-4` back to raw ability item IDs.
5. Replay each chronological skill upgrade sequence.
6. Keep valid prefixes when a later observation is invalid.
7. Aggregate transitions by the complete four-skill state.
8. Cache the resulting hero graph for five minutes.

The first request builds the graph only for the requested hero. Repeated live-state requests reuse the cached graph. A stale graph is returned immediately while its refresh runs in the background.

## Path search

The path search starts from the player's current four-skill state rather than always starting from `0:0:0:0`.

It searches the complete state DAG with memoized dynamic programming and scores each full path as the sum of `log(1 + transitionCount)` for all transitions in the path. The result is the globally highest-scoring legal continuation within the remaining AP budget.

When the player reaches a legal state that was not observed exactly in the historical data, the search uses a backoff state assembled from transitions with the same skill slot and current skill level. This keeps recommendations available after the player deviates from the most common route.

## API

`GET /deadlock/analysis/heroes/:heroId/skill-build`

Optional query parameters:

- `heroIdSource`: `api` or `gep`. Default: `api`.
- `levels`: four comma-separated values from `0` to `4`, for example `1,0,2,3`.
- `maxPointBudget`: positive integer up to 36.

The response includes:

- caller and resolved hero IDs;
- current skill levels and already spent AP;
- the single `nextAction`;
- the remaining globally optimized route;
- raw ability item IDs and skill slots;
- `UNLOCK` or `UPGRADE` action type;
- upgrade level `1`, `2`, or `3`;
- action and cumulative AP costs;
- conditional pick rate, sample size, and average observed timing;
- source counts and validation diagnostics.

## Overwolf runtime

The in-game overlay displays one primary instruction:

- `Learn Skill N` or `Learn Ultimate`.
- `Upgrade Skill N - Level 1/2/3`.

After `DONE`, the client applies the action optimistically and displays the next route step immediately. A background request then verifies the best continuation from the updated state.

When the player applies a different upgrade, the `1`, `2`, `3`, and `ULT` controls record the actual choice and request a continuation from that state. `UNDO` and `RESET` are available for corrections.

Progress is stored in `localStorage` by match ID and live GEP hero ID. API responses are cached by hero and skill-level state for the current Overwolf session.

The current Deadlock GEP contract does not expose the exact AP distribution across the four abilities. The client therefore does not infer skill levels from the hero's general level. It can reconcile repeated ability IDs from inventory payloads when they are available, but the explicit confirmation controls remain the reliable fallback.

## Desktop UI

The desktop window shows the same next action, current four-skill state, source quality metrics, and the complete remaining route. It restores the skill panel after asynchronous item-build rerenders.
