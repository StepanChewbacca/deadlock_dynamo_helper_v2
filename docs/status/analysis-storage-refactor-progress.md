# Analysis Storage Refactor Progress

## Goal

Track completed work for the PostgreSQL storage refactor so another agent can resume without re-discovery.

## Checklist

- [x] Design agreed: runtime hero/item/cache JSON must be removed
- [x] Decision recorded: `ndjson` raw logs stay as technical file logs
- [x] Decision recorded: existing data will not be migrated; database refills from scratch
- [x] Design spec updated
- [x] Implementation plan updated
- [x] New TypeORM entities added
- [x] Reference data importer added
- [x] Runtime hero/item JSON usage removed from analysis services
- [x] Dynamo file cache removed from runtime
- [x] Normalized match player item/skill tables used in writes
- [x] Crawler state persisted in Postgres
- [x] Ingest status JSON endpoint added
- [x] Ingest status HTML page added
- [x] Hero reference seed aligned to official game/GEP hero IDs
- [x] Hero ability mapping aligned to official game/GEP hero IDs with legacy fallback IDs
- [x] Item recipe graph imported into Postgres
- [x] Build generation expanded from final items to recipe-based component order
- [x] Docker/runtime JSON dependencies removed
- [x] Full API tests green
- [x] VPS deployed and verified

## Notes

- Current runtime JSON dependencies to eliminate:
  - `apps/api/src/deadlock-live/heroes-map.json`
  - `apps/api/src/deadlock-live/items-map.json`
- Runtime services no longer read:
  - `apps/api/src/deadlock-live/heroes-map.json`
  - `apps/api/src/deadlock-live/items-map.json`
  - `storage/deadlock-live/dynamo-matches.json`
- Remaining temporary dependency:
  - `ReferenceDataImportService` seeds `heroes` and `items` from embedded TypeScript seed data on startup when those tables are empty
- Runtime cleanup completed:
  - `heroes-map.json` deleted from runtime codebase
  - `items-map.json` deleted from runtime codebase
  - Docker image no longer copies mapping JSON files
- Hero ID mapping completed:
  - `heroes` seed now uses official game/GEP hero IDs as primary IDs
  - legacy crawler/API hero IDs remain in `heroes` as fallback aliases where needed
  - `HERO_ABILITY_MAP` now prefers official hero IDs and preserves legacy fallback IDs for older crawled matches
- Item recipe modeling completed:
  - `item_components` table added in Postgres
  - item metadata now syncs from `https://api.deadlock-api.com/v1/assets/items` when `DEADLOCK_API_KEY` is available
  - recipe links are imported from `component_items`
  - build generation now expands final upgraded items into component purchases before rendering the guide
- Normalized storage completed:
  - `match_player_items` used for persisted item rows
  - `match_player_skill_upgrades` used for persisted skill upgrade rows
- VPS verification snapshot:
  - `heroes` table was truncated and reseeded on VPS after deploy
  - `SELECT COUNT(*) FROM heroes` returned `38`
  - `SELECT "heroId", name FROM heroes ...` verified corrected rows including `12=Kelvin`, `13=Haze`, `15=Bebop`, `20=Ivy`, `25=Warden`, `27=Yamato`, `31=Lash`, `76=Kelvin`, `80=Bebop`
  - `/deadlock/admin/ingest/status` returned `matchesTotal=2500`, `matchPlayersTotal=27420`, `heroesTotal=38`, `itemsTotal=251`
  - `/deadlock/admin/ingest` returned `HTTP 200`
  - `crawler_state` and `crawler_runs` rows were created after triggering `/deadlock/analysis/crawl/start`
  - `item_components` contains `64` recipe links after sync
  - `items` now includes component items such as `High-Velocity Rounds`
  - `/deadlock/analysis/hero/12` now returns `High-Velocity Rounds` before `Opening Rounds` in the early build phase
- Verification links:
  - JSON status: `http://165.227.149.248:3000/deadlock/admin/ingest/status`
  - HTML status: `http://165.227.149.248:3000/deadlock/admin/ingest`
- Allowed to remain on disk:
  - `storage/.../*.ndjson` raw event logs
