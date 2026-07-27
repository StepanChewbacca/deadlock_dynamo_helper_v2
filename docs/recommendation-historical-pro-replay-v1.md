# Recommendation Historical Pro Replay V1

The replay contract converts a pre-action professional match decision into a candidate-set training row without using user runtime telemetry.

## Data source

Every row is hard-coded as:

```text
PRO_HISTORICAL
```

`USER_LIVE` and `PRO_FUTURE_HOLDOUT` are rejected by the provenance contract for training artifacts.

## Candidate generator snapshots

A replay row references an immutable generator snapshot containing:

- snapshot ID
- candidate generator version
- policy version and SHA-256
- catalog version and SHA-256
- policy training window

The snapshot training window must end strictly before the replay match starts. This prevents the observed action from teaching the candidate generator that is used to reconstruct its own candidate set.

For a larger corpus, multiple chronological generator snapshots may be used. Each decision must select a snapshot trained only on earlier matches.

## Honest candidate coverage

The candidate set is exactly the deduplicated, deterministic output of the frozen generator.

The observed action is never appended to the candidate set.

When the observed action is outside the candidate set:

- the row may remain eligible for the state model when a complete short-horizon outcome exists
- the row is not eligible for Behavioral V5
- the row is not eligible for the Value V8 action model
- the case is counted in observed-action candidate coverage

## Feature cutoff

Replay state includes only pre-action fields:

- inventory before the action
- previous actions
- build prefix
- allied heroes
- enemy heroes
- hero, team, phase, and decision time

Inventory after the action, future snapshots, the observed action, and outcomes are not state features.

## Candidate metadata

Each generated candidate is joined to the immutable historical catalog snapshot. Missing catalog metadata is explicit and makes the row ineligible for Behavioral and action-model training.

## Audit gates

Default gates:

```text
Timeline coverage >= 99%
Candidate metadata coverage >= 99.9%
Observed action in candidate set >= 99%
Duplicate decision IDs = 0
Generator snapshot leakage = 0
Non-deterministic candidate ordering = 0
USER_LIVE rows = 0
```

These gates belong to the replay artifact. The later Pro Decision Dataset V6 builder may add stronger feature and split audits.
