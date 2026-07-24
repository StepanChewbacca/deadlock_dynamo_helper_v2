# Recommendation Behavioral V4 Training

Recommendation Behavioral V4 learns the observed exact next action from Recommendation Decision Dataset V4. It is an offline training and validation pipeline. Completing a run does not enable the model in live serving.

## Source contract

The default source directory is:

```text
/app/apps/api/storage/recommendation-decision-dataset-v4
```

Override it with:

```text
DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_SOURCE_DIR
```

The trainer requires a completed V4 `dataset.ndjson`, `manifest.json`, and `audit.json`. The source audit must pass, the dataset SHA-256 must match the source manifest, and an optional `expectedSourceSha256` request value can pin a specific immutable source artifact.

Only rows where `trainingEligibility.exactAction` is true are used. Multi-action, ambiguous, unresolved, superseded, duplicate, and missing-observation rows remain in the source dataset but are excluded from behavioral training.

## Leakage policy

Features are limited to information available at `DECISION_SERVED_TIME`:

- hero, team, game time, and time bucket
- current inventory state
- previous observed action history
- allied and enemy rosters
- recommendation model metadata
- served action and the recorded candidate set

The observed action is the target. Observation-time inventory, observation timestamp, and match outcome are not model features. An eligible outcome label is retained in prepared artifacts for the later value-model stage but is not used to fit the behavioral model.

## Split and evaluation

Matches are sorted by their first served-decision timestamp and split chronologically at match level. A match cannot appear in both train and validation.

Validation compares:

- the action served by the production model
- a hero/time-bucket frequency baseline
- the contextual Behavioral V4 ranker

All rankings use only candidate actions recorded at decision time. The trainer never reconstructs a newer candidate set from the current item catalog.

The release gate requires:

- at least 50 validation decisions
- at least 90% recorded candidate coverage
- at least 0.50 percentage-point Top-1 improvement over the best baseline
- no more than 0.50 percentage-point Top-3 regression
- non-negative mean reciprocal rank improvement

A failed release gate does not delete artifacts, but the model must not be enabled for production serving.

## Persistence

The default output directory is:

```text
/app/apps/api/storage/recommendation-behavioral-v4-training
```

Override it with:

```text
DEADLOCK_RECOMMENDATION_BEHAVIORAL_V4_TRAINING_DIR
```

The Docker deployment stores source and output directories on the persistent `deadlock-storage` volume.

A completed run writes:

- `train.ndjson`
- `validation.ndjson`
- `candidate-evaluation.ndjson`
- `model.json`
- `evaluation.json`
- `audit.json`
- `manifest.json`

NDJSON files are written to partial files and renamed after their pass completes. JSON artifacts are replaced atomically.

## API

Start training:

```text
POST /deadlock/analysis/recommendation-behavioral-v4-training/start
```

Optional request fields:

- `trainFraction`
- `smoothing`
- `minContextObservations`
- `maxCandidateActions`
- `expectedSourceSha256`

Read artifacts and status:

```text
GET /deadlock/analysis/recommendation-behavioral-v4-training/status
GET /deadlock/analysis/recommendation-behavioral-v4-training/manifest
GET /deadlock/analysis/recommendation-behavioral-v4-training/audit
GET /deadlock/analysis/recommendation-behavioral-v4-training/evaluation
GET /deadlock/analysis/recommendation-behavioral-v4-training/model
```

Only one run can execute at a time. Existing completed artifacts remain readable until a new run passes source validation and starts replacing outputs.
