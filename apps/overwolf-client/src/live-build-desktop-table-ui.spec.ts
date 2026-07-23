import {
  advanceModelRolloutTime,
  classifyBuildPhase,
  normalizeHeroName,
  parseInventoryStateKey,
} from './live-build-desktop-table-ui';

describe('live build desktop phase table helpers', () => {
  it('normalizes hero class names for display', () => {
    expect(normalizeHeroName('hero_dynamo')).toBe('Dynamo');
    expect(normalizeHeroName('lady_geist')).toBe('Lady Geist');
  });

  it('classifies actions into Early, Mid and Late phases', () => {
    expect(classifyBuildPhase(0)).toBe('EARLY');
    expect(classifyBuildPhase(599)).toBe('EARLY');
    expect(classifyBuildPhase(600)).toBe('MID');
    expect(classifyBuildPhase(1199)).toBe('MID');
    expect(classifyBuildPhase(1200)).toBe('LATE');
  });

  it('advances model rollout time across phase boundaries', () => {
    expect(advanceModelRolloutTime(0)).toBe(90);
    expect(advanceModelRolloutTime(540)).toBe(630);
    expect(classifyBuildPhase(advanceModelRolloutTime(1110))).toBe('LATE');
  });

  it('preserves duplicate item counts from projected state keys', () => {
    expect(parseInventoryStateKey('100x2|200x1')).toEqual([100, 100, 200]);
    expect(parseInventoryStateKey('EMPTY')).toEqual([]);
    expect(parseInventoryStateKey('invalid')).toBeUndefined();
  });
});
