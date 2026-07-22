# Contextual V3 future final test

The future final test is the last offline release gate before shadow mode.

## Frozen inputs

The evaluator refuses to run unless all approved validation artifacts are present and consistent:

- training manifest and frozen model;
- candidate-evaluation manifest and evaluation;
- validation candidate release gate passed;
- candidate policy is `TRAIN_OBSERVED_GLOBAL_BACKOFF_LEGAL_SHORTLIST`;
- candidate limit is exactly `128`;
- model SHA-256 matches both training and candidate-evaluation manifests;
- training and candidate-evaluation artifacts agree on the exclusive future cutoff.

The final test does not retrain or modify the model.

## Match selection

The test selects exactly `1,950` matches using the fixed policy:

- standard 6v6 roster only;
- exactly 12 unique heroes;
- exactly six players on each team;
- match start time strictly greater than `2026-07-22T11:39:43.000Z`;
- oldest eligible matches are selected first;
- selection is ordered by start time and match ID;
- the match count cannot be changed through the API.

The test refuses to start when fewer than 1,950 eligible future matches are available.

## Evaluation

Decision rows are extracted directly from the frozen future match window. Sell targets are excluded but remain in observed history, matching the training data contract.

The evaluator uses:

- the frozen TRAIN-fitted model;
- TRAIN-fitted build archetypes embedded in the model;
- the approved candidate policy and candidate limit;
- purchasable catalog items only;
- all direct recipe components for upgrade legality.

Target actions are used only to score coverage and ranking after candidate construction.

The release gate requires:

- candidate coverage of at least 98%;
- Top-1 improvement of at least 0.10 percentage points over baseline;
- Top-3 regression no worse than 0.05 percentage points.

A passing final test makes the model eligible for shadow mode. It does not directly enable production recommendations.

## Endpoints

- `POST /deadlock/analysis/contextual-v3-final-test/start`
- `GET /deadlock/analysis/contextual-v3-final-test/status`
- `GET /deadlock/analysis/contextual-v3-final-test/evaluation`
- `GET /deadlock/analysis/contextual-v3-final-test/audit`
- `GET /deadlock/analysis/contextual-v3-final-test/manifest`

Start request:

```json
{
  "batchSize": 100
}
```

`batchSize` is operational only and does not change the selected matches, candidate policy, model, or release gate.

## Output artifacts

Default directory: `/app/apps/api/storage/contextual-v3-final-test`

- `selected-matches.json`
- `final-test.ndjson`
- `candidate-sets.ndjson`
- `evaluation.json`
- `audit.json`
- `manifest.json`
