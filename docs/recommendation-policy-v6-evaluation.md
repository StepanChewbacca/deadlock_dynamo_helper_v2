# Recommendation Policy V6 evaluation

Recommendation Policy V6 is an offline-only policy evaluation layer for Recommendation Value V6. It estimates how a stochastic advantage-tilted policy would have performed on held-out decisions without enabling live serving.

## Inputs

The evaluator joins artifacts by `decisionId`:

- `recommendation-behavioral-v4-training/validation.ndjson`;
- `recommendation-behavioral-v4-training/model.json`;
- `recommendation-value-v6-training/prediction-evaluation.ndjson`;
- `recommendation-value-v6-training/model.json`.

Behavioral V4 supplies an estimated player-action policy. Value V6 supplies bounded target utility, action utility, action advantage, candidate actions, and equal-total-per-match weights from the untouched chronological test split.

All source hashes are checked against their manifests before evaluation starts.

## Policies

The estimated behavior policy is:

```text
softmax(behavioralScore / behaviorTemperature)
```

The target policy is:

```text
softmax(
  (behavioralScore + targetAdvantageWeight * actionAdvantage)
  / targetTemperature
)
```

Only candidate actions recorded at decision time are evaluated.

## Support and overlap

A decision is excluded when:

- no matching Behavioral V4 validation row exists;
- match or observed action identity does not agree;
- a Value V6 candidate is absent from the recorded behavioral candidate set;
- the observed action is absent from the candidate set;
- policy values are non-finite;
- estimated behavior probability is below `minBehaviorProbability`.

Raw importance weights are clipped at `maxImportanceWeight`. Decision-level exclusions and candidate probabilities are written to `decision-evaluation.ndjson`.

## Estimators

The evaluator reports:

- observed weighted utility;
- clipped inverse propensity score;
- clipped self-normalized inverse propensity score;
- direct method;
- clipped doubly robust value;
- effective sample size and effective sample size ratio.

The reward is the bounded Value V6 `targetUtility`. The direct model is the Value V6 `actionUtility`.

For one decision, the doubly robust contribution is:

```text
directValue
+ clippedImportanceWeight * (targetUtility - observedActionUtility)
```

## Match balancing

The evaluator preserves Value V6 `matchWeight`. Decisions from one match therefore sum to approximately one unit of evaluation weight regardless of match length.

Confidence intervals use seeded bootstrap resampling of complete matches, not individual decisions.

## Output artifacts

The output directory contains:

- `decision-evaluation.ndjson`;
- `match-summary.ndjson`;
- `evaluation.json`;
- `audit.json`;
- `manifest.json`.

## API

Base route:

```text
/deadlock/analysis/recommendation-policy-v6-evaluation
```

Endpoints:

- `POST /start`;
- `GET /status`;
- `GET /manifest`;
- `GET /audit`;
- `GET /evaluation`.

## Safety

Historical logging propensities are not available. Behavioral propensities are estimated from Behavioral V4, and Value V6 is observational. IPS, SNIPS, direct-method, and doubly robust values are diagnostic and must not be interpreted as causal uplift.

The release gate can authorize only additional offline or shadow evaluation. Production rollout remains forbidden.
