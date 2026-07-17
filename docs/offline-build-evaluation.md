# Offline build evaluation

The offline evaluator measures how well the existing item recommendation graph predicts the next canonical item action in newer historical matches.

It does not claim that the observed player action was objectively optimal. The target is agreement with held-out historical behavior.

## Data split

Matches are sorted by start time. The older portion is used for training and the newer portion is used only for evaluation.

The default split is:

- 80% training matches
- 20% test matches
- up to 10,000 matches from the current recent-match window

A match ID is never present in both sets.

The training set builds:

- the normal hero inventory transition policy
- matchup outcome statistics used by contextual reranking

The test set contributes only observed targets and is never included in either model.

## Metrics

The report contains the same metrics for the baseline and contextual recommenders:

- `coverage` - fraction of held-out steps where at least one legal action was recommended
- `top1Accuracy` - fraction of all held-out steps where the first recommendation matched the observed action
- `top3Accuracy` - fraction of all held-out steps where the observed action appeared in the first three recommendations
- `top1AccuracyWhenCovered` - top-1 accuracy restricted to covered steps
- `top3AccuracyWhenCovered` - top-3 accuracy restricted to covered steps
- exact, backoff, and no-match counts

`REBUY` targets are normalized to `BUY` because the public recommender exposes both as a legal buy action.

The report also includes:

- metrics by hero
- metrics by early, mid, and late game phase
- metrics by hero and phase
- metrics for wins and losses
- counts where contextual reranking improved or worsened the top recommendation
- bounded error examples with state, enemies, actual action, and both ranked outputs

## API

Start an evaluation:

```bash
curl -X POST http://localhost:3000/deadlock/analysis/build-evaluation/start \
  -H 'Content-Type: application/json' \
  -d '{
    "trainFraction": 0.8,
    "maxMatches": 10000,
    "errorExampleLimit": 100
  }'
```

The endpoint returns `202 Accepted`. The evaluation runs in the API process without blocking the request.

Check progress:

```bash
curl http://localhost:3000/deadlock/analysis/build-evaluation/status
```

Read the completed report:

```bash
curl http://localhost:3000/deadlock/analysis/build-evaluation/report \
  -o hero-build-offline-evaluation.json
```

The report endpoint returns:

- `409 Conflict` while evaluation is running
- `404 Not Found` before any successful evaluation is available

## Request limits

- `trainFraction`: `0.5` through `0.95`
- `maxMatches`: `2` through `10000`
- `errorExampleLimit`: `0` through `500`

Only one evaluation runs at a time. Calling the start endpoint while a run is active returns the current status instead of starting a second run.

## Interpretation

A higher contextual score means enemy-roster reranking more closely reproduces held-out historical actions. It does not prove that those actions caused a win or that they were optimal.

Useful decisions after the evaluation include:

- ship the baseline graph unchanged
- keep contextual reranking when it improves held-out metrics without materially reducing coverage
- disable or narrow matchup reranking when it changes many recommendations but worsens accuracy
- improve backoff when no-match coverage is too low
- inspect error examples for illegal, overly generic, or poorly timed recommendations
