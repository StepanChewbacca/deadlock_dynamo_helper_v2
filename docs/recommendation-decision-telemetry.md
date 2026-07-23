# Recommendation decision telemetry

The live model writes append-only NDJSON telemetry to:

```text
/app/apps/api/storage/recommendation-decision-telemetry/events.ndjson
```

The default directory is inside the `deadlock-storage` Docker volume, so telemetry survives API container recreation and deployment. Override the directory with `DEADLOCK_RECOMMENDATION_TELEMETRY_DIR`.

## Event lifecycle

Each usable live recommendation is persisted as `DECISION_SERVED`. The next
detected inventory transition is linked through `ACTION_OBSERVED`. A decision
replaced by a newer time bucket before an action is marked
`DECISION_SUPERSEDED`. Model failures are recorded as `MODEL_ERROR`.

`RecommendationOutcomeLinkerService` periodically resolves pending decisions
against stored `match_players` rows and appends `MATCH_OUTCOME`. Outcomes may
also be supplied manually through:

```text
POST /deadlock/analysis/recommendation-telemetry/outcome
```

Status is available at:

```text
GET /deadlock/analysis/recommendation-telemetry/status
```

Telemetry is never used as a synchronous dependency of live inference. A
storage failure marks telemetry `DEGRADED` and increments `writeErrorCount`,
while the recommendation request remains model-only.

Matchup percentages are named `contextualPurchaseLiftPercent`. They describe
modelled historical purchase-pattern influence, not win probability or causal
counter effectiveness.
