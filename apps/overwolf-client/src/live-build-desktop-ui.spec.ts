import { parseInventoryStateKey } from './live-build-desktop-ui';

describe('parseInventoryStateKey', () => {
  it('parses an empty inventory', () => {
    expect(parseInventoryStateKey('EMPTY')).toEqual([]);
  });

  it('preserves duplicate item counts and canonical order', () => {
    expect(parseInventoryStateKey('200x1|100x2')).toEqual([100, 100, 200]);
  });

  it('rejects malformed state keys', () => {
    expect(parseInventoryStateKey('100')).toBeUndefined();
    expect(parseInventoryStateKey('100x0')).toBeUndefined();
    expect(parseInventoryStateKey('invalidx1')).toBeUndefined();
  });
});
