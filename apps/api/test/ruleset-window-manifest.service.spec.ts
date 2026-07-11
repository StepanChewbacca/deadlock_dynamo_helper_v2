import {
  findRulesetWindowConflicts,
  normalizeRulesetWindowManifest,
} from '../src/deadlock-live/ruleset-window-manifest.service';

describe('RulesetWindowManifestService helpers', () => {
  it('normalizes a monotonic non-overlapping manifest', () => {
    const result = normalizeRulesetWindowManifest([
      {
        clientVersion: 6500,
        validFrom: '2026-06-01T00:00:00.000Z',
        validTo: '2026-06-15T00:00:00.000Z',
        evidence: { source: 'verified-release-log' },
      },
      {
        clientVersion: 6600,
        validFrom: '2026-06-15T00:00:00.000Z',
        evidence: { source: 'verified-release-log' },
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.entries.map((entry) => entry.clientVersion)).toEqual([6500, 6600]);
    expect(result.entries[0].validFrom.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rejects non-monotonic client versions by default', () => {
    const result = normalizeRulesetWindowManifest([
      {
        clientVersion: 6600,
        validFrom: '2026-06-01T00:00:00.000Z',
        validTo: '2026-06-15T00:00:00.000Z',
      },
      {
        clientVersion: 6500,
        validFrom: '2026-06-15T00:00:00.000Z',
      },
    ]);

    expect(result.errors.join(' ')).toContain('Client versions must increase');
  });

  it('detects overlapping active windows and allows adjacent boundaries', () => {
    expect(
      findRulesetWindowConflicts([
        {
          clientVersion: 6500,
          validFrom: new Date('2026-06-01T00:00:00.000Z'),
          validTo: new Date('2026-06-15T00:00:00.000Z'),
          status: 'active',
          source: 'test',
        },
        {
          clientVersion: 6600,
          validFrom: new Date('2026-06-15T00:00:00.000Z'),
          validTo: new Date('2026-07-01T00:00:00.000Z'),
          status: 'active',
          source: 'test',
        },
      ]),
    ).toEqual([]);

    expect(
      findRulesetWindowConflicts([
        {
          clientVersion: 6500,
          validFrom: new Date('2026-06-01T00:00:00.000Z'),
          validTo: new Date('2026-06-20T00:00:00.000Z'),
          status: 'active',
          source: 'test',
        },
        {
          clientVersion: 6600,
          validFrom: new Date('2026-06-15T00:00:00.000Z'),
          status: 'active',
          source: 'test',
        },
      ]),
    ).toHaveLength(1);
  });
});
