# Full crawler dataset snapshots

Contextual dataset extraction uses every match available at start time when `maxMatches` is omitted. The selected descriptors are persisted in the checkpoint before row extraction, so crawler writes that arrive later cannot change an active run.

The manifest records:

- total matches available when the snapshot was created
- selected match count
- matches excluded by an explicit smoke-test limit
- maximum crawler timestamp inside the selected snapshot
- chronological source window
- descriptor SHA-256

`maxMatches` remains optional for smoke tests and operational diagnostics. Production extraction must omit it. The hard-coded 13,000-match limit is removed.

A new production snapshot should be built after enough crawler growth or a material game patch. Existing artifacts remain immutable and are referenced by SHA-256 from downstream training jobs.
