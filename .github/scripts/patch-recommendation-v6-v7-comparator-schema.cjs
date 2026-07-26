const { readFileSync, writeFileSync } = require('node:fs');

const path = process.argv[2];
if (!path) {
  throw new Error('Comparator script path argument is required.');
}

let content = readFileSync(path, 'utf8');
content = replaceOnce(
  content,
  'coverage.candidateCoverage ?? coverage.candidateCoveredDecisionRate',
  'coverage.candidateCoverageRate ?? coverage.candidateCoverage ?? coverage.candidateCoveredDecisionRate',
  'candidate-coverage-rate',
);
content = replaceOnce(
  content,
  'coverage.behaviorSupport ?? coverage.behaviorSupportedDecisionRate',
  'coverage.behaviorSupportRate ?? coverage.behaviorSupport ?? coverage.behaviorSupportedDecisionRate',
  'behavior-support-rate',
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
