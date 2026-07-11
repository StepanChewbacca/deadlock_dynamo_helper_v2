# Versioned Item Catalogs and Ruleset Resolution

## Purpose

The API stores immutable item and recipe snapshots by Deadlock client version. Historical matches can then be evaluated against the item definitions that existed when the match was played instead of the current live catalog.

The current `items` and `item_components` tables remain the operational latest snapshot used by existing code. The versioned tables are separate:

- `game_rulesets`
- `item_catalog_versions`
- `item_catalog_items`
- `item_catalog_recipes`

## Import API

List versions available from Deadlock API:

```bash
curl http://localhost:3000/deadlock/reference-data/catalogs/available
```

Import the latest available version:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://localhost:3000/deadlock/reference-data/catalogs/import
```

Import the latest five versions:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"maxVersions":5}' \
  http://localhost:3000/deadlock/reference-data/catalogs/import
```

Import explicit versions:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"clientVersions":[6518,6579],"force":true}' \
  http://localhost:3000/deadlock/reference-data/catalogs/import
```

Import every version known to Deadlock API:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"importAll":true}' \
  http://localhost:3000/deadlock/reference-data/catalogs/import
```

`importAll` is intentionally not the default because a complete historical backfill may issue many external requests and create a large amount of PostgreSQL data.

Each item stores normalized fields such as `itemType`, slot, cost, tier, shop state, active-item state, and activation type. The complete source item is also retained in `rawPayload`.

## Diagnostics

List imported catalogs:

```bash
curl http://localhost:3000/deadlock/reference-data/catalogs
```

Inspect a versioned recipe graph:

```bash
curl http://localhost:3000/deadlock/reference-data/catalogs/6518/recipes
```

List rulesets:

```bash
curl http://localhost:3000/deadlock/reference-data/rulesets
```

## Ruleset Resolution Priority

The resolver applies the following order:

1. `OBSERVED` - an explicit `client_version` in the match payload.
2. `DEMO_METADATA` - a supported client/build field in nested demo metadata that matches an imported ruleset or catalog.
3. `TIME_WINDOW` - exactly one active ruleset window contains the match start time.
4. `UNKNOWN` - no reliable match was found.

Confidence values:

- `OBSERVED`: `1.0`
- `DEMO_METADATA`: `0.95`
- `TIME_WINDOW`: `0.75`
- `UNKNOWN`: `0`

The resolver stores the selected ruleset, selected catalog, method, confidence, details, and resolution timestamp on `raw_match_metadata`.

## Time Windows

Catalog import creates one ruleset per client version but does not invent patch release timestamps. Configure verified windows manually or from a future authoritative patch feed:

```bash
curl -X PUT \
  -H 'Content-Type: application/json' \
  -d '{
    "validFrom":"2026-01-01T00:00:00.000Z",
    "validTo":"2026-02-01T00:00:00.000Z",
    "status":"active"
  }' \
  http://localhost:3000/deadlock/reference-data/rulesets/6518/window
```

Matches near a window boundary are intentionally left unresolved. The exclusion margin defaults to six hours and can be changed with:

```env
RULESET_BOUNDARY_MARGIN_MINUTES=360
```

## Match Diagnostics

Get the stored or newly resolved ruleset for a match:

```bash
curl http://localhost:3000/deadlock/analysis/raw-matches/93125215/ruleset
```

Force re-resolution of one match:

```bash
curl -X POST \
  http://localhost:3000/deadlock/analysis/raw-matches/93125215/ruleset/resolve
```

Resolve a batch of unresolved raw rows:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"limit":500}' \
  http://localhost:3000/deadlock/analysis/raw-matches/rulesets/resolve-pending
```

## Deployment

Build the updated image, run the new migration, and start the API:

```bash
sudo docker compose build api
sudo docker compose run --rm api node apps/api/run-migrations.js
sudo docker compose up -d api
```

Import at least the latest catalog:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://localhost:3000/deadlock/reference-data/catalogs/import
```

Resolve previously stored raw rows after importing catalogs:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"limit":500}' \
  http://localhost:3000/deadlock/analysis/raw-matches/rulesets/resolve-pending
```

Verify:

```sql
SELECT * FROM migrations ORDER BY timestamp;
SELECT COUNT(*) FROM item_catalog_versions;
SELECT COUNT(*) FROM item_catalog_items;
SELECT COUNT(*) FROM item_catalog_recipes;
SELECT
  "matchId",
  "clientVersion",
  "rulesetResolutionMethod",
  "rulesetResolutionConfidence",
  "resolvedRulesetId",
  "resolvedCatalogVersionId",
  "resolvedAt"
FROM raw_match_metadata
ORDER BY "fetchedAt" DESC
LIMIT 20;
```
