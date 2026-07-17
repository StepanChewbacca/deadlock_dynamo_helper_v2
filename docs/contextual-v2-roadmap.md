# Contextual recommendation V2

## Current decision

The production recommendation endpoint returns the baseline transition-policy ranking.
The previous win-odds contextual reranker remains available only for sampled shadow evaluation and diagnostics.

The 10,000-match chronological holdout established the control result:

- model: `HERO_BUILD_CHRONOLOGICAL_HOLDOUT_V1`
- report SHA-256: `e6a9e267e2d37c34ff16bc6740559c0d7f722ea04ffd19d3b13c74d30dc63017`
- coverage: `89.5678%`
- baseline top-1: `28.9761%`
- baseline top-3: `43.7003%`
- contextual top-1 delta: `-0.2387` percentage points
- contextual top-3 delta: `-1.4682` percentage points

## Production shadow mode

`ProductionHeroBuildRecommendationService` returns the baseline response immediately.
A sampled contextual recommendation runs asynchronously and emits structured JSON only when:

- top-1 changes
- the ordered top-3 changes
- at least one situational candidate is detected

Configuration:

```env
DEADLOCK_CONTEXTUAL_SHADOW_ENABLED=true
DEADLOCK_CONTEXTUAL_SHADOW_SAMPLE_RATE=0.1
```

Shadow records use the event name `hero_build_contextual_shadow` and include the baseline and contextual top actions, ordered top-3 lists, matchup promotion counts, enemy roster, and contextual latency.

## Evaluator V2 foundation

`hero-build-offline-evaluation-v2.ts` adds reusable primitives for the next evaluator:

- chronological train, validation, and final-test splitting
- match-clustered paired bootstrap confidence intervals
- McNemar paired top-1 diagnostics
- Benjamini-Hochberg false-discovery correction
- conservative release gates
- typed changed-prediction diagnostics

The recommended default split is:

- 70% training
- 15% validation
- 15% untouched final test

The existing July 2026 holdout must not be reused as the final test after tuning because its hero and phase results have already been inspected.

## Release gates

A candidate contextual model must satisfy all gates on the untouched final test:

- overall top-1 delta at least `+0.10` percentage points
- clustered 95% top-1 lower bound above zero
- overall top-3 delta non-negative
- clustered 95% top-3 lower bound no lower than `-0.05` points
- coverage delta no lower than `-0.05` points
- paired top-1 improvements greater than regressions
- no phase worse than `-0.20` top-1 points
- no large hero segment worse than `-0.50` top-1 points

## Next implementation

The next model should predict the observed action directly rather than using match outcome as the ranking target.
It should begin with a conservative residual reranker:

- candidate pool restricted to baseline top-5
- no insertion from the nearby-state candidate pool
- maximum promotion distance of one position
- baseline top-3 membership preserved
- phase-aware contextual features
- full enemy-roster aggregation instead of selecting the single strongest enemy signal
- hierarchical shrinkage for sparse hero, state, phase, action, and enemy interactions

Hyperparameters must be selected on validation data only. The final chronological test is evaluated once after the configuration is frozen.
