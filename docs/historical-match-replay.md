# Historical match metadata replay

The historical replay pipeline upgrades stored raw match metadata without modifying the original JSON payload.

## Pipeline

For each selected latest raw metadata row per match, the replay pipeline:

1. extracts canonical metadata fields and source paths;
2. stores the normalization version and diagnostics;
3. forcibly recalculates the ruleset against the current ruleset configuration;
4. reprocesses the match, players, purchased items, and skill upgrades;
5. uses the resolved versioned item catalog when one is available;
6. falls back to the legacy `items` table when the ruleset or catalog is unknown;
7. records the processing version and timestamp.

Current versions:

- normalization: `raw-match-metadata-v2`
- processing: `match-metadata-v2`

## API

### Status

```bash
curl -s http://localhost:3000/deadlock/analysis/raw-matches/replay/status | jq
```

### Normalize historical raw rows

```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"limit":100,"afterId":0,"resolveRuleset":true}' http://localhost:3000/deadlock/analysis/raw-matches/metadata/normalize-pending | jq
```

Use `nextAfterId` as the next cursor while `hasMore` is true.

### Replay historical matches

```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"limit":25,"afterMatchId":0,"resolveRuleset":true}' http://localhost:3000/deadlock/analysis/raw-matches/replay-pending | jq
```

Use `nextAfterMatchId` as the next cursor while `hasMore` is true. The endpoint processes only the latest raw metadata row for each match. Rows already on the current normalization and processing versions are skipped unless `force` is true.

### Normalize one match

```bash
curl -s -X POST http://localhost:3000/deadlock/analysis/raw-matches/91825430/normalize | jq
```

### Reprocess one match

```bash
curl -s -X POST http://localhost:3000/deadlock/analysis/raw-matches/91825430/reprocess | jq
```

## Deployment verification

Run migrations through the normal deployment process, then check status:

```bash
curl -s http://localhost:3000/deadlock/analysis/raw-matches/replay/status | jq
```

Run a small batch first:

```bash
curl -s -X POST -H 'Content-Type: application/json' -d '{"limit":5,"afterMatchId":0,"resolveRuleset":true}' http://localhost:3000/deadlock/analysis/raw-matches/replay-pending | jq
```

Verify database versions:

```bash
sudo docker exec -i aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds -c 'SELECT "normalizationVersion", "processingVersion", COUNT(*) FROM raw_match_metadata GROUP BY "normalizationVersion", "processingVersion" ORDER BY COUNT(*) DESC;'
```

The replay endpoint continues after individual match failures and returns each failure in the response. It does not delete raw metadata or reset the database.
