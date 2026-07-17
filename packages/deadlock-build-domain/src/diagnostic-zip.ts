import {
  DiagnosticManualNote,
  DiagnosticParserDiagnostic,
  DiagnosticSessionInfo,
} from './diagnostic-types';

export interface DiagnosticArchiveFiles {
  eventsNdjson: string;
  notes: DiagnosticManualNote[];
  sessionInfo?: DiagnosticSessionInfo;
  diagnostics: DiagnosticParserDiagnostic[];
}

export function readDiagnosticArchiveFiles(bytes: Uint8Array): DiagnosticArchiveFiles {
  const diagnostics: DiagnosticParserDiagnostic[] = [];
  let files: Map<string, Uint8Array>;
  try {
    files = parseStoredZipFiles(bytes);
  } catch (error) {
    return {
      eventsNdjson: '',
      notes: [],
      diagnostics: [{ code: 'INVALID_ARCHIVE', message: errorMessage(error) }],
    };
  }

  const events = files.get('overwolf-events.ndjson');
  if (!events) {
    return {
      eventsNdjson: '',
      notes: [],
      diagnostics: [
        {
          code: 'MISSING_ARCHIVE_FILE',
          message: 'Archive does not contain overwolf-events.ndjson.',
        },
      ],
    };
  }

  const decoder = new TextDecoder();
  return {
    eventsNdjson: decoder.decode(events),
    notes: parseJson(files.get('notes.json'), decoder, diagnostics) ?? [],
    sessionInfo: parseJson(files.get('session-info.json'), decoder, diagnostics),
    diagnostics,
  };
}

export function parseStoredZipFiles(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 4 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header signature at byte ${offset}.`);
    }
    if (offset + 30 > bytes.byteLength) throw new Error('Truncated ZIP local header.');

    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);

    if ((flags & 0x0008) !== 0) {
      throw new Error('ZIP data descriptors are not supported for diagnostic archives.');
    }
    if (method !== 0) throw new Error(`Unsupported ZIP compression method ${method}.`);
    if (compressedSize !== uncompressedSize) {
      throw new Error('Stored ZIP entry has mismatched compressed and uncompressed sizes.');
    }

    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const contentEnd = contentStart + compressedSize;
    if (contentEnd > bytes.byteLength) throw new Error('Truncated ZIP file content.');

    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    files.set(name, bytes.slice(contentStart, contentEnd));
    offset = contentEnd;
  }

  if (!files.size) throw new Error('ZIP archive does not contain stored files.');
  return files;
}

function parseJson<T>(
  bytes: Uint8Array | undefined,
  decoder: TextDecoder,
  diagnostics: DiagnosticParserDiagnostic[],
): T | undefined {
  if (!bytes) return undefined;
  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch (error) {
    diagnostics.push({
      code: 'INVALID_ARCHIVE',
      message: `Invalid JSON archive file: ${errorMessage(error)}`,
    });
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
