# Recommendation Value V5

Recommendation Value V5 is an offline-only observational outcome model over Recommendation Decision Dataset V4.

## Data split

The pipeline uses a deterministic chronological match-level split:

- oldest 70% for training;
- next 15% for tuning;
- newest 15% as an untouched test set.

No match may appear in more than one split. The descriptor list is hashed and persisted in the audit and manifest.

## Match balancing

Every eligible match contributes total weight 1 regardless of its number of decisions. Each row receives weight `1 / eligibleDecisionCountForMatch`.

This prevents long matches and high-frequency decision sequences from dominating training or evaluation.

## Model structure

The model separates:

- `V(state)`: observational state win probability;
- `A(state, action)`: a bounded action-conditioned logit residual.

The action residual scale is selected only on the tuning split. The untouched test split is evaluated once after selection.

## Safety and interpretation

The model predicts observational player win probability. It is not a causal treatment-effect model and must not be interpreted as proof that an action causes a win.

Value V5 does not change live serving. Production rollout requires separate policy evaluation and explicit release approval.

## Artifacts

The training directory contains:

- `train.ndjson`;
- `tuning.ndjson`;
- `test.ndjson`;
- `model.json`;
- `evaluation.json`;
- `audit.json`;
- `manifest.json`.

The service verifies the source audit, source SHA-256, row counts, decision-ID uniqueness, match-level outcome consistency, split isolation, and per-match weight totals before marking the run complete.
