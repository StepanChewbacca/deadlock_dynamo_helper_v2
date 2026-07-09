import { parseJsonSafely } from './parse-json-safely';

describe('parseJsonSafely', () => {
  it('parses valid JSON strings', () => {
    expect(parseJsonSafely('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns raw value for invalid JSON', () => {
    expect(parseJsonSafely('not-json')).toBe('not-json');
  });
});
