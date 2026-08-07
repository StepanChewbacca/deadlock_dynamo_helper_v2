#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value)


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    if new in value and old not in value:
        return
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    write(path, value.replace(old, new, 1))


helper = r'''import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createGunzip, createGzip } from 'node:zlib';

const GZIP_MAGIC_FIRST = 0x1f;
const GZIP_MAGIC_SECOND = 0x8b;
const BUFFER_FLUSH_BYTES = 1024 * 1024;

export async function openMaybeGzipNdjsonReadStream(
  path: string,
): Promise<Readable> {
  const handle = await open(path, 'r');
  const magic = Buffer.alloc(2);
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(magic, 0, magic.length, 0));
  } finally {
    await handle.close();
  }

  const source = createReadStream(path);
  const stream =
    bytesRead === 2 &&
    magic[0] === GZIP_MAGIC_FIRST &&
    magic[1] === GZIP_MAGIC_SECOND
      ? source.pipe(createGunzip())
      : source;
  stream.setEncoding('utf8');
  return stream;
}

export class GzipNdjsonWriter {
  private readonly input = new PassThrough();
  private readonly completion: Promise<void>;
  private buffer = '';
  private closed = false;
  private uncompressedBytes = 0;

  private constructor(private readonly path: string) {
    const output = createWriteStream(path, { flags: 'w' });
    this.completion = pipeline(
      this.input,
      createGzip({
        level: constants.Z_BEST_SPEED,
        chunkSize: BUFFER_FLUSH_BYTES,
      }),
      output,
    );
    void this.completion.catch(() => undefined);
  }

  static async create(path: string): Promise<GzipNdjsonWriter> {
    await mkdir(dirname(path), { recursive: true });
    return new GzipNdjsonWriter(path);
  }

  get uncompressedByteLength(): number {
    return this.uncompressedBytes;
  }

  async write(value: unknown): Promise<void> {
    if (this.closed) {
      throw new Error(`GzipNdjsonWriter is closed for ${this.path}.`);
    }
    this.buffer += `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(this.buffer, 'utf8') >= BUFFER_FLUSH_BYTES) {
      await this.flush();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.flush();
    this.input.end();
    await this.completion;
    this.closed = true;
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      this.input.destroy();
      try {
        await this.completion;
      } catch {
        // The failed pipeline is expected during abort.
      }
      this.closed = true;
    }
    await rm(this.path, { force: true });
  }

  private async flush(): Promise<void> {
    if (!this.buffer) {
      return;
    }
    const value = Buffer.from(this.buffer, 'utf8');
    this.buffer = '';
    this.uncompressedBytes += value.length;
    if (!this.input.write(value)) {
      await once(this.input, 'drain');
    }
  }
}
'''
write('apps/api/src/deadlock-live/gzip-ndjson.ts', helper)

DATASET = 'apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6-artifact.service.ts'
replace_once(DATASET, "  open,\n", "")
replace_once(DATASET, "import type { FileHandle } from 'node:fs/promises';\n", "")
replace_once(
    DATASET,
    "import { createInterface } from 'node:readline';\n",
    "import { createInterface } from 'node:readline';\nimport { GzipNdjsonWriter } from './gzip-ndjson';\n",
)
replace_once(
    DATASET,
    "    format: 'NDJSON';\n    fileName: typeof DATASET_FILE_NAME;\n    byteLength: number;\n",
    "    format: 'NDJSON';\n    compression: 'GZIP';\n    fileName: typeof DATASET_FILE_NAME;\n    byteLength: number;\n    uncompressedByteLength: number;\n",
)
replace_once(
    DATASET,
    "      const writer = await LineWriter.create(partialDatasetPath);\n",
    "      const writer = await GzipNdjsonWriter.create(partialDatasetPath);\n",
)
replace_once(
    DATASET,
    "      let missingTimelineRowCount = 0;\n",
    "      let missingTimelineRowCount = 0;\n      let uncompressedByteLength = 0;\n",
)
replace_once(
    DATASET,
    "        await writer.close();\n      } catch (error) {\n",
    "        await writer.close();\n        uncompressedByteLength = writer.uncompressedByteLength;\n      } catch (error) {\n",
)
replace_once(
    DATASET,
    "          format: 'NDJSON',\n          fileName: DATASET_FILE_NAME,\n          byteLength: datasetStat.size,\n",
    "          format: 'NDJSON',\n          compression: 'GZIP',\n          fileName: DATASET_FILE_NAME,\n          byteLength: datasetStat.size,\n          uncompressedByteLength,\n",
)
value = read(DATASET)
pattern = re.compile(r"\nclass LineWriter \{.*?\n\}\n\nfunction requiredRecord", re.S)
if pattern.search(value):
    value, count = pattern.subn("\nfunction requiredRecord", value, count=1)
    if count != 1:
        raise RuntimeError('Unable to remove Dataset V6 LineWriter')
    write(DATASET, value)
elif 'class LineWriter {' in value:
    raise RuntimeError('Dataset V6 LineWriter has an unexpected shape')

for path in [
    'apps/api/src/deadlock-live/recommendation-behavioral-v5-training.service.ts',
    'apps/api/src/deadlock-live/recommendation-value-v8-diagnostic-training.service.ts',
]:
    replace_once(
        path,
        "import { createInterface } from 'node:readline';\n",
        "import { createInterface } from 'node:readline';\nimport { openMaybeGzipNdjsonReadStream } from './gzip-ndjson';\n",
    )
    replace_once(
        path,
        "    input: createReadStream(path, { encoding: 'utf8' }),\n",
        "    input: await openMaybeGzipNdjsonReadStream(path),\n",
    )

TEST = 'apps/api/test/recommendation-pro-decision-dataset-v6-artifact.spec.ts'
replace_once(
    TEST,
    "import { createHash } from 'node:crypto';\n",
    "import { createHash } from 'node:crypto';\nimport { gunzipSync } from 'node:zlib';\n",
)
replace_once(
    TEST,
    "    const datasetRows = (await readFile(\n      join(outputDirectory, 'dataset.ndjson'),\n      'utf8',\n    ))\n      .trim()\n",
    "    const datasetRows = gunzipSync(\n      await readFile(join(outputDirectory, 'dataset.ndjson')),\n    )\n      .toString('utf8')\n      .trim()\n",
)
replace_once(
    TEST,
    "      source: {\n        kind: 'HISTORICAL_REPLAY',\n        sha256: replaySha256,\n      },\n      featureContract: {\n",
    "      source: {\n        kind: 'HISTORICAL_REPLAY',\n        sha256: replaySha256,\n      },\n      artifact: {\n        format: 'NDJSON',\n        compression: 'GZIP',\n      },\n      featureContract: {\n",
)

print('Recommendation Dataset V6 gzip patch applied.')
