# Offline build evaluation

The offline evaluator measures how well the existing item recommendation graph predicts the next canonical item action in newer historical matches.

It does not claim that the observed player action was objectively optimal. The target is agreement with held-out historical behavior.

## Low-memory execution

The evaluator is designed to run without loading the full historical match window into RAM.

It:

- reads match, player, roster, and item rows directly from the database in bounded batches
- processes one hero at a time
- keeps only the current hero policy and matchup index in memory
- creates a fresh bounded prediction cache for each test batch
- immediately reduces predictions into aggregate metrics
- stores only the requested number of error examples
- aborts before the process exceeds a configurable RSS safety limit

It does not call `RecentMatchesWindowService`, so starting an evaluation does not cause the 10,000-match in-memory window to be loaded.

The Docker Compose defaults are:

- database batch size: `100` matches
- RSS safety limit: `2500 MB`

They can be overridden in `.env`:

```env
DEADLOCK_BUILD_EVALUATION_BATCH_SIZE=100
DEADLOCK_BUILD_EVALUATION_MAX_RSS_MB=2500
```

The RSS limit applies to the entire Node.js API process, not only the evaluator. A server should retain enough free memory for the operating system, database, other containers, and temporary query allocations.

For a server with about 16 GB RAM and several gigabytes available, the Docker Compose defaults are suitable for the full 10,000-match run. Lower the batch size or RSS limit when the status endpoint shows memory pressure or the server hosts other memory-heavy workloads.

The status response includes:

- `memoryMode: LOW_MEMORY_PER_HERO`
- `batchSize`
- `maxRssMb`
- `currentRssMb`
- `peakRssMb`
- `currentHeroId`
- `processedHeroCount`
- `totalHeroCount`

The completed report includes the same execution information under `execution`.

## Checkpoint and recovery

The evaluator writes an atomic checkpoint after every completed hero. A crash while processing a hero repeats only that hero after restart; metrics from earlier completed heroes are restored from the checkpoint.

The final report is written before the checkpoint is removed. Both files use the persistent `deadlock-storage` Docker volume, so API container recreation does not remove them.

Docker Compose defaults:

```env
DEADLOCK_BUILD_EVALUATION_STORAGE_DIR=/app/apps/api/storage/build-evaluation
DEADLOCK_BUILD_EVALUATION_AUTO_RESUME=true
DEADLOCK_BUILD_EVALUATION_DB_RETRY_COUNT=5
DEADLOCK_BUILD_EVALUATION_DB_RETRY_DELAY_MS=500
```

Persistent files:

- `checkpoint.json` - partial aggregate metrics and the index of the next hero
- `report.json` - completed report returned by the report endpoint after API restarts

Starting a new evaluation deletes the previous checkpoint and report. When `DEADLOCK_BUILD_EVALUATION_AUTO_RESUME=true`, API startup automatically resumes a compatible checkpoint. Incompatible checkpoint versions are ignored rather than mixed with a newer evaluator model.

The status response additionally includes:

- `persistenceMode: CHECKPOINT_PER_HERO`
- `storageDirectory`
- `autoResume`
- `resumedFromCheckpoint`
- `checkpointAvailable`
- `databaseRetryCount`
- `databaseRetryDelayMs`

## PostgreSQL resilience

Read-only evaluation queries retry transient PostgreSQL connection failures with exponential backoff. The retry count is the number of retries after the initial attempt.

The application database pool enables TCP keepalive and handles idle pool errors without allowing a temporary connection loss to become an uncaught process-level error.

Docker Compose defaults:

```env
DB_CONNECT_TIMEOUT_MS=10000
DB_POOL_SIZE=10
DB_KEEP_ALIVE_INITIAL_DELAY_MS=10000
DB_IDLE_TIMEOUT_MS=30000
```

Permanent query errors, invalid SQL, schema errors, memory-limit failures, and exhausted transient retries still move the evaluation to `FAILED`.

## Data split

Matches are sorted by start time. The older portion is used for training and the newer portion is used only for evaluation.

The default split is:

- 80% training matches
- 20% test matches
- up to 10,000 recent matches selected directly from the database

A match ID is never present in both sets.

The training set builds:

- the normal hero inventory transition policy
- matchup outcome statistics used by contextual reranking

The test set contributes only observed targets and is never included in either model.

## Metrics

The report contains the same metrics for the baseline and contextual recommenders:

- `coverage` - fraction of held-out steps where at least one legal action was recommended
- `top1Accuracy` - fraction of all held-out steps where the first recommendation matched the observed action
- `top3Accuracy` - fraction of all held-out steps where the observed action appeared in the first three recommendations
- `top1AccuracyWhenCovered` - top-1 accuracy restricted to covered steps
- `top3AccuracyWhenCovered` - top-3 accuracy restricted to covered steps
- exact, backoff, and no-match counts

`REBUY` targets are normalized to `BUY` because the public recommender exposes both as a legal buy action.

The report also includes:

- metrics by hero
- metrics by early, mid, and late game phase
- metrics by hero and phase
- metrics for wins and losses
- counts where contextual reranking improved or worsened the top recommendation
- bounded error examples with state, enemies, actual action, and both ranked outputs

## API

Start a full evaluation:

```bash
curl -X POST http://localhost:3000/deadlock/analysis/build-evaluation/start -H 'Content-Type: application/json' -d '{"trainFraction":0.8,"maxMatches":10000,"errorExampleLimit":100}'
```

The endpoint returns `202 Accepted`. The evaluation runs in the API process without blocking the request.

Check progress and memory:

```bash
curl http://localhost:3000/deadlock/analysis/build-evaluation/status
```

Read the completed report:

```bash
curl http://localhost:3000/deadlock/analysis/build-evaluation/report -o hero-build-offline-evaluation.json
```

The report endpoint returns:

- `409 Conflict` while evaluation is running
- `404 Not Found` before any successful evaluation is available

## Request limits

- `trainFraction`: `0.5` through `0.95`
- `maxMatches`: `2` through `10000`
- `errorExampleLimit`: `0` through `500`

Only one evaluation runs at a time. Calling the start endpoint while a run is active returns the current status instead of starting a second run.

## Interpretation

A higher contextual score means enemy-roster reranking more closely reproduces held-out historical actions. It does not prove that those actions caused a win or that they were optimal.

Useful decisions after the evaluation include:

- ship the baseline graph unchanged
- keep contextual reranking when it improves held-out metrics without materially reducing coverage
- disable or narrow matchup reranking when it changes many recommendations but worsens accuracy
- improve backoff when no-match coverage is too low
- inspect error examples for illegal, overly generic, or poorly timed recommendations
