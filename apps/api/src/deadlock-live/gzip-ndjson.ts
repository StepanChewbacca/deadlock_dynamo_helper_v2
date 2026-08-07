import { once } from 'node:events';
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
