# Deadlock Live Data Probe MVP Design

## Goal

Validate that live data from Deadlock can be collected via Overwolf, delivered to a local NestJS backend, logged as raw events, reduced into a minimal in-memory match state, and inspected during a live test lobby session.

## Success Scenario

The operator starts the local API, loads the Overwolf app, launches Deadlock, joins a test lobby, and verifies end-to-end updates through console logs, NDJSON files, JSON endpoints, and a simple debug page.

## Scope

### Included

- Yarn workspace monorepo with:
  - `apps/api`
  - `apps/overwolf-client`
  - `packages/shared`
- Shared TypeScript DTO and state types
- Overwolf Deadlock GEP integration with required features:
  - `game_info`
  - `match_info`
- Overwolf listeners for:
  - `onInfoUpdates2`
  - `onNewEvents`
- Raw event logging in the Overwolf console
- Event batching from Overwolf client to backend once per second
- NestJS ingest endpoint for live event batches
- NDJSON raw event persistence under `storage/deadlock-live`
- In-memory minimal match state builder
- REST endpoints for live state and recent raw events
- Simple debug page served by NestJS for browser inspection
- Local run instructions for testing in Deadlock test lobby

### Excluded

- Build recommender
- AI or ML analysis
- Authentication
- PostgreSQL or any external database
- Polished overlay UI
- Exhaustive normalization for every Overwolf payload shape
- Post-match analysis
- Guaranteed delivery or durable retry queues

## Constraints

- Backend must be NestJS-based
- Workspace and package management must use Yarn
- The MVP must be testable locally against a running Deadlock session in Overwolf
- Tolerant parsing is preferred over brittle schema assumptions

## Repository Structure

```text
deadlock-live-probe/
  apps/
    api/
    overwolf-client/
  packages/
    shared/
  docs/
    superpowers/
      specs/
```

## Architecture

### Shared Package

`packages/shared` contains transport DTOs and minimal state types used by both runtime applications. It has no framework dependencies and compiles to plain TypeScript output consumable by the API and Overwolf client.

### Overwolf Client

`apps/overwolf-client` is a minimal Overwolf app for Deadlock. On startup it registers the required GEP features, subscribes to `onInfoUpdates2` and `onNewEvents`, logs incoming payloads to the console, normalizes them into `OverwolfLiveEventDto`, buffers them in memory, and sends them to the API every second.

The client also exposes minimal visible status so the operator can confirm:

- whether GEP feature registration succeeded
- whether events are arriving
- whether the backend POST is succeeding

### API

`apps/api` is a NestJS application exposing ingest, state, recent events, and debug endpoints. Incoming batches are appended to NDJSON files and also folded into a minimal in-memory match state keyed by match id.

The API additionally serves a simple HTML debug page that polls the JSON endpoints and renders the current state for rapid inspection during a lobby test.

## Shared Types

The shared package defines:

- `OverwolfLiveEventSource`
- `OverwolfLiveEventDto`
- `OverwolfLiveBatchDto`
- `MinimalItemState`
- `MinimalPlayerState`
- `MinimalMatchState`

The type shapes follow the MVP contract already proposed by the user and remain intentionally loose on `payload`.

## Data Flow

1. The operator starts the NestJS API locally.
2. The operator loads the Overwolf app and launches Deadlock.
3. The Overwolf client registers `game_info` and `match_info`.
4. Deadlock emits GEP updates through `onInfoUpdates2` and `onNewEvents`.
5. The client logs raw payloads and converts them into `OverwolfLiveEventDto`.
6. The client batches events in memory and POSTs them once per second to `POST /deadlock/live/events`.
7. The API appends every event to an NDJSON file and updates the match state.
8. The operator opens the debug page in a browser and confirms live state changes while interacting with a test lobby.

## Event Handling Design

### Overwolf Parsing

The client uses tolerant parsing:

- string payloads are JSON-decoded if possible
- non-JSON strings are preserved as-is
- unknown payload shapes pass through untouched

`onInfoUpdates2` produces one normalized event per update item when possible. `onNewEvents` stores the raw event array payload in a single normalized record unless a more specific event split is clearly available from the runtime shape.

### Match Id Strategy

