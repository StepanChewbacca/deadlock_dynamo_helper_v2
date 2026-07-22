# Contextual V3 training pipeline

The pipeline consumes the completed Contextual V3 decision dataset and creates a leak-safe chronological training package.

## Source contract

The default source artifact is:

- directory: `/app/apps/api/storage/build-decision-dataset-v3`
- dataset SHA-256: `be4522139021cc5d7c449b0845cba8fbbd7fe781cd2eff5e30099924782770f7`
- dataset rows: `2,665,005`
- source matches: `13,000`
- roster format: standard 6v6 only

The pipeline refuses to start when the source audit failed, the source manifest hash differs from `dataset.ndjson`, or the configured expected SHA-256 differs from the actual file.

## Processing

The source NDJSON is read as a stream in three passes:

1. Collect match timestamps and create an 85/15 chronological split at match level.
2. Fit hero-specific build archetypes from train players only.
3. Write sanitized train and validation rows, fit the hierarchical ranker, create validation candidate shortlists, and evaluate the model.

A match and all of its player decisions belong to exactly one split.

## Feature contract

Prepared rows separate the three semantic groups:

- `features`
- `target`
- `outcomeLabel`

Allowed model features are:

- `heroId`
- `team`
- `gameTimeS`
- `phase`
- `inventoryBeforeStateKey`
- `previousActionKeys`
- `buildPrefixKey`
- `alliedHeroIds`
- `enemyHeroIds`
- `buildArchetypeId`

The following post-decision or target fields are not features:

- `inventoryAfterStateKey`
- `actualActionType`
- `actualItemId`
- `actualActionKey`
- `outcomeLabel.playerWon`
- final kills, deaths, assists, or net worth

## Candidate policy

Validation uses a train-observed shortlist with a configurable maximum size. Candidate actions are filtered against the current inventory and catalog:

- `BUY` and `REBUY` candidates cannot already be held;
- `UPGRADE` candidates require a directly owned recipe component;
- unknown catalog items and sell targets are excluded.

Candidate coverage is reported explicitly and is part of the release gate.

## Model

The first V3 model is a hierarchical count ranker using:

- hero and phase base rates;
- leak-safe build-archetype evidence;
- allied roster interaction evidence;
- enemy roster interaction evidence.

It is evaluated against a hero-and-phase frequency baseline with Top-1, Top-3, and mean reciprocal rank.

The validation release gate requires:

- candidate coverage of at least 98%;
- Top-1 improvement of at least 0.10 percentage points;
- Top-3 regression no worse than 0.05 percentage points.

Passing validation does not authorize production deployment. A final test must use matches strictly newer than the source dataset window.

## Endpoints

- `POST /deadlock/analysis/contextual-v3-training/start`
- `GET /deadlock/analysis/contextual-v3-training/status`
- `GET /deadlock/analysis/contextual-v3-training/manifest`
- `GET /deadlock/analysis/contextual-v3-training/audit`
- `GET /deadlock/analysis/contextual-v3-training/evaluation`
- `GET /deadlock/analysis/contextual-v3-training/archetypes`

Default start request:

```json
{
  "trainFraction": 0.85,
  "maxArchetypesPerHero": 8,
  "minArchetypePlayers": 100,
  "candidateLimit": 64,
  "smoothing": 10
}
```

## Output artifacts

Default directory: `/app/apps/api/storage/contextual-v3-training`

- `train.ndjson`
- `validation.ndjson`
- `candidate-sets.ndjson`
- `archetypes.json`
- `model.json`
- `evaluation.json`
- `audit.json`
- `manifest.json`
