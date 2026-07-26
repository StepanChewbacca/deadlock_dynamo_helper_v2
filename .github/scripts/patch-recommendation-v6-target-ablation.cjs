const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = process.argv[2];
if (!root) {
  throw new Error('Repository root argument is required.');
}

const path = join(
  root,
  'apps/api/src/deadlock-live/recommendation-value-v6-training.service.ts',
);
let content = readFileSync(path, 'utf8');

content = replaceOnce(
  content,
  '  finalOutcomeWeight?: number;\n  expectedSourceSha256?: string;',
  '  finalOutcomeWeight?: number;\n  requireShortHorizonTarget?: boolean;\n  expectedSourceSha256?: string;',
  'start-request-option',
);
content = replaceOnce(
  content,
  '  finalOutcomeWeight: number;\n  expectedSourceSha256?: string;',
  '  finalOutcomeWeight: number;\n  requireShortHorizonTarget: boolean;\n  expectedSourceSha256?: string;',
  'normalized-option',
);
content = replaceOnce(
  content,
  "  options: Pick<RecommendationValueV6TrainingOptions, 'finalOutcomeWeight'>,",
  "  options: Pick<\n    RecommendationValueV6TrainingOptions,\n    'finalOutcomeWeight' | 'requireShortHorizonTarget'\n  >,",
  'prepare-options',
);
content = replaceOnce(
  content,
  '  const finalUtility = playerWon ? 1 : -1;\n  const shortHorizon = computeRecommendationValueV6ShortHorizonUtility(value);\n  const targetUtility = shortHorizon',
  '  const finalUtility = playerWon ? 1 : -1;\n  const shortHorizon = computeRecommendationValueV6ShortHorizonUtility(value);\n  if (options.requireShortHorizonTarget && !shortHorizon) {\n    return undefined;\n  }\n  const targetUtility = shortHorizon',
  'short-horizon-requirement',
);
content = replaceOnce(
  content,
  "        targetComposition: {\n          finalOutcomeWeight: options.finalOutcomeWeight,\n          shortHorizonWeight: 1 - options.finalOutcomeWeight,\n          horizons: [...HORIZONS],\n        },",
  "        targetComposition: {\n          finalOutcomeWeight: options.finalOutcomeWeight,\n          shortHorizonWeight: 1 - options.finalOutcomeWeight,\n          requireShortHorizonTarget: options.requireShortHorizonTarget,\n          horizons: [...HORIZONS],\n        },",
  'model-target-composition',
);
content = replaceOnce(
  content,
  "    finalOutcomeWeight: boundedNumber(\n      request.finalOutcomeWeight ?? 0.25,\n      0,\n      1,\n      'finalOutcomeWeight',\n    ),\n    expectedSourceSha256: normalizeSha(request.expectedSourceSha256),",
  "    finalOutcomeWeight: boundedNumber(\n      request.finalOutcomeWeight ?? 0.25,\n      0,\n      1,\n      'finalOutcomeWeight',\n    ),\n    requireShortHorizonTarget: request.requireShortHorizonTarget === true,\n    expectedSourceSha256: normalizeSha(request.expectedSourceSha256),",
  'normalize-target-option',
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
