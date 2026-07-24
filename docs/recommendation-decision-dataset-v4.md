# Recommendation Decision Dataset V4

Recommendation Decision Dataset V4 materializes the append-only live recommendation telemetry log into one deterministic NDJSON row per served decision.

## Source

The builder reads the telemetry event log configured by `DEADLOCK_RECOMMENDATION_TELEMETRY_DIR`. It joins:

- `DECISION_SERVED` by `decisionId`
- `ACTION_OBSERVED` by `decisionId`
- `DECISION_SUPERSEDED` by `decisionId`
- `MATCH_OUTCOME` by `matchId`, `steamId`, and `heroId`

`MODEL_ERROR` events are counted by the audit but do not create dataset rows.

## Training eligibility

A row is exact-action eligible only when all of the following are true:

- exactly one observation event exists for the decision
- reconstruction confidence is `EXACT_SINGLE_ACTION`
- the observation contains exactly one non-empty action key
- the decision ID is not duplicated
- the decision was not superseded

A row is outcome eligible only when it is exact-action eligible and has one non-conflicting match outcome.

Multi-action, ambiguous, unresolved, missing, duplicate, superseded, and conflicting records remain in the dataset with explicit exclusion reasons. They are not silently converted into exact labels.

## Persistence

The default output directory is:

```text
/app/apps/api/storage/recommendation-decision-dataset-v4
```

Override it with:

```text
DEADLOCK_RECOMMENDATION_DECISION_DATASET_V4_DIR
```

The Docker deployment stores the directory on the persistent `deadlock-storage` volume.

A build writes:

- `dataset.ndjson`
- `manifest.json`
- `audit.json`

The dataset is written to a partial file and renamed only after materialization completes. Manifest and audit JSON files are also replaced atomically.

## API

Start a full rebuild:

```text
POST /deadlock/analysis/recommendation-decision-dataset-v4/start
```

Read build status:

```text
GET /deadlock/analysis/recommendation-decision-dataset-v4/status
```

Read the completed manifest:

```text
GET /deadlock/analysis/recommendation-decision-dataset-v4/manifest
```

Read the completed audit:

```text
GET /deadlock/analysis/recommendation-decision-dataset-v4/audit
```

Only one build can run at a time. Rebuilding always reads the current complete telemetry log and replaces the previous V4 artifact.

## Audit policy

The audit fails when there are no decision rows, invalid telemetry lines, duplicate event IDs, or duplicate decision IDs. Orphan lifecycle events and conflicting outcomes are reported as warnings and excluded from eligible training subsets.
