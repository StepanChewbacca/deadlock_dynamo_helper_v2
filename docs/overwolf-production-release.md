# Overwolf production release

This runbook releases the API, the Contextual V3 model, and the Overwolf client as one production unit.

## Release prerequisites

- The public API hostname resolves over HTTPS from the internet.
- The deployment host contains the approved Contextual V3 artifacts in the persistent `deadlock-storage` volume.
- Repository variable `PUBLIC_API_BASE_URL` points to the same public API origin used by the Overwolf client.
- The Overwolf app is available in the Developer Console and is approved for the intended release channel.

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

## 2. Build the Overwolf package

Run the `Build Overwolf OPK` workflow from the `main` branch and provide the deployed public HTTPS API base URL.

The workflow:

- builds the shared package and Overwolf bundle;
- embeds the supplied API base URL into the compiled client;
- updates `externally_connectable` to the matching origin;
- validates the production manifest and assets;
- creates a versioned `.opk` package and SHA-256 file;
- uploads both the `.opk` and unpacked sideload build as workflow artifacts.

Do not reuse an OPK built for another environment because the API origin is embedded during the build.

## 3. Test through Overwolf

Use the unpacked artifact or the Overwolf Testing channel before promoting the OPK to Production.

1. Start Deadlock and verify the app launches automatically.
2. Verify GEP registration reaches `REGISTERED`.
3. Enter a Sandbox or test match and confirm the local player, hero, roster, game clock, and inventory are updating.
4. Confirm the in-game build overlay opens and receives `READY` recommendations.
5. Buy, upgrade, and sell items and verify the recommendation changes without restarting the app.
6. Confirm the overlay can be toggled with `Ctrl+Tab` and the desktop window opens with `Ctrl+Shift+B`.
7. Confirm the public model status remains `READY` and `fallbackCount` does not continuously increase.
8. End the match and verify the overlay clears the previous match state.

## 4. Promote to Production

Upload the generated OPK in the Overwolf Developer Console, publish it to the Testing channel, complete the live game smoke test, and then promote the same validated package to the Production channel.

The repository cannot publish to the Overwolf Developer Console automatically. Production promotion requires an authorized Overwolf account.

## Rollback

API/model rollback:

```env
DEADLOCK_CONTEXTUAL_V3_LIVE_MODE=BASELINE
```

Recreate the API container and verify the public recommendation endpoint still returns baseline recommendations.

Overwolf rollback:

- promote the previous known-good OPK in the Developer Console;
- keep its API origin available until clients have updated;
- investigate the failed release using API status, fallback counters, Docker logs, and Overwolf logs.
