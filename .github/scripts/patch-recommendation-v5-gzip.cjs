const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = process.argv[2];
if (!root) {
  throw new Error('Repository root argument is required.');
}

function replaceOnce(content, before, after, name) {
  const count = content.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${name}: expected one target, found ${count}.`);
  }
  return content.replace(before, after);
}

function replaceCount(content, before, after, expectedCount, name) {
  const count = content.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${name}: expected ${expectedCount} targets, found ${count}.`);
  }
  return content.split(before).join(after);
}

function patch(path, transform) {
  const absolutePath = join(root, path);
  const before = readFileSync(absolutePath, 'utf8');
  const after = transform(before);
  if (after === before) {
    throw new Error(`${path}: patch produced no changes.`);
  }
  writeFileSync(absolutePath, after, 'utf8');
  console.log(`Patched ${path}`);
}

patch(
  'apps/api/src/deadlock-live/recommendation-decision-dataset-v5.service.ts',
  (input) => {
    let content = input;
    content = replaceOnce(
      content,
      "import { createReadStream } from 'node:fs';",
      "import { once } from 'node:events';\nimport { createReadStream, createWriteStream } from 'node:fs';",
      'v5-fs-import',
    );
    content = replaceOnce(
      content,
      "import { dirname, join } from 'node:path';\nimport { createInterface } from 'node:readline';",
      "import { dirname, join } from 'node:path';\nimport { createInterface } from 'node:readline';\nimport { createGzip } from 'node:zlib';",
      'v5-zlib-import',
    );
    content = replaceOnce(
      content,
      "const DATASET_FILE = 'dataset.ndjson';",
      "const SOURCE_DATASET_FILE = 'dataset.ndjson';\nconst DATASET_FILE = 'dataset.ndjson.gz';",
      'v5-dataset-file-constants',
    );
    content = replaceOnce(
      content,
      '  const path = join(directory, DATASET_FILE);',
      '  const path = join(directory, SOURCE_DATASET_FILE);',
      'v5-source-file',
    );
    content = replaceOnce(
      content,
      "  const handle = await open(`${outputPath}.partial`, 'w');",
      "  const writer = await GzipLineWriter.create(`${outputPath}.partial`);",
      'v5-part-writer-create',
    );
    content = replaceOnce(
      content,
      "        await handle.write(`${JSON.stringify(result.row)}\\n`);",
      '        await writer.write(result.row);',
      'v5-part-writer-write',
    );
    content = replaceOnce(
      content,
      "  } finally {\n    await handle.close();\n  }\n  stats.duplicateDecisionIdCount = duplicates.size;",
      "  } catch (error) {\n    await writer.abort();\n    throw error;\n  }\n  await writer.close();\n  stats.duplicateDecisionIdCount = duplicates.size;",
      'v5-part-writer-close',
    );
    content = replaceOnce(
      content,
      "        artifact: {\n          format: 'NDJSON',\n          fileName: DATASET_FILE,",
      "        artifact: {\n          format: 'NDJSON_GZIP',\n          fileName: DATASET_FILE,",
      'v5-manifest-format',
    );
    content = replaceOnce(
      content,
      "function outputPart(paths: Paths, index: number): string {\n  return join(paths.outputParts, `part-${String(index).padStart(4, '0')}.ndjson`);\n}",
      "function outputPart(paths: Paths, index: number): string {\n  return join(paths.outputParts, `part-${String(index).padStart(4, '0')}.ndjson.gz`);\n}",
      'v5-output-part-extension',
    );
    content = replaceOnce(
      content,
      'async function combineParts(paths: Paths, partitionCount: number): Promise<void> {',
      `class GzipLineWriter {\n  private readonly completion: Promise<void>;\n\n  private constructor(\n    private readonly gzip: ReturnType<typeof createGzip>,\n    private readonly output: ReturnType<typeof createWriteStream>,\n  ) {\n    this.completion = new Promise<void>((resolve, reject) => {\n      this.output.once('close', resolve);\n      this.output.once('error', reject);\n      this.gzip.once('error', reject);\n    });\n  }\n\n  static async create(path: string): Promise<GzipLineWriter> {\n    const output = createWriteStream(path, { flags: 'w' });\n    await once(output, 'open');\n    const gzip = createGzip({ level: 6 });\n    gzip.pipe(output);\n    return new GzipLineWriter(gzip, output);\n  }\n\n  async write(value: unknown): Promise<void> {\n    if (!this.gzip.write(\`${'${JSON.stringify(value)}'}\\n\`)) {\n      await once(this.gzip, 'drain');\n    }\n  }\n\n  async close(): Promise<void> {\n    this.gzip.end();\n    await this.completion;\n  }\n\n  async abort(): Promise<void> {\n    this.gzip.destroy();\n    this.output.destroy();\n    await this.completion.catch(() => undefined);\n  }\n}\n\nasync function combineParts(paths: Paths, partitionCount: number): Promise<void> {`,
      'v5-gzip-writer-class',
    );
    return content;
  },
);

