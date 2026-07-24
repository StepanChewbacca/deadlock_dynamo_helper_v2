# Recommendation Decision Dataset V4 Historical Bootstrap

The historical bootstrap creates a Recommendation Decision Dataset V4 artifact from the held-out Contextual V3 validation split and its independently materialized candidate sets.

It does not write to live recommendation telemetry and it does not represent replayed rows as production decisions.

## Source contract

Default source directories:

```text
/app/apps/api/storage/contextual-v3-training
/app/apps/api/storage/contextual-v3-candidate-evaluation-v2
```

Environment overrides:

```text
DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_TRAINING_DIR
DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_CANDIDATE_DIR
```

The bootstrap requires:

- a completed Contextual V3 training manifest and audit
- a completed candidate-evaluation manifest and audit
- the candidate-evaluation release gate to have passed
- exact SHA-256 matches for validation and candidate artifacts
- equal validation and candidate row counts
- lockstep decision IDs and target action keys

Only the held-out validation split is used. Contextual V3 training rows are excluded from bootstrap rows so candidate construction does not use the same row as both a model-training observation and a bootstrap evaluation observation.

## Output

Default output directory:

```text
/app/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap
```

Environment override:

```text
DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_BOOTSTRAP_OUTPUT_DIR
```

Artifacts:

```text
dataset.ndjson
manifest.json
audit.json
```

Every row is marked with:

```text
datasetSourceKind = HISTORICAL_V3_HELD_OUT_VALIDATION_BOOTSTRAP
```

The output uses the Recommendation Decision Dataset V4 row contract and contains exact-action and outcome-eligible labels.

## Candidate metadata

The Contextual V3 candidate artifact contains action keys and ordering, but not the complete live telemetry score payload. Historical bootstrap rows therefore preserve:

- candidate action keys
- candidate ordering
- candidate policy and limit
- model version and model SHA-256
- whether the observed action was covered by the shortlist

Fields unavailable from the source artifact use deterministic placeholders. The manifest declares:

```text
candidateMetadataAvailability = ACTION_KEYS_AND_RANK_ONLY
```

These placeholders must not be interpreted as historical production scores or probabilities.

## API

Start a build:

```text
POST /deadlock/analysis/recommendation-decision-dataset-v4-historical-bootstrap/start
```

Optional fields:

- `maxRows`
- `expectedValidationSha256`
- `expectedCandidateSha256`

Read status and artifacts:

```text
GET /deadlock/analysis/recommendation-decision-dataset-v4-historical-bootstrap/status
GET /deadlock/analysis/recommendation-decision-dataset-v4-historical-bootstrap/manifest
GET /deadlock/analysis/recommendation-decision-dataset-v4-historical-bootstrap/audit
```

`maxRows` is intended for smoke tests. Production training should use the complete held-out validation artifact.

## Operational order

Run the complete historical bootstrap before redirecting any V4 trainer to this directory. Pin the produced dataset SHA-256 in each training request and keep historical training output directories separate from live-telemetry training output directories. The expected sequence is bootstrap, Behavioral V4, Value V4, then Policy V4 Evaluation.

## Safety

- live telemetry is never modified
- source artifacts are validated before existing bootstrap outputs are cleared
- partial NDJSON is promoted only after a successful lockstep join
- source targets are used only as labels and coverage diagnostics
- outcomes are never used to construct candidate sets
- completing a bootstrap does not start training or change live recommendation serving
