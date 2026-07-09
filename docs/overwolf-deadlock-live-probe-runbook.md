# Overwolf Deadlock Live Probe Runbook

This guide walk you through starting the Deadlock Live Probe telemetry bridge, loading the Overwolf client, and verifying real-time game telemetry from a Deadlock session.

---

## 📋 Prerequisites

Before you start, make sure you have the following installed:
1. **Node.js** (v20+ recommended, works with v18 using `--ignore-engines`)
2. **Yarn** (v1.22.x)
3. **Overwolf** (configured with Developer Mode enabled)
4. **Deadlock** (installed on Steam)

---

## 🚀 Quick Start Instructions

Follow these steps to run the telemetry bridge locally:

### 1. Install Dependencies
Run from the root of the workspace to resolve and link workspace packages:
```bash
yarn install --ignore-engines
```

### 2. Build the Shared Package & Overwolf Client
Compile common typescript types and build the Overwolf Webpack bundle:
```bash
# Build shared package types
yarn workspace @deadlock-live-probe/shared build

# Compile Overwolf app bundle (dist/index.js)
yarn workspace @deadlock-live-probe/overwolf-client dev
```

### 3. Run the NestJS Ingest API
Launch the NestJS backend on port `3000`:
```bash
yarn workspace @deadlock-live-probe/api start:dev
```
Verify that the server has booted and is listening on `http://localhost:3000`.

---

## 🛠️ Loading the Overwolf App (Sideloading)

To load the client app in Overwolf:
1. Open the **Overwolf Client** on your desktop.
2. Go to **Settings** > **Support** > **Development Options**.
3. Click on **Load unpacked extension...**.
4. Browse to the workspace directory and select the `apps/overwolf-client/public` folder (which contains the `manifest.json` file).
5. The **Deadlock Live Probe** window should automatically pop up and display a dark UI dashboard showing status `INIT` or `REGISTERING...`.

---

## 🎮 Telemetry Verification Flow

1. Launch **Deadlock** from Steam.
2. In the Overwolf app window:
   - GEP Integration status should change to **REGISTERED** once the game starts.
   - The connection status dot in the footer will turn green (**NestJS API connected & sending**) once the first telemetry batch is delivered.
3. Join a **Deadlock Test Lobby** or start a Sandbox Match.
4. Interact with the game (e.g., spawn, purchase items, farm souls).
5. Open your web browser and navigate to the Live Ingest Debug page:
   - **URL:** [http://localhost:3000/deadlock/live/debug](http://localhost:3000/deadlock/live/debug)
6. Verify the following on the debug page:
   - **Match ID** is successfully extracted.
   - **Game Time** updates in real-time.
   - Roster lists player health, team (Sapphire/Amber), level, and kills/deaths/assists.
   - Bought items display with timing and highlight in gold if enhanced.
   - The **Raw Event Log** panel stream updates with live JSON updates.

---

## 📂 Telemetry Storage & Logging

Raw event batches are captured on the backend and saved to disk as line-separated JSON files (**NDJSON**):
- **Path:** `apps/api/storage/deadlock-live/{matchId}.ndjson`
- **Fallback Path:** `apps/api/storage/deadlock-live/unknown.ndjson` (for events received before a match ID is resolved)

You can tail these files using standard commands:
```bash
tail -f apps/api/storage/deadlock-live/*.ndjson
```
