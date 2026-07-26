const { readFileSync, writeFileSync } = require('node:fs');

const path = process.argv[2];
if (!path) {
  throw new Error('Sweep script path argument is required.');
}

let content = readFileSync(path, 'utf8');

content = replaceOnce(
  content,
  "  createConfig(\n    `${coarseWinner.config.id}-w000-current-fallback`,\n    coarseWinner.config.statePriorStrength,\n    coarseWinner.config.actionPriorStrength,\n    coarseWinner.config.minimumObservations,\n    0,\n  ),",
  "  createConfig(\n    `${coarseWinner.config.id}-w000-current-fallback`,\n    coarseWinner.config.statePriorStrength,\n    coarseWinner.config.actionPriorStrength,\n    coarseWinner.config.minimumObservations,\n    0,\n  ),\n  createConfig(\n    `${coarseWinner.config.id}-short-only`,\n    coarseWinner.config.statePriorStrength,\n    coarseWinner.config.actionPriorStrength,\n    coarseWinner.config.minimumObservations,\n    0,\n    true,\n  ),",
  'refinement-short-only-config',
);
content = replaceOnce(
  content,
  '      finalOutcomeWeight: config.finalOutcomeWeight,\n      expectedSourceSha256: datasetSha256,',
  '      finalOutcomeWeight: config.finalOutcomeWeight,\n      requireShortHorizonTarget: config.requireShortHorizonTarget,\n      expectedSourceSha256: datasetSha256,',
  'request-short-horizon-option',
);
content = replaceOnce(
  content,
  "  assertTrue(\n    Number(model?.targetComposition?.finalOutcomeWeight) === config.finalOutcomeWeight,\n    `${config.id} final outcome weight does not match the requested configuration.`,\n  );",
  "  assertTrue(\n    Number(model?.targetComposition?.finalOutcomeWeight) === config.finalOutcomeWeight,\n    `${config.id} final outcome weight does not match the requested configuration.`,\n  );\n  assertTrue(\n    model?.targetComposition?.requireShortHorizonTarget ===\n      config.requireShortHorizonTarget,\n    `${config.id} short-horizon requirement does not match the requested configuration.`,\n  );",
  'validate-short-horizon-option',
);
content = replaceOnce(
  content,
  'function createConfig(id, statePriorStrength, actionPriorStrength, minimumObservations, finalOutcomeWeight) {\n  const options = {\n    statePriorStrength,\n    actionPriorStrength,\n    minimumObservations,\n    finalOutcomeWeight,\n    actionResidualScales,\n  };',
  'function createConfig(\n  id,\n  statePriorStrength,\n  actionPriorStrength,\n  minimumObservations,\n  finalOutcomeWeight,\n  requireShortHorizonTarget = false,\n) {\n  const options = {\n    statePriorStrength,\n    actionPriorStrength,\n    minimumObservations,\n    finalOutcomeWeight,\n    requireShortHorizonTarget,\n    actionResidualScales,\n  };',
  'config-short-horizon-option',
);

writeFileSync(path, content, 'utf8');
console.log(`Patched ${path}`);

function replaceOnce(input, before, after, name) {
  const count = input.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${name}: expected one target, found ${count}.`);
  }
  return input.replace(before, after);
}
