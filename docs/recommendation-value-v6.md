# Recommendation Value V6

Recommendation Value V6 is an offline-only, match-balanced state/action advantage model trained from immutable `RECOMMENDATION_DECISION_DATASET_V5_2` artifacts.

## Target

The model estimates a bounded utility in `[-1, 1]`:

- final match outcome is an auxiliary long-horizon target;
- exact 3, 5, and 10 minute timeline outcomes contribute only when the Dataset V5 availability flag is true;
- unavailable timeline outcomes are never inferred from final match statistics;
- state value and action advantage are represented separately.

The short-horizon utility uses survival, net-worth delta, hero-damage delta, kill participation, and own/enemy objective losses. The final and short-horizon components are weighted independently and recorded in the training manifest.

## Features

The bounded feature families include:

- hero, time bucket, and build stage;
- recent trajectory actions;
- allied and enemy hero interactions;
- fresh pre-decision KDA, level, and net-worth buckets;
- inventory cost, item count, tier, and slot profile;
- item tier, slot, type, hero-item, ally-item, and enemy-item interactions;
- incomplete recipe progress and distance to the next power spike.

Raw future actions and post-decision timeline values are never input features.

## Training

Start training:

```text
POST /deadlock/analysis/recommendation-value-v6-training/start
```

Inspect artifacts:

```text
GET /deadlock/analysis/recommendation-value-v6-training/status
GET /deadlock/analysis/recommendation-value-v6-training/manifest
GET /deadlock/analysis/recommendation-value-v6-training/audit
GET /deadlock/analysis/recommendation-value-v6-training/evaluation
GET /deadlock/analysis/recommendation-value-v6-training/model
```

Training uses chronological match-level 70/15/15 splits, equal total weight per match, tuning-only action residual scale selection, untouched test evaluation, per-hero diagnostics, and deterministic match bootstrap confidence intervals.

## Safety

Recommendation Value V6 remains observational. Historical observed-action ranking agreement is not a causal counterfactual label. Production rollout is always forbidden by this pipeline until a fresh chronological holdout and randomized evaluation pass.
