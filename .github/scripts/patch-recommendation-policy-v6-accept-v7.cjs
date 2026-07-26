const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = process.argv[2];
if (!root) {
  throw new Error('Repository root argument is required.');
}

const path = join(
  root,
  'apps/api/src/deadlock-live/recommendation-policy-v6-evaluation.service.ts',
);
let content = readFileSync(path, 'utf8');

content = replaceOnce(
  content,
  "export const RECOMMENDATION_POLICY_V6_EVALUATION_VERSION =\n  'RECOMMENDATION_POLICY_V6_DIAGNOSTIC_OPE_1' as const;",
  "export const RECOMMENDATION_POLICY_V6_EVALUATION_VERSION =\n  'RECOMMENDATION_POLICY_V6_DIAGNOSTIC_OPE_1' as const;\nconst RECOMMENDATION_VALUE_V7_TABULAR_MODEL_VERSION =\n  'RECOMMENDATION_VALUE_V7_TABULAR_CANDIDATE_SCORER_1' as const;",
  'v7-model-version',
);
content = replaceOnce(
  content,
  '          valueModelVersion: RECOMMENDATION_VALUE_V6_MODEL_VERSION,',
  "          valueModelVersion: readNestedString(\n            sources.valueManifest,\n            ['modelVersion'],\n          ),",
  'audit-value-model-version',
);
content = replaceOnce(
  content,
  '  if (row.modelVersion !== RECOMMENDATION_VALUE_V6_MODEL_VERSION) {\n    throw new Error(\n      `Value V6 prediction line ${lineNumber} has an unexpected model version.`,\n    );\n  }',
  "  if (\n    row.modelVersion !== RECOMMENDATION_VALUE_V6_MODEL_VERSION &&\n    row.modelVersion !== RECOMMENDATION_VALUE_V7_TABULAR_MODEL_VERSION\n  ) {\n    throw new Error(\n      `Value prediction line ${lineNumber} has an unexpected model version.`,\n    );\n  }",
  'prediction-model-version',
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
