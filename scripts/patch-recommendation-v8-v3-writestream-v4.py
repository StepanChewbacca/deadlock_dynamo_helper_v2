from pathlib import Path

path = Path('apps/api/src/deadlock-live/hero-build-decision-dataset-v3.service.ts')
text = path.read_text()

def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one occurrence, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)

replace_once(
    "import { createHash } from 'node:crypto';\nimport { createReadStream, createWriteStream } from 'node:fs';",
    "import { createHash } from 'node:crypto';\nimport { once } from 'node:events';\nimport { createReadStream, createWriteStream } from 'node:fs';",
)
replace_once("import type { FileHandle } from 'node:fs/promises';\n", '')
replace_once(
    """        await pipeline(
          createReadStream(heroFilePath),
          createWriteStream(this.partialDatasetPath, { flags: 'a' }),
        );""",
    """        const physicalHeroRowCount = await countNdjsonRows(heroFilePath);
        if (physicalHeroRowCount !== heroAudit.rowCount) {
          throw new Error(
            `Contextual V3 hero ${heroId} physical row count ${physicalHeroRowCount} ` +
              `does not match audited row count ${heroAudit.rowCount}.`,
          );
        }
        await pipeline(
          createReadStream(heroFilePath),
          createWriteStream(this.partialDatasetPath, { flags: 'a' }),
        );""",
)
old_class = r"""class BufferedNdjsonWriter {
  private buffer = '';

  private constructor(private readonly handle: FileHandle) {}

  static async create(path: string): Promise<BufferedNdjsonWriter> {
    return new BufferedNdjsonWriter(await open(path, 'w'));
  }

  async write(row: HeroBuildDecisionDatasetV3Row): Promise<void> {
    this.buffer += `${JSON.stringify(row)}\n`;
    if (Buffer.byteLength(this.buffer) >= NDJSON_BUFFER_LIMIT_BYTES) {
      await this.flush();
    }
  }

  async close(): Promise<void> {
    await this.flush();
    await this.handle.close();
  }

  private async flush(): Promise<void> {
    if (!this.buffer) {
      return;
    }
    const value = Buffer.from(this.buffer, 'utf8');
    this.buffer = '';
    let offset = 0;
    while (offset < value.length) {
      const { bytesWritten } = await this.handle.write(
        value,
        offset,
        value.length - offset,
        null,
      );
      if (bytesWritten <= 0) {
        throw new Error('Contextual V3 writer made no progress while flushing.');
      }
      offset += bytesWritten;
    }
  }
}
"""
new_class = r"""class BufferedNdjsonWriter {
  private buffer = '';
  private closed = false;

  private constructor(
    private readonly stream: ReturnType<typeof createWriteStream>,
  ) {}

  static async create(path: string): Promise<BufferedNdjsonWriter> {
    return new BufferedNdjsonWriter(
      createWriteStream(path, { flags: 'w', encoding: 'utf8' }),
    );
  }

  async write(row: HeroBuildDecisionDatasetV3Row): Promise<void> {
    if (this.closed) {
      throw new Error('Contextual V3 writer is already closed.');
    }
    this.buffer += `${JSON.stringify(row)}\n`;
    if (Buffer.byteLength(this.buffer) >= NDJSON_BUFFER_LIMIT_BYTES) {
      await this.flush();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.flush();
    this.closed = true;
    this.stream.end();
    await once(this.stream, 'close');
  }

  private async flush(): Promise<void> {
    if (!this.buffer) {
      return;
    }
    const value = this.buffer;
    this.buffer = '';
    if (!this.stream.write(value, 'utf8')) {
      await once(this.stream, 'drain');
    }
  }
}
"""
replace_once(old_class, new_class)
path.write_text(text)
