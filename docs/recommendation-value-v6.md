# Recommendation Value V6

Recommendation Value V6 is an offline-only state/action advantage ranker built from immutable Recommendation Dataset V5.3 artifacts.

It changes the modelling question from "did this purchase independently change final win probability?" to "which available purchase is better in this exact state?".

## Scope

Value V6 provides:

- chronological match-level train, tuning, and untouched test splits;
- equal total weight per match;
- a state utility estimate;
- an action-conditioned utility estimate;
- action advantage as the difference between action and state utility;
- item, trajectory, inventory, matchup, timeline, and team-economy state keys;
- a bounded target combining short-horizon utility with final outcome as an auxiliary target;
- tuning-only action-advantage scale selection;
- candidate ranking diagnostics;
- persistent model, evaluation, audit, manifest, and prediction artifacts.

Value V6 remains observational. Training completion never changes live serving and never authorizes production rollout.

## Source contract

The source directory must contain a completed Dataset V5.3 build:

```text
/app/apps/api/storage/recommendation-decision-dataset-v5/
  dataset.ndjson
  manifest.json
  audit.json
```

The trainer verifies:

- `datasetVersion` equals `RECOMMENDATION_DECISION_DATASET_V5_3`;
- the source audit passed;
- the manifest SHA-256 matches `dataset.ndjson`;
- an optional operator-provided expected SHA-256 matches;
- eligible decision IDs are unique;
- chronological splits do not overlap.

Environment overrides:

```text
DEADLOCK_RECOMMENDATION_VALUE_V6_SOURCE_DIR
DEADLOCK_RECOMMENDATION_VALUE_V6_TRAINING_DIR
```

## Target construction

Each eligible decision requires:

- one exact observed action;
- an available, non-conflicting final outcome;
- the observed action in the recorded candidate set.

Available 3, 5, and 10 minute windows contribute a bounded local utility from:

- kills, assists, deaths, and kill participation;
- net-worth change;
- hero-damage change;
- survival;
- own and enemy objective losses.

The default target uses 25% final outcome and 75% short-horizon utility. If no short-horizon target is available, final outcome is used alone. Future timeline values are targets only and are never state or action features.

Fresh decision-time team economy is used as context. Value V6 buckets relative team net-worth delta into `FAR_BEHIND`, `BEHIND`, `EVEN`, `AHEAD`, and `FAR_AHEAD`, and learns both state effects and economy-conditioned action/category effects.

## API

Base path:

```text
/deadlock/analysis/recommendation-value-v6-training
```

Endpoints:

```text
POST /start
GET  /status
GET  /manifest
GET  /audit
GET  /evaluation
GET  /model
```

Example start payload:

```json
{
  "trainFraction": 0.7,
  "tuningFraction": 0.15,
  "statePriorStrength": 100,
  "actionPriorStrength": 100,
  "minimumObservations": 20,
  "maximumAbsoluteStateResidual": 1,
  "maximumAbsoluteActionResidual": 1,
  "actionResidualScales": [0, 0.25, 0.5, 0.75, 1],
  "finalOutcomeWeight": 0.25,
  "expectedSourceSha256": "<64-character SHA-256>"
}
```

## Evaluation

The untouched test report includes:

- state and action RMSE and MAE;
- global win log-loss and Brier score as safety metrics;
- state and action support coverage;
- observed-action Top-1 agreement and MRR;
- pairwise observed-action accuracy;
- observed-action NDCG;
- average observed-action regret;
- confident top-two separation rate;
- short-horizon target coverage.

Observed-action ranking metrics are behavioral diagnostics, not causal proof that the historical action was optimal.

## Release gate

The initial V6 gate requires:

- at least 100 untouched test matches;
- a non-zero tuned action scale;
- no utility RMSE degradation against the state-only estimate;
- no win log-loss degradation worse than 0.001;
- at least 30% action-context weighted support;
- at least 20% short-horizon target coverage;
- at least 50% candidate sets with two or more actions;
- at least one confidently separated top-two recommendation.

A passing gate permits only additional offline and shadow evaluation. It does not permit live rollout.

## Next causal-evaluation layer

Behavioral V4 propensity estimates and doubly robust policy evaluation are intentionally kept as a separate follow-up stage. That stage must add overlap filtering, clipping, effective sample-size diagnostics, match-level bootstrap confidence intervals, and explicit rollout prohibition.
