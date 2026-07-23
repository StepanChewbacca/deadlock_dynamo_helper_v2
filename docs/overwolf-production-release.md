# Overwolf sideload rollout

This runbook deploys the API and Contextual V3 model, then validates the current unpacked Overwolf client through Developer Mode. OPK packaging and Developer Console publishing are intentionally outside the current scope.

## Prerequisites

- The public API hostname resolves over HTTPS from the internet.
- The deployment host contains the approved Contextual V3 artifacts in the persistent `deadlock-storage` volume.
- Repository variable `PUBLIC_API_BASE_URL` points to the public API origin used by the Overwolf client.
- Overwolf Developer Mode is enabled on the test machine.

## 1. Deploy the API and model

Merge the production pull request into `main`. The `Deploy API` workflow will:

1. rebuild the API image;
2. run database migrations;
3. restart the API container;
4. wait for the Docker health check;
5. require Contextual V3 mode `PRODUCTION` and model state `READY`;
6. verify the live recommendation traversal endpoint;
7. verify the same model status through the public HTTPS origin.

A deployment is not considered successful when the container is running but the model artifacts are missing, invalid, or unreachable through the public hostname.

Verify manually when needed:

```bash
curl -sS "$PUBLIC_API_BASE_URL/deadlock/analysis/contextual-v3-live/status" | jq
curl -sS "$PUBLIC_API_BASE_URL/deadlock/live/build-recommendations/status" | jq
```

Expected model status:

```json
{
  "mode": "PRODUCTION",
  "model": {
    "state": "READY"
  }
}
```

## 2. Build the unpacked Overwolf client

Build the client with the deployed public API base URL:

```bash
OVERWOLF_API_BASE_URL=https://your-api.example.com \
OVERWOLF_PUBLIC_TARGET=/path/to/overwolf-sideload/public \
yarn workspace @deadlock-live-probe/overwolf-client build
```

The build:

- compiles the shared package and Overwolf bundle;
- embeds the supplied API base URL into the compiled client;
- updates `externally_connectable` to the matching origin;
- validates the manifest, windows, permissions, assets, and compiled files;
- copies the resulting unpacked app to `OVERWOLF_PUBLIC_TARGET`.

CI also uploads the unpacked `public` directory as the `overwolf-client-*` artifact for every successful pull request build.

## 3. Load through Overwolf Developer Mode

1. Open Overwolf.
2. Go to `Settings` > `Support` > `Development Options`.
3. Click `Load unpacked extension...`.
4. Select the built `public` directory containing `manifest.json`.
5. Reload the unpacked extension after every client build.

## 4. Live smoke test

1. Start Deadlock and verify the app launches automatically.
2. Verify GEP registration reaches `REGISTERED`.
3. Enter a Sandbox or test match and confirm the local player, hero, roster, game clock, and inventory are updating.
4. Confirm the in-game build overlay opens and receives `READY` recommendations.
5. Buy, upgrade, and sell items and verify the recommendation changes without restarting the app.
6. Confirm the overlay can be toggled with `Ctrl+Tab` and the desktop window opens with `Ctrl+Shift+B`.
7. Confirm the public model status remains `READY` and `fallbackCount` does not continuously increase.
8. End the match and verify the overlay clears the previous match state.

## Rollback

API/model rollback:

```env
DEADLOCK_CONTEXTUAL_V3_LIVE_MODE=BASELINE
```

Recreate the API container and verify the public recommendation endpoint still returns baseline recommendations.

Overwolf rollback:

- load the previous known-good unpacked `public` directory;
- keep its API origin available;
- investigate the failed build using API status, fallback counters, Docker logs, and Overwolf logs.
