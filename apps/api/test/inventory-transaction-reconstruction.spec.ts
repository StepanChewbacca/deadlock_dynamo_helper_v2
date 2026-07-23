import { reconstructInventoryTransaction } from '../src/deadlock-live/inventory-transaction-reconstruction';

describe('inventory transaction reconstruction', () => {
  it('reconstructs an exact upgrade with repeated components', () => {
    const result = reconstructInventoryTransaction(
      [100, 100],
      [300],
      (parentItemId) => (parentItemId === 300 ? [100, 100] : []),
    );

    expect(result).toMatchObject({
      actionKeys: ['UPGRADE:300'],
      confidence: 'EXACT_SINGLE_ACTION',
      resolved: true,
      ambiguous: false,
    });
  });

  it('does not infer a repeated-component upgrade from one component', () => {
    const result = reconstructInventoryTransaction(
      [100],
      [300],
      (parentItemId) => (parentItemId === 300 ? [100, 100] : []),
    );

    expect(result).toMatchObject({
      actionKeys: ['SELL:100', 'BUY:300'],
      confidence: 'MULTI_ACTION_INTERVAL',
      resolved: true,
      ambiguous: false,
    });
  });

  it('chooses the explanation that consumes the most removed components', () => {
    const recipes = new Map<number, number[]>([
      [300, [100]],
      [400, [100, 200]],
    ]);
    const result = reconstructInventoryTransaction(
      [100, 200],
      [300, 400],
      (parentItemId) => recipes.get(parentItemId) ?? [],
    );

    expect(result.actionKeys).toEqual(['UPGRADE:400', 'BUY:300']);
    expect(result.confidence).toBe('MULTI_ACTION_INTERVAL');
    expect(result.ambiguous).toBe(false);
  });

  it('marks equally optimal overlapping upgrade explanations as ambiguous', () => {
    const result = reconstructInventoryTransaction(
      [100],
      [300, 400],
      (parentItemId) =>
        parentItemId === 300 || parentItemId === 400 ? [100] : [],
    );

    expect(result.actionKeys).toEqual(['UPGRADE:300', 'BUY:400']);
    expect(result.confidence).toBe('AMBIGUOUS_MULTI_ACTION');
    expect(result.ambiguous).toBe(true);
    expect(result.resolved).toBe(true);
  });

  it('reconstructs duplicate partial sales deterministically', () => {
    const result = reconstructInventoryTransaction(
      [100, 100, 200],
      [100, 200],
      () => [],
    );

    expect(result.actionKeys).toEqual(['SELL:100']);
    expect(result.confidence).toBe('EXACT_SINGLE_ACTION');
  });

  it('returns unresolved for identical snapshots', () => {
    const result = reconstructInventoryTransaction(
      [200, 100, 100],
      [100, 200, 100],
      () => [],
    );

    expect(result).toMatchObject({
      actionKeys: [],
      confidence: 'UNRESOLVED',
      resolved: true,
      ambiguous: false,
      previousStateKey: '100x2|200x1',
      currentStateKey: '100x2|200x1',
    });
  });
});
