# Recommendation Dataset V5

`RECOMMENDATION_DECISION_DATASET_V5_3` enriches Recommendation Dataset V4 decisions with build trajectory, item catalog, recipe, fresh team-economy state, and bounded post-decision outcomes.

## Timeline source

The API runs the open-source `ghcr.io/deadlock-api/deadlock-live-events:latest` sidecar and records named SSE events for active matches.

Artifacts are written under `DEADLOCK_TIMELINE_STORAGE_DIR/<matchId>/`:

- `events.ndjson` - immutable raw events
- `player-snapshots.ndjson` - merged player-controller snapshots
- `objective-events.ndjson` - objective deletion events
- `checkpoint.json` - resumable collector state
- `manifest.json` and `audit.json` - source and integrity metadata

A timeline passes audit only after the stream emits its terminal `end` event. Stopped, failed, or interrupted streams remain unavailable to Dataset V5.

A short-horizon value is never reconstructed from final match statistics. When no audited timeline exists, the corresponding target remains unavailable.

## Leakage boundary

For a decision at game time `t`:

- input state uses only player snapshots at or before `t`;
- team economy uses the latest fresh snapshot per player at or before `t`, split into the player's team and the opposing team;
- the 3, 5, and 10 minute targets use snapshots in `(t, t + horizon]` and require a snapshot no more than `snapshotStalenessS` before the exact horizon boundary;
- the final match result is an auxiliary target only;
- future actions are not used to reconstruct the candidate set.

## Team economy

Each row may include `stateBeforeAction.teamEconomy` with:

- own-team and enemy-team total, average, highest, and lowest net worth;
- absolute and relative team net-worth delta;
- the player's share of team net worth;
- the player's net-worth rank inside the team;
- fresh and stale snapshot counts plus team coverage diagnostics.

The feature is unavailable unless at least one fresh snapshot exists for both teams. Future snapshots are never used.

## Build

Start the explicit offline build through:

```text
POST /deadlock/analysis/recommendation-decision-dataset-v5/start
```

Inspect:

```text
GET /deadlock/analysis/recommendation-decision-dataset-v5/status
GET /deadlock/analysis/recommendation-decision-dataset-v5/manifest
GET /deadlock/analysis/recommendation-decision-dataset-v5/audit
GET /deadlock/analysis/recommendation-decision-dataset-v5/source-availability
```

The builder verifies the Dataset V4 SHA-256, partitions deterministically by player trajectory, checkpoints after every partition, and publishes the final NDJSON artifact atomically.
