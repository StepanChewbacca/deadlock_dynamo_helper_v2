import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const modelPath = process.argv[2];
const outputPath = process.argv[3];

if (!modelPath || !outputPath) {
  throw new Error(
    'Usage: node analyze-recommendation-v6-shrinkage.mjs <model.json> <output.json>',
  );
}

const model = JSON.parse(
  execFileSync('sudo', ['cat', modelPath], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  }),
);

const priors = [100, 30, 10, 3, 1, 0.3, 0.1, 0.03];
const counts = model.counts ?? {};
const report = {
  generatedAt: new Date().toISOString(),
  modelPath,
  modelVersion: model.modelVersion,
  actionResidualScale: model.actionResidualScale,
  modelOptions: model.options,
  state: summarizeTable(counts.state, priors),
  action: summarizeTable(counts.action, priors),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, undefined, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, undefined, 2));

function summarizeTable(value, priorValues) {
  const rows = Object.entries(value ?? {}).map(([key, count]) => ({
    key,
    observations: finiteNumber(count?.observations),
    totalWeight: finiteNumber(count?.totalWeight),
    utilityMean: divide(
      finiteNumber(count?.utilitySum),
      finiteNumber(count?.totalWeight),
    ),
  }));
  const weights = rows.map((row) => row.totalWeight).sort(ascending);
  const observations = rows.map((row) => row.observations).sort(ascending);
  return {
    keyCount: rows.length,
    observations: distribution(observations),
    totalWeight: distribution(weights),
    shrinkageByPrior: Object.fromEntries(
      priorValues.map((prior) => {
        const factors = weights
          .map((weight) => divide(weight, weight + prior))
          .sort(ascending);
        return [String(prior), {
          distribution: distribution(factors),
          rateBelow001: rate(factors, (value) => value < 0.01),
          rateBelow005: rate(factors, (value) => value < 0.05),
          rateBelow010: rate(factors, (value) => value < 0.1),
          rateAtLeast050: rate(factors, (value) => value >= 0.5),
        }];
      }),
    ),
    highestWeightKeys: [...rows]
      .sort((left, right) => right.totalWeight - left.totalWeight || left.key.localeCompare(right.key))
      .slice(0, 25),
  };
}

function distribution(values) {
  if (values.length === 0) {
    return {
      count: 0,
      min: 0,
      p01: 0,
      p05: 0,
      p10: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      mean: 0,
    };
  }
  return {
    count: values.length,
    min: values[0],
    p01: quantile(values, 0.01),
    p05: quantile(values, 0.05),
    p10: quantile(values, 0.1),
    p25: quantile(values, 0.25),
    p50: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.9),
    p95: quantile(values, 0.95),
    p99: quantile(values, 0.99),
    max: values[values.length - 1],
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function quantile(sorted, probability) {
  if (sorted.length === 1) {
    return sorted[0];
  }
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

function rate(values, predicate) {
  return values.length === 0
    ? 0
    : values.filter(predicate).length / values.length;
}

function finiteNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function divide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function ascending(left, right) {
  return left - right;
}
