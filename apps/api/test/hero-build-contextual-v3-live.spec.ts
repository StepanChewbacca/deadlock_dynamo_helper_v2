import {
  assignLiveArchetype,
  getContextualV3Phase,
} from '../src/deadlock-live/hero-build-contextual-v3-live.service';
import { deriveContextualV3PreviousActionKeys } from '../src/deadlock-live/hero-build-recommendation.controller';

describe('Contextual V3 live helpers', () => {
  it('uses the same phase boundaries as offline evaluation', () => {
    expect(getContextualV3Phase(0)).toBe('EARLY');
    expect(getContextualV3Phase(599)).toBe('EARLY');
    expect(getContextualV3Phase(600)).toBe('MID');
    expect(getContextualV3Phase(1199)).toBe('MID');
    expect(getContextualV3Phase(1200)).toBe('LATE');
  });

  it('assigns a train-fitted archetype from the observed action prefix', () => {
    const definitions = {
      '10': [
        {
          id: 'H10-A1',
          heroId: 10,
          signature: 'BUY:100>BUY:200>UPGRADE:300>BUY:400',
        },
      ],
    };

    expect(assignLiveArchetype(10, ['BUY:100', 'BUY:200'], definitions)).toBe(
      'H10-A1',
    );
    expect(assignLiveArchetype(10, [], definitions)).toBe('UNKNOWN');
    expect(assignLiveArchetype(10, ['BUY:999'], definitions)).toBe('OTHER');
  });

  it('reconstructs buy, upgrade, and sell actions from live inventory snapshots', () => {
    const recipes = new Map<number, number[]>([[300, [100, 200]]]);
    const actions = deriveContextualV3PreviousActionKeys(
      [
        [100, 200],
        [300],
        [300, 400],
        [400],
      ],
      (parentItemId) => recipes.get(parentItemId) ?? [],
    );

    expect(actions).toEqual([
      'BUY:100',
      'BUY:200',
      'UPGRADE:300',
      'BUY:400',
      'SELL:300',
    ]);
  });

  it('ignores duplicate inventory snapshots', () => {
    expect(
      deriveContextualV3PreviousActionKeys(
        [
          [100],
          [100],
          [100, 200],
        ],
        () => [],
      ),
    ).toEqual(['BUY:100', 'BUY:200']);
  });
});
