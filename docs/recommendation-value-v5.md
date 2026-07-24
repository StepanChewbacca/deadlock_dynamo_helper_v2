# Recommendation Value V5

Recommendation Value V5 is an offline observational win-probability pipeline over Recommendation Decision Dataset V4. It is intentionally isolated from live serving.

## Data split

The pipeline uses a deterministic chronological match-level split:

- oldest 70% for training;
- next 15% for tuning;
- newest 15% as an untouched test set.

No match may appear in more than one split. The complete chronological descriptor list is hashed and persisted in the audit and manifest.

## Match balancing

Every outcome-eligible match contributes total weight 1 regardless of its number of decisions. Each row receives weight `1 / eligibleDecisionCountForMatch`.

This prevents long matches and high-frequency decision sequences from dominating training, tuning, or test metrics.

## Model structure

The model separates:

- `V(state)`: observational state win probability from decision-time hero, time, team, inventory, previous-action, ally, and enemy contexts;
- `A(state, action)`: a bounded action-conditioned logit residual from action-specific versions of those contexts.

The action residual scale is selected only on the tuning split. The untouched test split is evaluated after selection and is never used to choose model settings.

## API

Start training:

```http
POST /deadlock/analysis/recommendation-value-v5-training/start
```

Example body:

```json
{
  "trainFraction": 0.7,
  "tuningFraction": 0.15,
  "statePriorStrength": 100,
  "actionPriorStrength": 100,
  "minimumEffectiveObservations": 20,
  "maximumAbsoluteStateLogitResidual": 1.5,
  "maximumAbsoluteActionLogitResidual": 1.5,
  "actionResidualScales": [0, 0.25, 0.5, 0.75, 1],
  "expectedSourceSha256": "<Recommendation Dataset V4 SHA-256>"
}
```

Read status and completed artifacts:

```http
GET /deadlock/analysis/recommendation-value-v5-training/status
GET /deadlock/analysis/recommendation-value-v5-training/manifest
GET /deadlock/analysis/recommendation-value-v5-training/audit
GET /deadlock/analysis/recommendation-value-v5-training/evaluation
GET /deadlock/analysis/recommendation-value-v5-training/model
```

## Storage

Default source directory:

```text
/app/apps/api/storage/recommendation-decision-dataset-v4
```

Default output directory:

```text
/app/apps/api/storage/recommendation-value-v5-training
```

Environment overrides:

```text
DEADLOCK_RECOMMENDATION_VALUE_V5_SOURCE_DIR
DEADLOCK_RECOMMENDATION_VALUE_V5_TRAINING_DIR
```

Generated artifacts:

- `model.json`;
- `evaluation.json`;
- `audit.json`;
- `manifest.json`;
- `prediction-evaluation.ndjson` for the untouched test split.

The source dataset is streamed four times. Training, tuning, and test copies are not duplicated on disk.

## Release gate

The offline release gate requires:

- at least 100 untouched test matches;
- both winning and losing outcomes;
- a non-zero action residual scale selected on tuning data;
- at least `0.0005` weighted log-loss improvement over state-only prediction;
- no degradation in weighted Brier score;
- at least 50% weighted action-context support coverage.

Passing the gate does not authorize live rollout. It only permits the model to be used as an offline policy-evaluation input and as evidence for further controlled validation.

## Safety and interpretation

The model predicts observational player win probability. It is not a causal treatment-effect model, and action residuals must not be interpreted as proof that an action causes a win.

Value V5 does not change live serving. Production rollout requires separate policy evaluation and explicit release approval.
