import { getAutomaticSkillTrackingCopy } from './skill-build-automatic-ui';

describe('automatic skill tracking UI', () => {
  it('shows automatic synchronization without manual confirmation text', () => {
    expect(getAutomaticSkillTrackingCopy('SYNCED')).toEqual({
      status: 'AUTO',
      note: 'Skill levels are tracked automatically from the game.',
    });
  });

  it('shows a passive waiting state while game telemetry is unavailable', () => {
    expect(getAutomaticSkillTrackingCopy('WAITING_FOR_TELEMETRY')).toEqual({
      status: 'AUTO SYNC',
      note: 'Waiting for the current skill state from the game.',
    });
  });
});
