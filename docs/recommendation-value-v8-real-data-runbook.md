# Recommendation Value V8 real-data pipeline

This runbook executes the offline Recommendation V8 roadmap against the PostgreSQL-derived artifacts already produced by the API. It is fail-closed and stops at the first failed audit or release gate.

It does not enable passive shadow, change the production ranking, or authorize randomized canary.

## Required preparation

1. Deploy the stacked implementation through PR #20 to an environment that has access to the persistent PostgreSQL-derived storage.
2. Confirm the Contextual V3 decision dataset and match timeline artifacts are present in their configured storage directories.
3. Freeze the following values before starting:
   - candidate snapshot ID;
   - candidate generator version;
   - candidate policy version;
   - catalog version ID;
   - candidate policy training window;
   - Dataset V6 tuning boundary;
   - Dataset V6 future-test boundary.
4. Do not move `TUNING_START` or `FUTURE_TEST_START` after seeing model results.
5. `TRAINING_WINDOW_END` must be strictly earlier than every match that can select the exported candidate snapshot.

## Required environment variables

- `API_BASE_URL`
- `SNAPSHOT_ID`
- `CANDIDATE_GENERATOR_VERSION`
- `CANDIDATE_POLICY_VERSION`
- `CATALOG_VERSION_ID`
- `TRAINING_WINDOW_START`
- `TRAINING_WINDOW_END`
- `TUNING_START`
- `FUTURE_TEST_START`

Optional integrity and runtime variables:

- `EXPECTED_SNAPSHOT_SOURCE_SHA256`
- `EXPECTED_V6_MODEL_SHA256`
- `DIAGNOSTIC_MAX_ROWS`, default `10000`
- `REPLAY_PARTITION_COUNT`
- `REPLAY_SNAPSHOT_STALENESS_S`
- `DATASET_DECISION_SNAPSHOT_STALENESS_S`
- `PIPELINE_POLL_INTERVAL_MS`, default `5000`
- `PIPELINE_TIMEOUT_MS`, default `86400000`

## Start the pipeline

Use ISO-8601 UTC timestamps for every temporal boundary.

```bash
API_BASE_URL=https://api.example.com SNAPSHOT_ID=recommendation-policy-2026-07-01 CANDIDATE_GENERATOR_VERSION=RECOMMENDATION_CANDIDATE_GENERATOR_1 CANDIDATE_POLICY_VERSION=RECOMMENDATION_CANDIDATE_POLICY_1 CATALOG_VERSION_ID=123 TRAINING_WINDOW_START=2025-01-01T00:00:00.000Z TRAINING_WINDOW_END=2026-05-31T23:59:59.999Z TUNING_START=2026-06-01T00:00:00.000Z FUTURE_TEST_START=2026-07-01T00:00:00.000Z DIAGNOSTIC_MAX_ROWS=10000 yarn recommendation:v8:real-data
```

Replace the example dates and catalog version with values selected from the actual database coverage before the first run.

## Executed sequence

1. Export or reuse the immutable candidate generator snapshot.
2. Build the full historical replay from PostgreSQL-derived decisions and timelines.
3. Build Dataset V6 with match-level chronological TRAIN, TUNING, and FUTURE_TEST splits.
4. Train Behavioral V5 and require its support gate.
5. Run the bounded Value V8 diagnostic and require candidate sensitivity and permutation gates.
6. Export the frozen V6 short-only baseline without retraining.
7. Run full Value V8 training, TUNING-only selection, and one FUTURE_TEST evaluation.
8. Read passive-shadow status without activating it.

## Fail-closed checks

The runner stops unless all applicable conditions are true:

- historical replay audit passed and the artifact is training eligible;
- `USER_LIVE` was not used;
- observed actions were not injected into candidate sets;
- Dataset V6 audit passed and the artifact is training eligible;
- FUTURE_TEST is not eligible for selection;
- Behavioral V5 release gate passed;
- Value V8 diagnostic gate passed;
- diagnostic recommended full training;
- diagnostic did not train, select, or evaluate on FUTURE_TEST;
- frozen V6 audit passed and `trainingPerformed` is false;
- full Value V8 release gate passed;
- passive shadow was authorized by offline artifacts;
- randomized canary remains unauthorized.

## Expected output

The command prints one final JSON report containing stage states, row counts when exposed by status endpoints, offline release-gate state, passive-shadow authorization, and an explicit confirmation that the runner did not activate shadow.

A successful command means only that the offline pipeline and its gates passed. Passive shadow still requires a separate deployment configuration change. Randomized canary requires separate explicit authorization after the shadow gate reaches at least 1000 matches and 100000 persisted decisions.
