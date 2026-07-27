# Recommendation Value V6 live rollout

## Candidate

- Candidate ID: `v6-short-only-20260727`
- Training model ID: `coarse-s10-a0p1-m10-w025-short-only-v2`
- Model version: `RECOMMENDATION_VALUE_V6_MATCH_BALANCED_ADVANTAGE_1`
- Model kind: `OBSERVATIONAL_STATE_ACTION_ADVANTAGE`
- Model SHA-256: `799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e`
- Target: short-horizon utility only
- Offline release gate: failed because action-conditioned win log-loss degraded

This rollout is an explicit operator override of the original personal-only canary restriction. `CANARY` applies to all users. No Steam allowlist is read or accepted from requests.

## Safety contract

The current production recommendation is always generated first. Recommendation Value V6 may only reorder the existing `action + alternatives` candidate set. It cannot create a BUY, UPGRADE, SELL, HOLD, or REBUY action.

The current production ranking is returned unchanged when:

- the mode is `DISABLED`;
- the model is missing, unhealthy, or has an invalid SHA;
- an artifact validation fails;
- fewer than two candidates have action support;
- the top-two action-advantage separation is below the configured threshold;
- feature construction, catalog lookup, scoring, or reranking throws.

Existing Contextual V3 modes remain unchanged. V6 is applied after the currently configured production response has been produced.

## Artifact promotion

Run on the production host from the repository root:

```bash
bash scripts/promote-recommendation-value-v6-live.sh
```

The script:

- locates the `deadlock-storage` Docker volume using `sudo docker`;
- copies `model.json`, `manifest.json`, `audit.json`, and `evaluation.json` into a new immutable directory;
- refuses to overwrite an existing target;
- verifies the exact model SHA;
- writes `promotion.json` recording the global operator override and failed offline release gate;
- removes write permissions from the promoted directory.

## Production environment

```text
DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODE=CANARY
DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODEL_DIR=/app/apps/api/storage/recommendation-value-v6-live-candidates/v6-short-only-20260727
DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_EXPECTED_MODEL_SHA256=799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e
DEADLOCK_RECOMMENDATION_VALUE_V6_CANARY_MIN_SEPARATION=0.001
DEADLOCK_RECOMMENDATION_VALUE_V6_TELEMETRY_DIR=/app/apps/api/storage/recommendation-value-v6-live-telemetry
```

There is intentionally no `DEADLOCK_RECOMMENDATION_VALUE_V6_CANARY_STEAM_IDS` variable.

## Build and deploy

```bash
yarn lint
yarn test
yarn build
sudo docker compose build api
sudo docker compose up -d --no-deps api
sudo docker compose ps
sudo docker compose logs --tail=200 api
```

## Status

```bash
curl --fail http://127.0.0.1:3000/deadlock/analysis/recommendation-value-v6-live/status
```

Expected values after a successful load:

```text
mode = CANARY
rolloutScope = ALL_USERS
model.state = READY
model.candidateId = v6-short-only-20260727
model.modelSha256 = 799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e
allowlistCount = 0
```

The recommendation response contains `recommendationExperiment` with either:

- `source = VALUE_V6_CANARY`; or
- `source = BASELINE` and an explicit `fallbackReason`.

## Telemetry separation

Displayed V6 decisions are written to:

```text
/app/apps/api/storage/recommendation-value-v6-live-telemetry/events.ndjson
```

These rows contain:

```text
dataSource = USER_LIVE
eligibleForProModelTraining = false
```

The local Steam ID is not written. A deterministic truncated SHA-256 identity reference is used instead. V6 decision, observed-action, and supersede events are intercepted before the existing pro-training telemetry writer, so they cannot enter Recommendation Dataset V4/V5 or Behavioral/Value pro-model training.

## Smoke test

1. Set `DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODE=DISABLED`, restart only the API, and verify the current production ranking.
2. Set the mode to `CANARY`, restart only the API, and confirm the V6 status is `READY` with the expected SHA.
3. Send a known recommendation request and confirm `recommendationExperiment.source` is `VALUE_V6_CANARY` or contains an explicit fallback.
4. Confirm the returned action keys are a permutation of the current production candidate keys.
5. During a match, verify legality, latency, fallback behavior, and separate USER_LIVE telemetry.

## Rollback

Logical rollback:

```text
DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODE=DISABLED
```

Restart only the API:

```bash
sudo docker compose up -d --force-recreate --no-deps api
```

Code rollback target:

```text
251660fc3dd541925b8ade9c55d216a91a975d85
```

The promoted artifact can remain stored because it is inactive in `DISABLED` mode.
