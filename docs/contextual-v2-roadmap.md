# Contextual recommendation V2

## Current decision

The production recommendation endpoint returns the validated baseline transition-policy ranking.
Contextual V2 runs only in bounded asynchronous shadow mode until it passes the frozen chronological final test.

The original 10,000-match chronological holdout established the control result:

- model: `HERO_BUILD_CHRONOLOGICAL_HOLDOUT_V1`
- report SHA-256: `e6a9e267e2d37c34ff16bc6740559c0d7f722ea04ffd19d3b13c74d30dc63017`
- coverage: `89.5678%`
- baseline top-1: `28.9761%`
- baseline top-3: `43.7003%`
- old win-odds contextual top-1 delta: `-0.2387` percentage points
- old win-odds contextual top-3 delta: `-1.4682` percentage points

The old win-odds contextual reranker is not used by production or the V2 evaluator.

## Contextual V2 model

Contextual V2 predicts the observed next action rather than match outcome.
It estimates action-selection interactions at three hierarchical levels:

- hero
- hero and phase
- hero, phase, and exact inventory state

Sparse lower-level estimates are shrunk toward broader priors. Evidence from the complete enemy roster is averaged, including negative and missing evidence, rather than selecting the single strongest enemy signal.

Safety constraints:

- candidate pool is restricted to baseline top-5
- candidates are never inserted from an expanded nearby-state pool
- baseline top-3 membership is preserved
- a candidate can move up by at most one position
- contextual logit bonuses are bounded
- production responses never wait for shadow evaluation

Production shadow configuration:

```env
DEADLOCK_CONTEXTUAL_SHADOW_ENABLED=true
DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE=0.1
DEADLOCK_CONTEXTUAL_SHADOW_MAX_IN_FLIGHT=2
DEADLOCK_CONTEXTUAL_V2_MIN_ACTION_OBSERVATIONS=50
DEADLOCK_CONTEXTUAL_V2_MIN_CONTEXT_OBSERVATIONS=100
DEADLOCK_CONTEXTUAL_V2_SHRINKAGE_STRENGTH=100
DEADLOCK_CONTEXTUAL_V2_LAMBDA=0.05
DEADLOCK_CONTEXTUAL_V2_MAX_LOGIT_BONUS=0.1
```

Shadow records use the event name `hero_build_contextual_v2_shadow`.

## Persistent evaluator V2

The V2 evaluator is separate from the preserved V1 evaluator and stores artifacts under:

```text
/app/apps/api/storage/build-evaluation-v2
```

Endpoints:

- `POST /deadlock/analysis/build-evaluation-v2/start`
- `GET /deadlock/analysis/build-evaluation-v2/status`
- `GET /deadlock/analysis/build-evaluation-v2/validation-report`
- `GET /deadlock/analysis/build-evaluation-v2/selection`
- `GET /deadlock/analysis/build-evaluation-v2/final-report`

The evaluator uses a chronological split:

- 70% training
- 15% validation
- 15% untouched final test

Validation and final testing are intentionally separate operations.

### Validation-only operation

`VALIDATION_ONLY` trains each hero model using only the training descriptors and compares the fixed hyperparameter grid using only validation descriptors. Final-test rows are not loaded or scored.

After validation, the evaluator writes:

- `validation-report.json`
- `selection.json`

The selection artifact freezes:

- exact train, validation, and final-test match descriptors
- selected configuration
- source window version
- hero list
- evaluator options

The baseline-control configuration is never selectable. A contextual configuration must have positive validation top-1, non-negative validation top-3, acceptable coverage, and more paired improvements than regressions.

When no configuration passes validation safety criteria, `selectedConfig` is absent and final-test execution remains locked.

### Untouched final-test operation

`FINAL_TEST` requires a frozen non-control selection. It retrains on the same frozen training descriptors and evaluates only the frozen final-test descriptors.

A persisted final report prevents accidental repeated final-test inspection. Starting a new validation experiment explicitly clears the previous V2 selection and final report.

The default cutoff is:

```env
DEADLOCK_BUILD_EVALUATION_V2_FINAL_TEST_NOT_BEFORE=2026-07-17T11:46:14.000Z
```

The first reserved final-test match must be newer than that timestamp because the earlier July 2026 holdout was already inspected. When the cutoff fails, collect more matches or reduce `maxMatches` so the newest 15% contains only unseen matches.

## Statistical report

Both validation and final-test reports include:

- baseline and contextual coverage, top-1, and top-3
- paired improvement and regression counts
- match-clustered bootstrap confidence intervals
- McNemar diagnostics
- phase breakdowns
- hero breakdowns
- Benjamini-Hochberg adjusted hero p-values
- bounded changed-prediction diagnostics

Match clustering prevents many steps from the same match from being treated as independent bootstrap samples.

## Final release gates

A frozen candidate passes only when the untouched final test satisfies every gate:

- overall top-1 delta at least `+0.10` percentage points
- clustered 95% top-1 lower bound above zero
- overall top-3 delta non-negative
- clustered 95% top-3 lower bound no lower than `-0.05` points
- coverage delta no lower than `-0.05` points
- paired top-1 improvements greater than regressions
- no phase worse than `-0.20` top-1 points
- no large hero segment worse than `-0.50` top-1 points

A failed final test keeps production on baseline. A passed final test permits a later controlled rollout PR, but does not automatically change the production response.

## Persistence and recovery

The V2 evaluator:

- streams database rows in bounded batches
- retries transient PostgreSQL failures
- saves a durable checkpoint after every completed hero
- resumes automatically after API restart
- persists validation, selection, and final reports in the Docker volume
- enforces the configured RSS safety limit

Configuration:

```env
DEADLOCK_BUILD_EVALUATION_V2_STORAGE_DIR=/app/apps/api/storage/build-evaluation-v2
DEADLOCK_BUILD_EVALUATION_V2_AUTO_RESUME=true
```
