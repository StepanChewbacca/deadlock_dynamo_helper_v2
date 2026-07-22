# Contextual V3 decision dataset

Contextual V2 did not pass the final release gates. Contextual V3 starts with a persistent, leak-safe decision dataset rather than another enemy-roster reranker.

## Scope

This stage extracts one NDJSON row for each canonical item decision. It does not train a model, generate candidate sets, or assign build archetypes.

The default target excludes `SELL` actions and includes `BUY`, `REBUY`, and `UPGRADE`. Set `includeSellActions` to `true` only for diagnostic exports.

## Endpoints

```text
POST /deadlock/analysis/build-decision-dataset-v3/start
GET  /deadlock/analysis/build-decision-dataset-v3/status
GET  /deadlock/analysis/build-decision-dataset-v3/manifest
GET  /deadlock/analysis/build-decision-dataset-v3/audit
```

Start the full 13,000-match extraction:

```bash
curl -sS -X POST http://localhost:3000/deadlock/analysis/build-decision-dataset-v3/start -H 'Content-Type: application/json' -d '{"maxMatches":13000,"batchSize":100,"includeSellActions":false}' | jq
```

Watch progress:

```bash
watch -n 30 "curl -sS http://localhost:3000/deadlock/analysis/build-decision-dataset-v3/status | jq '{state,phase,processedHeroCount,totalHeroCount,currentHeroId,processedMatchCount,totalMatchCount,rowCount,excludedSequenceCount,excludedSellActionCount,resumedFromCheckpoint,error}'"
```

Read the completed audit:

```bash
curl -sS http://localhost:3000/deadlock/analysis/build-decision-dataset-v3/audit | jq
```

## Persistent artifacts

The default directory is:

```text
/app/apps/api/storage/build-decision-dataset-v3
```

Artifacts:

```text
dataset.ndjson
manifest.json
audit.json
checkpoint.json
```

`checkpoint.json` is written after each completed hero and removed after successful finalization. A compatible checkpoint resumes automatically after an API restart. The partial NDJSON file is truncated to the last checkpoint byte boundary before resume, so the interrupted hero is repeated without duplicating completed heroes.

## Row contract

Each row contains only information available at the decision time, plus an explicitly separated outcome label:

```text
decisionId
matchId
matchStartTime
playerId
heroId
team
gameTimeS
phase
inventoryBeforeStateKey
inventoryAfterStateKey
previousActionKeys
buildPrefixKey
alliedHeroIds
enemyHeroIds
actualActionType
actualItemId
actualActionKey
outcomeLabel.playerWon
```

`buildPrefixKey` is observed action history. It is not a build-archetype label.

Final `kills`, `deaths`, `assists`, and `netWorth` are intentionally excluded from features because they would leak future match information into early decisions. `playerWon` is stored only as an outcome label for later outcome-model work.

## Audit gates

The extraction audit fails when:

- no rows are produced;
- duplicate decision IDs are detected;
- an invalid item ID is emitted;
- canonical decision time moves backwards within a player sequence.

Roster incompleteness and excluded damaged sequences are reported as warnings rather than silently repaired.

## Next stage

After the audit passes:

1. derive hero-specific build archetypes from train-only prefixes;
2. materialize legal candidate sets from the item and recipe graph;
3. build a chronological train, validation, and future final-test split;
4. train an archetype-aware next-item ranker;
5. evaluate it against the frozen production baseline before adding outcome or uplift optimization.
