const { readFileSync, writeFileSync } = require('node:fs');

const path = process.argv[2];
if (!path) {
  throw new Error('Validator path argument is required.');
}

function replaceOnce(content, before, after, name) {
  const count = content.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${name}: expected one target, found ${count}.`);
  }
  return content.replace(before, after);
}

let content = readFileSync(path, 'utf8');
content = replaceOnce(
  content,
  "const datasetDirectory =\n  'recommendation-decision-dataset-v5-full-crawler-20260726';",
  "const datasetDirectory =\n  'recommendation-decision-dataset-v5-full-crawler-db-timeline-20260726';",
  'validator-dataset-directory',
);
content = replaceOnce(
  content,
  "const valueDirectory = 'recommendation-value-v6-full-crawler-20260726';",
  "const valueDirectory = 'recommendation-value-v6-full-crawler-db-timeline-20260726';",
  'validator-value-directory',
);
content = replaceOnce(
  content,
  "const policyDirectory = 'recommendation-policy-v6-full-crawler-20260726';",
  "const policyDirectory = 'recommendation-policy-v6-full-crawler-db-timeline-20260726';",
  'validator-policy-directory',
);
content = replaceOnce(
  content,
  "const datasetPath = join(volumeRoot, datasetDirectory, 'dataset.ndjson');\nconst datasetManifestPath = join(volumeRoot, datasetDirectory, 'manifest.json');",
  "const datasetManifestPath = join(volumeRoot, datasetDirectory, 'manifest.json');\nconst datasetManifest = readJson(datasetManifestPath);\nconst datasetFileName = requiredText(\n  datasetManifest?.artifact?.fileName,\n  'Dataset V5.3 artifact file name',\n);\nconst datasetPath = join(volumeRoot, datasetDirectory, datasetFileName);",
  'validator-dataset-path',
);
content = replaceOnce(
  content,
  "const fs = require('node:fs');\nconst readline = require('node:readline');",
  "const fs = require('node:fs');\nconst readline = require('node:readline');\nconst zlib = require('node:zlib');",
  'validator-zlib-import',
);
content = replaceOnce(
  content,
  "  const lines = readline.createInterface({\n    input: fs.createReadStream(path, { encoding: 'utf8' }),\n    crlfDelay: Infinity,\n  });",
  "  const file = fs.createReadStream(path);\n  const input = path.endsWith('.gz') ? file.pipe(zlib.createGunzip()) : file;\n  input.setEncoding('utf8');\n  const lines = readline.createInterface({\n    input,\n    crlfDelay: Infinity,\n  });",
  'validator-gzip-stream',
);
content = replaceOnce(
  content,
  "  commandOutput('sudo', [\n    'node',\n    '-e',",
  "  commandOutput('sudo', [\n    process.execPath,\n    '-e',",
  'validator-sudo-node-path',
);
content = replaceOnce(
  content,
  "const datasetManifest = readJson(datasetManifestPath);\nconst datasetAudit = readJson(datasetAuditPath);",
  'const datasetAudit = readJson(datasetAuditPath);',
  'validator-duplicate-manifest-read',
);
content = replaceOnce(
  content,
  "function requiredSha(value, name) {",
  "function requiredText(value, name) {\n  const normalized = typeof value === 'string' ? value.trim() : '';\n  assertTrue(normalized.length > 0, `${name} is missing or invalid.`);\n  return normalized;\n}\n\nfunction requiredSha(value, name) {",
  'validator-required-text',
);
writeFileSync(path, content, 'utf8');
console.log(`Patched ${path}`);