The system attempts to extract `match_id` from each batch. If unavailable, events are still accepted under the `unknown` match bucket. This keeps the pipeline operational before the first definitive match id arrives.

### State Reduction

The in-memory reducer is intentionally small and tolerant. It updates:

- `matchId`
- `gameTimeSec`
- `playersBySteamId`
- player `hero`
- `team`
- `souls`
- `health`
- `KDA`
- `items`

Unknown payloads are ignored without throwing. Later events overwrite prior values for the same player fields. Item lists replace the previous known list for that player to keep semantics predictable during the MVP.

## Persistence Design

Raw events are appended to:

- `storage/deadlock-live/unknown.ndjson`
- `storage/deadlock-live/{matchId}.ndjson`

Each line contains one JSON object representing the normalized event received by the backend.

For the MVP, writes happen directly with `appendFile`. This is acceptable because throughput is expected to be low and the system is single-node and local.

## API Surface

### Ingest

- `POST /deadlock/live/events`

Accepts `OverwolfLiveBatchDto`, writes raw events, updates match state, and stores a recent in-memory window of raw events for inspection.

### Inspection

- `GET /deadlock/live/states`
- `GET /deadlock/live/matches/:matchId/state`
- `GET /deadlock/live/events/recent`
- `GET /deadlock/live/debug`

The debug page reads the JSON endpoints and renders:

- `matchId`
- `matchClock`
- players
- hero
- team
- souls
- health
- KDA
- items
- recent raw events

## Debug Page

The debug page is intentionally minimal and server-rendered as plain HTML with a small inline script. It polls the API every 1 second and updates a readable table and event panel. The page is optimized for validation, not styling.

This keeps the MVP inside the NestJS app and avoids introducing a separate frontend build chain just for diagnostics.

## Error Handling

### Overwolf Client

- Feature registration failure is shown in the app UI and console
- Failed POST attempts are logged in the console
- Failed POST attempts are not retried beyond the current batch window
- Malformed JSON payload strings are preserved as raw strings

### API

- Empty batches are accepted and ignored
- Invalid event shapes do not crash state reduction
- File storage directories are created on demand

## Testing Strategy

### Automated

API unit tests cover:

- match id extraction
- match clock parsing
- roster merge behavior
- item replacement behavior
- tolerant ignore behavior for malformed payloads
- ingest controller happy path

Shared package compile validation ensures both apps consume the same DTOs.

Overwolf client tests cover:

- safe JSON parsing helper
- event buffer flush behavior

### Manual

Manual verification is the primary acceptance gate:

1. Start the API.
2. Start the Overwolf app.
3. Launch Deadlock.
4. Join a test lobby.
5. Verify raw event logs in the Overwolf console.
6. Verify `POST /deadlock/live/events` traffic reaches the API.
7. Verify NDJSON files are written.
8. Verify `GET /deadlock/live/states` returns at least one state.
9. Verify the debug page updates `matchClock`, players, hero, team, souls, health, KDA, and items as gameplay changes.

## Implementation Notes

- The monorepo should avoid extra infrastructure beyond Yarn workspaces and TypeScript project references where useful.
- The Overwolf app should keep its manifest and runtime setup minimal but complete enough to be loaded manually in the Overwolf developer flow.
- The API should enable CORS for local development so the Overwolf app can POST to it without friction.
- Recent raw events should be stored in memory as a bounded list to support the debug page without reading back from NDJSON files.

## Risks

- Deadlock GEP payload shapes may differ from assumptions, so tolerant parsing is mandatory.
- Match id may not arrive early, so the `unknown` bucket must remain first-class.
- Overwolf runtime packaging and local loading can fail for non-code reasons, so the repository needs explicit run instructions.

## Acceptance Criteria

The MVP is complete when, during a live Deadlock test lobby session:

- the Overwolf console shows raw updates
- the backend receives `POST /deadlock/live/events`
- `storage/deadlock-live/*.ndjson` is populated
- `GET /deadlock/live/states` returns at least one match
- at least one player exists in the reduced state
- player hero, team, souls, health, KDA, and items update when corresponding live data changes
- buying an item changes the player's items in state or at least appears in recent raw events
- kill or death changes KDA in state or at least appears in recent raw events
- `match_clock` updates over time