patch(
  'apps/api/src/deadlock-live/recommendation-value-v6-training.service.ts',
  (input) => {
    let content = input;
    content = replaceOnce(
      content,
      "import { createInterface } from 'node:readline';",
      "import { createInterface } from 'node:readline';\nimport { createGunzip } from 'node:zlib';",
      'value-zlib-import',
    );
    content = replaceOnce(
      content,
      "  private readonly sourceDatasetPath = join(\n    this.sourceDirectory,\n    'dataset.ndjson',\n  );",
      "  private sourceDatasetPath = join(this.sourceDirectory, 'dataset.ndjson');",
      'value-source-path-property',
    );
    content = replaceOnce(
      content,
      "    const artifact = record(manifest.artifact);\n    const expectedSha256 = requiredSha(artifact.sha256);",
      "    const artifact = record(manifest.artifact);\n    const artifactFileName = requiredText(artifact.fileName);\n    this.sourceDatasetPath = join(this.sourceDirectory, artifactFileName);\n    const expectedSha256 = requiredSha(artifact.sha256);",
      'value-manifest-file-name',
    );
    content = replaceOnce(
      content,
      "  const input = createReadStream(path, { encoding: 'utf8' });\n  const lines = createInterface({ input, crlfDelay: Infinity });",
      "  const file = createReadStream(path);\n  const input = path.endsWith('.gz') ? file.pipe(createGunzip()) : file;\n  input.setEncoding('utf8');\n  const lines = createInterface({ input, crlfDelay: Infinity });",
      'value-gzip-source-stream',
    );
    content = replaceOnce(
      content,
      "    lines.close();\n    input.destroy();",
      "    lines.close();\n    input.destroy();\n    file.destroy();",
      'value-gzip-source-cleanup',
    );
    return content;
  },
);

patch('apps/api/test/recommendation-decision-dataset-v5.spec.ts', (input) => {
  let content = input;
  content = replaceOnce(
    content,
    "import { createHash } from 'node:crypto';",
    "import { createHash } from 'node:crypto';\nimport { promisify } from 'node:util';\nimport { gunzip } from 'node:zlib';",
    'v5-test-gzip-imports',
  );
  content = replaceCount(
    content,
    "join(outputDirectory, 'dataset.ndjson')",
    "join(outputDirectory, 'dataset.ndjson.gz')",
    3,
    'v5-test-output-paths',
  );
  content = replaceOnce(
    content,
    "async function readNdjson(path: string): Promise<any[]> {\n  return (await readFile(path, 'utf8')).split('\\n').filter(Boolean).map((line) => JSON.parse(line));\n}",
    "const gunzipAsync = promisify(gunzip);\n\nasync function readNdjson(path: string): Promise<any[]> {\n  const compressed = await readFile(path);\n  const content = (await gunzipAsync(compressed)).toString('utf8');\n  return content.split('\\n').filter(Boolean).map((line) => JSON.parse(line));\n}",
    'v5-test-reader',
  );
  return content;
});
