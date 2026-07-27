import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const directory = resolve(root, 'docs/recommendation-model-benchmark-v1');
const benchmark = JSON.parse(
  await readFile(resolve(directory, 'benchmark.json'), 'utf8'),
);
const lineage = JSON.parse(
  await readFile(resolve(directory, 'lineage.json'), 'utf8'),
);

const fail = (message) => {
  throw new Error(`Recommendation benchmark validation failed: ${message}`);
};

const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} must be finite.`);
  }
};

const sha = (value, name) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${name} must be SHA-256.`);
  }
};

if (benchmark.schemaVersion !== 1) {
  fail('schemaVersion must be 1.');
}
if (benchmark.benchmarkVersion !== 'RECOMMENDATION_MODEL_BENCHMARK_V1') {
  fail('unexpected benchmarkVersion.');
}
sha(benchmark.source?.archiveSha256, 'source.archiveSha256');
if (benchmark.source.archiveSha256 !== lineage.sourceArchiveSha256) {
  fail('archive lineage mismatch.');
}
if (benchmark.decision?.productionRolloutAuthorized !== false) {
  fail('production rollout must remain unauthorized.');
}
if (benchmark.decision?.shadowRolloutAuthorized !== false) {
  fail('shadow rollout must remain unauthorized.');
}
if (benchmark.terminology?.rankingMetricPrefix !== 'observedAction') {
  fail('ranking terminology must use observedAction.');
}

if (!Array.isArray(benchmark.models) || benchmark.models.length < 9) {
  fail('all V6 sweep models and V7 must be registered.');
}

const ids = new Set();
for (const model of benchmark.models) {
  if (typeof model.id !== 'string' || model.id.length === 0) {
    fail('model id is required.');
  }
  if (ids.has(model.id)) {
    fail(`duplicate model id ${model.id}.`);
  }
  ids.add(model.id);
  if (model.selection?.testUsedForSelection !== false) {
    fail(`${model.id} must not use test for selection.`);
  }
  finite(model.test?.actionRmse, `${model.id}.test.actionRmse`);
  finite(
    model.test?.utilityRmseImprovement,
    `${model.id}.test.utilityRmseImprovement`,
  );
  finite(
    model.test?.averageTopCandidateSeparation,
    `${model.id}.test.averageTopCandidateSeparation`,
  );
  finite(
    model.test?.observedActionTop1Agreement,
    `${model.id}.test.observedActionTop1Agreement`,
  );
  finite(
    model.test?.observedActionMeanReciprocalRank,
    `${model.id}.test.observedActionMeanReciprocalRank`,
  );
  finite(
    model.test?.pairwiseObservedActionAccuracy,
    `${model.id}.test.pairwiseObservedActionAccuracy`,
  );
  finite(
    model.test?.observedActionNdcg,
    `${model.id}.test.observedActionNdcg`,
  );
}

for (const [role, id] of Object.entries(benchmark.benchmarks ?? {})) {
  if (!ids.has(id)) {
    fail(`benchmark role ${role} references unknown model ${id}.`);
  }
}

const primary = benchmark.models.find(
  (model) => model.id === benchmark.benchmarks.primaryV6,
);
const separation = benchmark.models.find(
  (model) => model.id === benchmark.benchmarks.separationV6,
);
const negative = benchmark.models.find(
  (model) => model.id === benchmark.benchmarks.negativeControl,
);

if (primary.test.utilityRmseImprovement !== 0.028885780860855664) {
  fail('primary V6 RMSE improvement drifted.');
}
if (primary.test.averageTopCandidateSeparation !== 0.010764984953676027) {
  fail('primary V6 separation drifted.');
}
if (separation.test.averageTopCandidateSeparation !== 0.02840419543725379) {
  fail('separation V6 metric drifted.');
}
if (negative.family !== 'V7_CATBOOST_STATE_PLUS_CANDIDATE') {
  fail('negative control must be V7 CatBoost.');
}
if (negative.test.averageTopCandidateSeparation !== 0) {
  fail('V7 collapse negative control must preserve zero separation.');
}

sha(lineage.dataset?.sha256, 'lineage.dataset.sha256');
sha(
  lineage.dataset?.upstreamDatasetV4Sha256,
  'lineage.dataset.upstreamDatasetV4Sha256',
);
sha(
  lineage.dataset?.splitDescriptorSha256,
  'lineage.dataset.splitDescriptorSha256',
);
sha(lineage.behavioralV4?.modelSha256, 'lineage.behavioralV4.modelSha256');
sha(lineage.v6Winner?.modelSha256, 'lineage.v6Winner.modelSha256');
sha(
  lineage.v6Winner?.predictionSha256,
  'lineage.v6Winner.predictionSha256',
);
sha(lineage.v7?.modelSha256, 'lineage.v7.modelSha256');
sha(lineage.v7?.predictionSha256, 'lineage.v7.predictionSha256');

console.log(
  JSON.stringify(
    {
      benchmarkVersion: benchmark.benchmarkVersion,
      modelCount: benchmark.models.length,
      policyCount: benchmark.policies.length,
      primaryV6: benchmark.benchmarks.primaryV6,
      negativeControl: benchmark.benchmarks.negativeControl,
      productionRolloutAuthorized:
        benchmark.decision.productionRolloutAuthorized,
    },
    null,
    2,
  ),
);
