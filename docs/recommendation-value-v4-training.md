# Recommendation Value V4 Training

Recommendation Value V4 is an offline outcome model trained from Recommendation Decision Dataset V4. It estimates observational win probability conditional on decision-time context and an exact observed action.

It does not estimate causal action uplift and it is not enabled in live serving by this pipeline.

## Source contract

The default source directory is:

```text
/app/apps/api/storage/recommendation-decision-dataset-v4
```

Override it with:

```text
DEADLOCK_RECOMMENDATION_VALUE_V4_SOURCE_DIR
```

The trainer requires a completed V4 `dataset.ndjson`, `manifest.json`, and `audit.json`. The source audit and artifact SHA-256 must match. An optional `expectedSourceSha256` request value can pin one immutable source artifact.

Only rows where both `trainingEligibility.exactAction` and `trainingEligibility.outcome` are true are used. The exact observed action becomes a prospective action feature and `playerWon` is the target.

`playerWon` is a player-and-team-perspective label. Outcome consistency is therefore validated per `(matchId, steamId, teamId)`, while train and validation splitting remains strictly match-level. Historical sources can reuse a player identifier across opposing team perspectives, so opposite labels on different teams are not a conflict. Conflicting labels for the same player and team within one match remain invalid.

## Interpretation

The model estimates:

```text
P(playerWon | decision-time context, action)
```

This is an observational conditional probability. Players do not choose actions randomly, so the score can contain selection bias and unobserved confounding. The output must not be described as causal purchase lift, expected win-rate gain, or proof that choosing one action causes a better outcome.

Causal or policy-value claims require a later offline policy evaluation stage with explicit propensity and overlap diagnostics.

## Leakage policy

Features contain only:

- hero and team
- game time and time bucket
- inventory state at the served decision
- previous observed action history
- allied and enemy rosters
- the action being evaluated

The following are forbidden as features:

- `playerWon`
- outcome objects
- observation-time inventory
- observation timestamps or delays
- served recommendation identity
- candidate scores or alternatives

Matches are split chronologically at match level, so one match cannot appear in both train and validation.

## Model

The model is a hierarchical beta-binomial count estimator with shrinkage. It contains:

- global outcome counts
- hero counts
- hero/time-bucket counts
- hero/time/action counts
- inventory/action counts
- previous-action-tail/action counts
- ally/action counts
- enemy/action counts

Sparse contexts fall back toward broader contexts according to `priorStrength` and `minContextObservations`.

## Evaluation

Validation compares:

- global train win-rate baseline
- hero/time-bucket baseline
- action-conditioned Value V4 model

Reported metrics include:

- log loss
- Brier score
- accuracy
- ROC AUC
- average prediction and observed win rate
- expected and maximum calibration error

The release gate requires:

- at least 100 validation decisions
- at least 20 validation matches
- both wins and losses
- at least 0.001 log-loss improvement over the best baseline
- no Brier-score regression against the best baseline
- ROC AUC of at least 0.52
- expected calibration error no greater than 0.15

A failed gate preserves artifacts but blocks policy-selection use.

## Persistence

The default output directory is:

```text
/app/apps/api/storage/recommendation-value-v4-training
```

Override it with:

```text
DEADLOCK_RECOMMENDATION_VALUE_V4_TRAINING_DIR
```

A completed run writes:

- `train.ndjson`
- `validation.ndjson`
- `prediction-evaluation.ndjson`
- `model.json`
- `evaluation.json`
- `audit.json`
- `manifest.json`

The Docker deployment stores the source and output directories on the persistent `deadlock-storage` volume.

## API

Start training:

```text
POST /deadlock/analysis/recommendation-value-v4-training/start
```

Optional request fields:

- `trainFraction`
- `priorStrength`
- `minContextObservations`
- `calibrationBinCount`
- `expectedSourceSha256`

Read status and artifacts:

```text
GET /deadlock/analysis/recommendation-value-v4-training/status
GET /deadlock/analysis/recommendation-value-v4-training/manifest
GET /deadlock/analysis/recommendation-value-v4-training/audit
GET /deadlock/analysis/recommendation-value-v4-training/evaluation
GET /deadlock/analysis/recommendation-value-v4-training/model
```

Only one run can execute at a time. Completing a run does not switch production recommendation serving.

## Operational sequence

1. Rebuild Recommendation Decision Dataset V4 and confirm its audit passed.
2. Verify that the source contains enough `outcomeEligible` rows and matches for a meaningful chronological validation split.
3. Start Value V4 training with the source SHA-256 pinned when reproducibility is required.
4. Wait for the training status to become `COMPLETE` or `FAILED`.
5. Inspect the value-model audit, class balance, log loss, Brier score, ROC AUC, and calibration report.
6. Treat a failed release gate as a hard block for policy-selection experiments.
7. Even after a passed gate, do not use score differences as causal action uplift. The next stage must perform offline policy evaluation with propensity, overlap, and effective-sample-size diagnostics before any shadow rollout.
