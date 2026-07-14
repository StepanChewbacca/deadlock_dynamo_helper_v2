# Overwolf Deadlock Live Probe Runbook

This guide walks through starting the Deadlock Live Probe telemetry bridge, loading the Overwolf client, and verifying real-time game telemetry and live build recommendations from a Deadlock session.

---

## Prerequisites

Before you start, make sure you have the following installed:
1. **Node.js** (v20+ recommended, works with v18 using `--ignore-engines`)
2. **Yarn** (v1.22.x)
3. **Overwolf** (configured with Developer Mode enabled)
4. **Deadlock** (installed on Steam)

---

## Quick Start Instructions

### 1. Install Dependencies

Run from the root of the workspace to resolve and link workspace packages:

```bash
yarn install --ignore-engines
```

### 2. Build the Shared Package and Overwolf Client

Compile shared types and create the Overwolf Webpack bundle:

```bash
yarn workspace @deadlock-live-probe/shared build
```

```bash
yarn workspace @deadlock-live-probe/overwolf-client build
```

The production build also synchronizes `apps/overwolf-client/public` to the configured Windows sideload location.

### 3. Run the NestJS Ingest API

Launch the NestJS backend on port `3000`:

```bash
yarn workspace @deadlock-live-probe/api start:dev
```

Verify that the server has booted and is listening on `http://localhost:3000`.

---

## Loading the Overwolf App

1. Open the **Overwolf Client**.
2. Go to **Settings** > **Support** > **Development Options**.
3. Click **Load unpacked extension...**.
4. Select `apps/overwolf-client/public`, which contains `manifest.json`.
5. Confirm that **Deadlock Live Probe 0.0.2** opens and reaches `REGISTERED` after Deadlock starts.
6. Reload the unpacked extension after every new Overwolf client build.

---

## Telemetry Verification Flow

1. Launch **Deadlock** from Steam.
2. Confirm that GEP Integration changes to **REGISTERED**.
3. Confirm that the connection indicator changes to **NestJS API connected & sending** after the first telemetry batch.
4. Join a test lobby or Sandbox match.
5. Open `http://localhost:3000/deadlock/live/debug`.
6. Verify:
   - Match ID is extracted.
   - Game time updates.
   - The local player is identified.
   - Hero ID and inventory updates are present.
   - Raw events continue to arrive.

---

## Live Build HUD Verification

The in-game overlay polls the backend traversal snapshot once per second, but rerenders only when the recommendation lifecycle, `traversalKey`, stale state, selected action, or refresh generation changes.

1. Check traversal status:

```bash
curl -sS https://aboba-telegramovich.duckdns.org/deadlock/live/build-recommendations/status | jq
```

2. After entering a match and selecting a hero, list tracked recommendations:

```bash
curl -sS https://aboba-telegramovich.duckdns.org/deadlock/live/build-recommendations | jq '[.[] | {state, matchId, steamId, heroId, inventoryStateKey, gameTimeS, timeBucket, traversalKey, isStale, refreshCount, cacheHitCount, discardedResultCount, lastError}]'
```

3. In the Overwolf in-game window, verify that the **NEXT BUILD ACTION** panel appears and shows:
   - `READY`, `REFRESHING`, `WAITING`, or `ERROR` state.
   - Primary action label such as `Buy Grit`.
   - Item slot, cost, tier, confidence, typical time, and explanation.
   - Up to four evidence-filtered alternatives.

4. Without changing inventory, wait for several telemetry batches. `cacheHitCount` should increase while the HUD remains visually stable.

5. Buy or sell an item. Verify that:
   - `inventoryStateKey` changes.
   - `traversalKey` changes.
   - `refreshCount` increases.
   - The HUD briefly shows `REFRESHING` or `UPDATING` when the previous result is stale.
   - The new recommendation replaces the previous action.

6. Cross a 30-second game-time boundary without changing inventory. Verify that `timeBucket` and `traversalKey` change and the recommendation refreshes.

7. End the match. Verify that match tracking and the live recommendation panel are cleared.

---

## Telemetry Storage and Logging

Raw event batches are stored as NDJSON:

- `apps/api/storage/deadlock-live/{matchId}.ndjson`
- `apps/api/storage/deadlock-live/unknown.ndjson` for events received before match ID resolution

Tail the files with:

```bash
tail -f apps/api/storage/deadlock-live/*.ndjson
```
