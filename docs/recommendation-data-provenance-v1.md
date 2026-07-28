# Recommendation Data Provenance V1

The pro recommendation pipeline accepts three explicit sources:

```text
PRO_HISTORICAL
PRO_FUTURE_HOLDOUT
USER_LIVE
```

## Source responsibilities

### PRO_HISTORICAL

Allowed for:

- Behavioral training
- Value training
- model selection
- calibration
- observational OPE

Not allowed for the final untouched test purpose.

### PRO_FUTURE_HOLDOUT

Allowed only for:

- final untouched test
- final observational OPE

Not allowed for:

- feature engineering
- Behavioral training
- Value training
- model selection
- calibration

### USER_LIVE

Allowed only for runtime evaluation and telemetry.

It is forbidden for:

- Behavioral training
- Value training
- model selection
- calibration
- test
- pro OPE

## Fail-closed behavior

- Unknown source strings are rejected.
- Eligibility is defined by an explicit allowlist per source and purpose.
- Artifact builders validate complete source counters before producing an artifact.
- Any `USER_LIVE` row in a pro-model artifact is a hard failure.
- Negative, fractional, or non-finite source counters are rejected.
- The client cannot label its own data as pro data. The source is derived from a trusted server ingestion path.

## Relationship to model experiments

This contract is independent of Dataset V5.3. Dataset V5.3 remains lineage for completed V6/V7 experiments. New pro replay and future model artifacts must use this provenance contract directly.
