import { isSuccessfulOverwolfResult } from './window-result';

describe('isSuccessfulOverwolfResult', () => {
  it('accepts callbacks using the success boolean', () => {
    expect(isSuccessfulOverwolfResult({ success: true })).toBe(true);
  });

  it('accepts callbacks using the status string', () => {
    expect(isSuccessfulOverwolfResult({ status: 'success' })).toBe(true);
  });

  it('rejects failed and malformed callbacks', () => {
    expect(isSuccessfulOverwolfResult({ success: false })).toBe(false);
    expect(isSuccessfulOverwolfResult({ status: 'error' })).toBe(false);
    expect(isSuccessfulOverwolfResult(undefined)).toBe(false);
  });
});
