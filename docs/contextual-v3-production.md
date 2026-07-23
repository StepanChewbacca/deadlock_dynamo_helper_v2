# Contextual V3 production rollout

Contextual V3 is the frozen hierarchical next-item ranker that passed both validation and the strictly future final test.

## Approved artifacts

- model version: `CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1`
- model SHA-256: `88e3400e7bc88f0af7a6752fc4b7ea9b83af9a8a6424dff707b151e6459f10d3`
- candidate policy: `TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST`
- candidate limit: `128`
- final-test result: `ELIGIBLE_FOR_SHADOW_MODE`

The live loader refuses to activate when the model hash, catalog hash, validation gate, validation audit, final-test gate, final-test audit, model version, candidate policy, or candidate limit differs from the approved artifacts.

## Runtime modes

`DEADLOCK_CONTEXTUAL_V3_LIVE_MODE` supports:

- `BASELINE` - return the existing transition-policy recommendation only.
- `SHADOW` - return baseline and evaluate Contextual V3 asynchronously.
- `PRODUCTION` - return Contextual V3 when the approved model is ready, otherwise fall back to baseline.

Docker Compose defaults to `PRODUCTION`. Rollback does not require deleting artifacts:

```env
DEADLOCK_CONTEXTUAL_V3_LIVE_MODE=BASELINE
```

Recreate the API container after changing the mode.

## Live context

The live ranker uses:

- canonical hero ID;
- current game phase;
- current inventory;
- allied roster;
- enemy roster;
- reconstructed BUY, UPGRADE, and SELL history from live inventory snapshots;
- the train-fitted build archetype when enough live history is available.

When roster or build-history features are unavailable, their contextual deltas are disabled rather than replaced with fabricated values.

## Safety behavior

Production requests always compute the existing baseline first. Any unavailable artifact, failed integrity check, empty candidate set, parsing error, or ranking error returns the baseline response and records a fallback counter and error.

The public recommendation endpoint remains:

```text
POST /deadlock/analysis/build-recommendation
```

Live model status:

```text
GET /deadlock/analysis/contextual-v3-live/status
```

Reload approved artifacts without restarting the process:

```text
POST /deadlock/analysis/contextual-v3-live/reload
```

## Deployment verification

After deployment, verify:

```bash
curl -sS http://localhost:3000/deadlock/analysis/contextual-v3-live/status | jq
```

Expected production state:

```json
{
  "mode": "PRODUCTION",
  "model": {
    "state": "READY",
    "modelVersion": "CONTEXTUAL_V3_HIERARCHICAL_COUNT_RANKER_1",
    "modelActualSha256": "88e3400e7bc88f0af7a6752fc4b7ea9b83af9a8a6424dff707b151e6459f10d3",
    "validationGatePassed": true,
    "validationAuditPassed": true,
    "finalTestGatePassed": true,
    "finalTestAuditPassed": true,
    "catalogVerified": true
  }
}
```

`fallbackCount` should remain zero during normal operation. A non-zero value is safe because the response was served by baseline, but the recorded error must be investigated.
