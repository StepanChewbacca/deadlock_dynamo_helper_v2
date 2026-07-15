# Skill Build MVP

The skill build model uses match data from the existing rolling 14-day recent match window.

## Stored data format

The crawler converts raw ability item IDs to skill slot numbers before persistence. Therefore, `match_player_skill_upgrades.abilityId` currently contains values `1-4`, despite the legacy field name.

The analysis service replays these persisted slot identifiers directly and uses the hero ability map only to confirm that the requested hero is supported.

## Rules

- Unlock: 1 AP
- Tier 1: 1 AP
- Tier 2: 2 AP
- Tier 3: 5 AP

## Algorithm

1. Load recent players for the exact requested hero ID.
2. Interpret persisted ability IDs as skill slots `1-4`.
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

The response includes source counts, validation diagnostics, action costs, cumulative AP cost, conditional pick rate, sample size, and average observed upgrade time.
