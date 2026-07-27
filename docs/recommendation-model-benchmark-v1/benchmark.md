# Recommendation Model Benchmark V1

Source archive SHA-256: `e19becb1c1968ffcdcc725fb844b624c02b5d2f8e7a1a79073b209e34b4caf12`

All ranking metrics describe agreement with the historically observed action. They are not correctness labels and do not establish causal item quality.

| Model | Family | Action RMSE | RMSE improvement | Mean separation | Observed-action Top1 | Pairwise observed-action | Observed-action NDCG | Release gate |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `coarse-s10-a0p1-m10-w025` | `V6_LOOKUP_RESIDUAL` | 0.782424838 | 0.009991521 | 0.018773098 | 0.048435647 | 0.493946522 | 0.286716053 | PASS |
| `coarse-s10-a0p1-m10-w025-min5` | `V6_LOOKUP_RESIDUAL` | 0.782123630 | 0.010309066 | 0.017640046 | 0.042322280 | 0.505419400 | 0.276815038 | PASS |
| `coarse-s10-a0p1-m10-w025-short-only-v2` | `V6_LOOKUP_RESIDUAL` | 0.204167289 | 0.028885781 | 0.010764985 | 0.062140691 | 0.460878010 | 0.290071696 | FAIL |
| `coarse-s10-a0p1-m10-w025-w000-current-fallback` | `V6_LOOKUP_RESIDUAL` | 0.787672183 | 0.025017915 | 0.034542552 | 0.051947019 | 0.490409389 | 0.289125523 | FAIL |
| `coarse-s10-a0p1-m10-w025-w010` | `V6_LOOKUP_RESIDUAL` | 0.778445956 | 0.020376731 | 0.035657455 | 0.051359312 | 0.492007240 | 0.288990628 | FAIL |
| `coarse-s100-a10-m20-w025` | `V6_LOOKUP_RESIDUAL` | 0.790489921 | 0.006245684 | 0.010828185 | 0.094100084 | 0.472337531 | 0.321470068 | PASS |
| `coarse-s100-a100-m20-w025` | `V6_LOOKUP_RESIDUAL` | 0.793310961 | 0.003424644 | 0.004850989 | 0.094876408 | 0.472353880 | 0.322166770 | PASS |
| `coarse-s30-a1-m20-w025` | `V6_LOOKUP_RESIDUAL` | 0.783771970 | 0.011522700 | 0.028404195 | 0.084553195 | 0.473230521 | 0.315496080 | PASS |
| `v7-catboost-state-plus-candidate` | `V7_CATBOOST_STATE_PLUS_CANDIDATE` | 0.193908090 | -0.000072245 | 0.000000000 | 0.004161991 | 0.352409164 | 0.199994071 | FAIL |

## Fixed benchmark roles

- Primary empirical benchmark: `coarse-s10-a0p1-m10-w025-short-only-v2`.
- Separation benchmark: `coarse-s30-a1-m20-w025`.
- State benchmark and action-collapse negative control: `v7-catboost-state-plus-candidate`.

## Policy diagnostics

Both policy reports use estimated Behavioral V4 propensities. They are observational diagnostics and cannot authorize rollout.

## Frozen decision

- Production rollout: not authorized.
- Shadow rollout for these candidates: not authorized.
- Next research stage: improve propensity estimation and candidate-specific causal identification.
