const { readFileSync, writeFileSync } = require('node:fs');

const path = process.argv[2];
if (!path) {
  throw new Error('V7 training script path argument is required.');
}

let content = readFileSync(path, 'utf8');
const before = `    descriptors = sorted(\n        match_first_observed.items(),\n        key=lambda entry: (parse_timestamp(entry[1]), entry[0]),\n    )`;
const after = `    descriptors = sorted(\n        (\n            (match_id, timestamp)\n            for match_id, timestamp in match_first_observed.items()\n            if short_counts.get(match_id, 0) > 0\n        ),\n        key=lambda entry: (parse_timestamp(entry[1]), entry[0]),\n    )`;
const count = content.split(before).length - 1;
if (count !== 1) {
  throw new Error(`short-match-split: expected one target, found ${count}.`);
}
content = content.replace(before, after);
writeFileSync(path, content, 'utf8');
console.log(`Patched ${path}`);
