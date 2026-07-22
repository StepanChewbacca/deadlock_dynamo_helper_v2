# Contextual V3 candidate evaluation

The first Contextual V3 validation run improved ranking quality but failed only the candidate coverage gate:

- validation decisions: `400,127`
- candidate coverage: `96.7535%`
- contextual Top-1 delta: `+2.2603` percentage points
- contextual Top-3 delta: `+3.3839` percentage points
- contextual MRR delta: `+2.4425` percentage points

The ranker itself therefore showed a strong improvement. The failed gate came from the original candidate shortlist, which used only hero and hero-phase train observations with a limit of 64.

## V2 candidate policy

The re-evaluator keeps the trained model unchanged and rebuilds validation candidate sets from the frozen validation artifact.

Candidate ordering uses train-only evidence in this order:

1. hero and phase frequency;
2. hero frequency;
3. global train frequency;
4. action key for deterministic ties.

The default candidate limit is `128`.

Candidate legality rules:

- `BUY` and `REBUY` cannot target an item already held;
- `UPGRADE` requires every direct recipe component to be held;
- `SELL` is excluded;
- unknown catalog items are excluded.

The actual validation target is not used to construct the candidate set. It is used only after construction to measure coverage and classify uncovered decisions.

Uncovered decisions are classified as:

- unseen in train;
- rejected by catalog legality;
- truncated by the candidate limit;
- unexplained.

## Input verification

Before evaluation starts, the service verifies:

- `validation.ndjson` SHA-256 against the training manifest;
- `model.json` SHA-256 against the training manifest;
- model structure;
- validation row count.

The existing training artifacts are not modified.

## Endpoints

- `POST /deadlock/analysis/contextual-v3-candidate-evaluation/start`
- `GET /deadlock/analysis/contextual-v3-candidate-evaluation/status`
- `GET /deadlock/analysis/contextual-v3-candidate-evaluation/evaluation`
- `GET /deadlock/analysis/contextual-v3-candidate-evaluation/audit`
- `GET /deadlock/analysis/contextual-v3-candidate-evaluation/manifest`

Default start request:

```json
{
  "candidateLimit": 128
}
```

## Output artifacts

Default directory: `/app/apps/api/storage/contextual-v3-candidate-evaluation-v2`

- `candidate-sets.ndjson`
- `evaluation.json`
- `audit.json`
- `manifest.json`

The same validation release gates remain in force:

- candidate coverage at least `98%`;
- Top-1 improvement at least `0.10` percentage points;
- Top-3 regression no worse than `0.05` percentage points.

Passing this validation still does not authorize production deployment. Final testing must use matches strictly newer than `2026-07-22T11:39:43.000Z`.
