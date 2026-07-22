import {
  hashContextualV3FinalTestDescriptors,
  isStrictlyNewerThanCutoff,
  selectContextualV3FinalTestDescriptors,
} from '../src/deadlock-live/hero-build-contextual-v3-final-test.service';

describe('Contextual V3 future final-test helpers', () => {
  const cutoff = '2026-07-22T11:39:43.000Z';

  it('selects the oldest strictly future matches deterministically', () => {
    expect(
      selectContextualV3FinalTestDescriptors(
        [
          { matchId: 4, startTime: '2026-07-22T12:00:04.000Z' },
          { matchId: 2, startTime: '2026-07-22T12:00:02.000Z' },
          { matchId: 1, startTime: '2026-07-22T11:39:43.000Z' },
          { matchId: 3, startTime: '2026-07-22T12:00:03.000Z' },
        ],
        cutoff,
        2,
      ),
    ).toEqual([
      { matchId: 2, startTime: '2026-07-22T12:00:02.000Z' },
      { matchId: 3, startTime: '2026-07-22T12:00:03.000Z' },
    ]);
  });

  it('refuses to shrink the frozen final-test window', () => {
    expect(() =>
      selectContextualV3FinalTestDescriptors(
        [{ matchId: 2, startTime: '2026-07-22T12:00:02.000Z' }],
        cutoff,
        2,
      ),
    ).toThrow(
      'Only 1 strictly future standard 6v6 matches are available; 2 are required',
    );
  });

  it('uses an exclusive time cutoff', () => {
    expect(isStrictlyNewerThanCutoff(cutoff, cutoff)).toBe(false);
    expect(
      isStrictlyNewerThanCutoff('2026-07-22T11:39:43.001Z', cutoff),
    ).toBe(true);
  });

  it('hashes a frozen descriptor list deterministically', () => {
    const descriptors = [
      { matchId: 2, startTime: '2026-07-22T12:00:02.000Z' },
      { matchId: 3, startTime: '2026-07-22T12:00:03.000Z' },
    ];
    expect(hashContextualV3FinalTestDescriptors(descriptors)).toBe(
      hashContextualV3FinalTestDescriptors([...descriptors]),
    );
    expect(
      hashContextualV3FinalTestDescriptors([...descriptors].reverse()),
    ).not.toBe(hashContextualV3FinalTestDescriptors(descriptors));
  });
});
