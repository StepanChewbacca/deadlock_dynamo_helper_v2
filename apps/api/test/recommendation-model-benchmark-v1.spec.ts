import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface BenchmarkModel {
  id: string;
  family: string;
  selection: {
    testUsedForSelection: boolean;
  };
  test: {
    actionRmse: number;
    utilityRmseImprovement: number;
    averageTopCandidateSeparation: number;
    observedActionTop1Agreement: number;
    observedActionMeanReciprocalRank: number;
    pairwiseObservedActionAccuracy: number;
    observedActionNdcg: number;
  };
}

interface BenchmarkDocument {
  benchmarkVersion: string;
  terminology: {
    rankingMetricPrefix: string;
  };
  models: BenchmarkModel[];
  benchmarks: Record<string, string>;
  decision: {
    productionRolloutAuthorized: boolean;
    shadowRolloutAuthorized: boolean;
  };
}

const repositoryRoot = resolve(__dirname, '../../..');
const benchmarkPath = resolve(
  repositoryRoot,
  'docs/recommendation-model-benchmark-v1/benchmark.json',
);

async function loadBenchmark(): Promise<BenchmarkDocument> {
  return JSON.parse(await readFile(benchmarkPath, 'utf8')) as BenchmarkDocument;
}

describe('Recommendation Model Benchmark V1', () => {
  it('registers every evaluated V6 configuration and the V7 negative control', async () => {
    const benchmark = await loadBenchmark();
    const ids = benchmark.models.map((model) => model.id);

    expect(benchmark.benchmarkVersion).toBe(
      'RECOMMENDATION_MODEL_BENCHMARK_V1',
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('coarse-s10-a0p1-m10-w025-short-only-v2');
    expect(ids).toContain('coarse-s30-a1-m20-w025');
    expect(ids).toContain('v7-catboost-state-plus-candidate');
    expect(benchmark.models).toHaveLength(9);
  });

  it('uses observed-action terminology instead of correctness labels', async () => {
    const benchmark = await loadBenchmark();

    expect(benchmark.terminology.rankingMetricPrefix).toBe('observedAction');
    for (const model of benchmark.models) {
      expect(Number.isFinite(model.test.observedActionTop1Agreement)).toBe(true);
      expect(
        Number.isFinite(model.test.observedActionMeanReciprocalRank),
      ).toBe(true);
      expect(
        Number.isFinite(model.test.pairwiseObservedActionAccuracy),
      ).toBe(true);
      expect(Number.isFinite(model.test.observedActionNdcg)).toBe(true);
      expect(model.selection.testUsedForSelection).toBe(false);
    }
  });

  it('freezes the V6 benchmarks and V7 action-collapse negative control', async () => {
    const benchmark = await loadBenchmark();
    const byId = new Map(benchmark.models.map((model) => [model.id, model]));
    const primary = byId.get(benchmark.benchmarks.primaryV6);
    const separation = byId.get(benchmark.benchmarks.separationV6);
    const negative = byId.get(benchmark.benchmarks.negativeControl);

    expect(primary?.test.utilityRmseImprovement).toBe(
      0.028885780860855664,
    );
    expect(primary?.test.averageTopCandidateSeparation).toBe(
      0.010764984953676027,
    );
    expect(separation?.test.averageTopCandidateSeparation).toBe(
      0.02840419543725379,
    );
    expect(negative?.family).toBe('V7_CATBOOST_STATE_PLUS_CANDIDATE');
    expect(negative?.test.averageTopCandidateSeparation).toBe(0);
  });

  it('preserves the no-rollout decision', async () => {
    const benchmark = await loadBenchmark();

    expect(benchmark.decision.productionRolloutAuthorized).toBe(false);
    expect(benchmark.decision.shadowRolloutAuthorized).toBe(false);
  });
});
