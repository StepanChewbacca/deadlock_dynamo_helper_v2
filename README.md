# Deadlock Live Probe

Yarn workspace monorepo capturing real-time *Deadlock* game events through Overwolf, transporting them to a NestJS API for raw event persistence, reducing a minimal match state, and displaying telemetry details on a live debug dashboard.

## 📁 Repository Structure

- `apps/api`: NestJS API server owning event ingestion, NDJSON logging, state reduction, and the debug inspector.
- `apps/overwolf-client`: Overwolf runtime app integrating GEP, event buffering, and transport to the API.
- `packages/shared`: Common TypeScript DTOs and state types.

## 🚀 Quick Start Commands

- **Install dependencies:** `yarn install --ignore-engines`
- **Build packages:** `yarn build`
- **Run test suites:** `yarn test`

For detailed setup, sideloading, and validation instructions, refer to the [Overwolf Deadlock Live Probe Runbook](file:///wsl$/Ubuntu/home/chewie/deadlock/docs/overwolf-deadlock-live-probe-runbook.md).
