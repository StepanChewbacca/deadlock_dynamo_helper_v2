import { createStoredZipBytes } from './diagnostic-capture';

describe('createStoredZipBytes', () => {
  it('creates a valid stored ZIP with multiple files', () => {
    const bytes = createStoredZipBytes([
      { name: 'events.ndjson', content: '{"event":1}\n' },
      { name: 'notes.json', content: '[]' },
    ]);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 12, true)).toBe(2);
  });
});
