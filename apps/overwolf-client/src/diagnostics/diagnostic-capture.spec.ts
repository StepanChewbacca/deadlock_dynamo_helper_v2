import {
  createDiagnosticChannel,
  createStoredZipBytes,
  isCriticalDiagnosticEvent,
  shouldCaptureDiagnosticEvent,
} from './diagnostic-capture';

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

describe('diagnostic capture routing', () => {
  it('captures unknown info-update categories so newly exposed GEP fields are not lost', () => {
    expect(
      shouldCaptureDiagnosticEvent({
        receivedAt: 1,
        source: 'onInfoUpdates2',
        category: 'incoming_damage',
        key: 'damage_30s',
        rawPayload: '{}',
      }),
    ).toBe(true);
  });

  it('deduplicates equivalent semantic channels across Overwolf features', () => {
    expect(
      createDiagnosticChannel({
        receivedAt: 1,
        source: 'onInfoUpdates2',
        feature: 'match_info',
        category: 'items',
        key: 'items_5',
        rawPayload: '{}',
      }),
    ).toBe(
      createDiagnosticChannel({
        receivedAt: 2,
        source: 'onInfoUpdates2',
        feature: 'state_safety_poll',
        category: 'items',
        key: 'items_5',
        rawPayload: '{}',
      }),
    );
  });

  it('flushes item and match lifecycle events immediately', () => {
    expect(isCriticalDiagnosticEvent({ source: 'onInfoUpdates2', category: 'items', key: 'items_5' })).toBe(true);
    expect(isCriticalDiagnosticEvent({ source: 'onNewEvents', key: 'match_end' })).toBe(true);
  });
});
