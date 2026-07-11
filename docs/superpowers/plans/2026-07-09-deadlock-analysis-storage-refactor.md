# Deadlock Analysis Storage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace runtime JSON-backed analysis storage with PostgreSQL-backed reference, crawl, and status data while preserving raw `ndjson` event logs as technical traces.

**Architecture:** Introduce normalized TypeORM entities for heroes, items, match player items, skill upgrades, and crawler state. Keep the existing NestJS module structure, add an importer for the current JSON reference files, then refactor services/controllers to read and write only through Postgres-backed repositories.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Jest, Yarn workspaces, server-rendered HTML debug page.

---

## File Structure

- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/deadlock-live/deadlock-live.module.ts`
- Create: `apps/api/src/deadlock-live/entities/hero.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/item.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/match-player-item.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/match-player-skill-upgrade.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/crawler-run.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/crawler-state.entity.ts`
- Modify: `apps/api/src/deadlock-live/entities/match.entity.ts`
- Modify: `apps/api/src/deadlock-live/entities/match-player.entity.ts`
- Create: `apps/api/src/deadlock-live/reference-data-import.service.ts`
- Modify: `apps/api/src/deadlock-live/all-heroes-analysis.service.ts`
- Modify: `apps/api/src/deadlock-live/hero-analysis.service.ts`
- Create: `apps/api/src/deadlock-live/ingest-status.service.ts`
- Create: `apps/api/src/deadlock-live/ingest-status.controller.ts`
- Modify: `apps/api/src/deadlock-live/debug-page.controller.ts`
- Create: `apps/api/test/reference-data-import.service.spec.ts`
- Modify: `apps/api/test/all-heroes-analysis.service.spec.ts`
- Modify: `apps/api/test/hero-analysis.service.spec.ts`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Create: `docs/status/analysis-storage-refactor-progress.md`

## Task 1: Add Failing Tests For Reference Data Import And DB-Backed Lookups

**Files:**
- Create: `apps/api/test/reference-data-import.service.spec.ts`
- Modify: `apps/api/test/all-heroes-analysis.service.spec.ts`
- Modify: `apps/api/test/hero-analysis.service.spec.ts`

- [ ] Write a failing test proving heroes/items can be imported from JSON into repositories.
- [ ] Run only that test and confirm it fails because the import service does not exist.
- [ ] Extend current service tests to fail on file-backed map/cache access assumptions.
- [ ] Re-run targeted tests and confirm the new failures are meaningful.

## Task 2: Add New Entities And Wire TypeORM

**Files:**
- Create: all new entity files
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/deadlock-live/deadlock-live.module.ts`
- Modify: `apps/api/src/deadlock-live/entities/match.entity.ts`
- Modify: `apps/api/src/deadlock-live/entities/match-player.entity.ts`

- [ ] Add failing build/test coverage for new entities and relations.
- [ ] Implement new entities and update existing relations.
- [ ] Register them in TypeORM root/module configs.
- [ ] Run the full API test suite.

## Task 3: Import Heroes And Items Into Postgres

**Files:**
- Create: `apps/api/src/deadlock-live/reference-data-import.service.ts`
- Create: `apps/api/test/reference-data-import.service.spec.ts`

- [ ] Write a failing importer test that seeds heroes/items from the current JSON files.
- [ ] Implement the importer with idempotent upsert behavior.
- [ ] Call the importer during module startup.
- [ ] Verify the targeted importer test passes.

## Task 4: Remove Runtime Hero/Item JSON Lookups

**Files:**
- Modify: `apps/api/src/deadlock-live/all-heroes-analysis.service.ts`
- Modify: `apps/api/src/deadlock-live/hero-analysis.service.ts`

- [ ] Write failing tests for repository-backed hero/item resolution.
- [ ] Remove `itemsMapPath`/`heroesMapPath` startup loading from services.
- [ ] Replace in-memory map lookups with repository-backed reads.
- [ ] Run the affected test files and then the full API suite.

## Task 5: Normalize Match Player Items And Skill Upgrades

**Files:**
- Modify: `apps/api/src/deadlock-live/entities/match-player.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/match-player-item.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/match-player-skill-upgrade.entity.ts`
- Modify: service files and related tests

- [ ] Write failing tests for normalized player item/skill persistence.
- [ ] Remove `jsonb` reliance from write paths.
- [ ] Persist item purchases and skill upgrades through child tables.
- [ ] Update read paths that build hero analysis responses.
- [ ] Run tests.

## Task 6: Replace File-Backed Dynamo Cache With Postgres

**Files:**
- Modify: `apps/api/src/deadlock-live/hero-analysis.service.ts`
- Modify: tests

- [ ] Write a failing test proving build analysis can be computed from DB rows only.
- [ ] Remove runtime reads/writes to `storage/deadlock-live/dynamo-matches.json`.
- [ ] Rework crawl and build aggregation paths to use `matches`, `match_players`, and normalized child tables.
- [ ] Run targeted tests and full API tests.

## Task 7: Persist Crawl State And Expose Ingest Status

**Files:**
- Create: `apps/api/src/deadlock-live/entities/crawler-run.entity.ts`
- Create: `apps/api/src/deadlock-live/entities/crawler-state.entity.ts`
- Create: `apps/api/src/deadlock-live/ingest-status.service.ts`
- Create: `apps/api/src/deadlock-live/ingest-status.controller.ts`
- Modify: `apps/api/src/deadlock-live/all-heroes-analysis.service.ts`
- Modify: `apps/api/src/deadlock-live/hero-analysis.service.ts`
- Modify: `apps/api/src/deadlock-live/debug-page.controller.ts`

- [ ] Write a failing test for ingest status aggregation.
- [ ] Persist crawler runs/state during crawl lifecycle.
- [ ] Add `/deadlock/admin/ingest/status` JSON endpoint.
- [ ] Add `/deadlock/admin/ingest` HTML page with polling.
- [ ] Run tests and manual curl verification.

## Task 8: Remove Runtime JSON Artifacts From Deployment

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] Remove hero/item JSON copies from the image.
- [ ] Keep only what is required for the one-time importer, or move importer input elsewhere before final cleanup.
- [ ] Verify image build still passes.

## Task 9: VPS Verification And Progress Log Finalization

**Files:**
- Modify: `docs/status/analysis-storage-refactor-progress.md`

- [ ] Deploy to `my-vps`.
- [ ] Verify heroes/items tables populate.
- [ ] Verify crawler status endpoint/page reports live data.
- [ ] Verify new matches are saved without runtime JSON dependency.
- [ ] Update the progress file with completed checkpoints and residual risks.
