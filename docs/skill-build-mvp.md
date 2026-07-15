# Skill Build MVP

The skill build model uses match data from the existing rolling 14-day recent match window.

## Stored data format

The crawler converts raw ability item IDs to skill slot numbers before persistence. Therefore, `match_player_skill_upgrades.abilityId` contains values `1-4`, despite the legacy field name.

A known ability item that does not belong to the player hero is stored as slot `0`. It is never silently converted to skill 1. During analysis, slot `0` produces an `UNKNOWN_ABILITY` diagnostic and only the valid sequence prefix is retained.

At the API boundary, the analysis service converts stored slots `1-4` back to the requested hero's raw ability item IDs before replay. Domain actions and API responses therefore keep `abilityId` semantically correct while using the existing database format.

## Rules

- Unlock: 1 AP
- Tier 1: 1 AP
- Tier 2: 2 AP
- Tier 3: 5 AP

## Algorithm

1. Load recent players for the exact requested hero ID.
2. Convert persisted skill slots `1-4` back to raw ability item IDs.
3. Replay each chronological skill upgrade sequence.
4. Keep valid prefixes when a later observation is invalid.
5. Aggregate transitions by the complete four-skill state.
6. Search the complete state DAG with memoized dynamic programming.
7. Score each full path as the sum of `log(1 + transitionCount)` for all transitions in the path.
8. Select the globally highest-scoring legal path while respecting the AP and action limits.

The global search considers the historical support of every later transition. It does not commit to the locally most popular first action when another branch has stronger support across the complete build.

## API

`GET /deadlock/analysis/heroes/:heroId/skill-build`

Optional query parameter:

- `maxPointBudget`: positive integer up to 36.

The response includes source counts, validation diagnostics, raw ability item IDs, skill slots, action costs, cumulative AP cost, conditional pick rate, sample size, and average observed upgrade time.

## Overwolf UI

The desktop build window renders a full skill route beside the item build. Each step shows cumulative AP, skill slot, unlock or tier, conditional pick rate, and transition sample size.

The in-game overlay renders the same route in a compact four-column panel. Skill data is loaded when the live recommendation snapshot resolves a positive hero ID, cached for the current app session, and discarded when the match or hero is cleared.
