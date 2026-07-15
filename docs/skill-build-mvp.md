# Skill Build MVP

The skill build model uses match data from the existing rolling 14-day recent match window.

## Rules

- Unlock: 1 AP
- Tier 1: 1 AP
- Tier 2: 2 AP
- Tier 3: 5 AP

## Algorithm

1. Load recent players for the requested hero and its configured aliases.
2. Map ability IDs to skill slots.
3. Replay each chronological skill upgrade sequence.
4. Keep valid prefixes when a later observation is invalid.
5. Aggregate transitions by the complete four-skill state.
6. Traverse the most frequently observed transition from each state while respecting the AP budget.

## API

`GET /deadlock/analysis/heroes/:heroId/skill-build`

Optional query parameter:

- `maxPointBudget`: positive integer up to 36.

The response includes source counts, validation diagnostics, action costs, cumulative AP cost, conditional pick rate, sample size, and average observed upgrade time.
