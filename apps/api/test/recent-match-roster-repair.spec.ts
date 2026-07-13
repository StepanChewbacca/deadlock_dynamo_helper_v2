import {
  calculateRestoredPlayerCount,
  parseRosterRepairCandidateRows,
} from '../src/deadlock-live/recent-match-roster-repair.service';

describe('recent match roster repair', () => {
  it('selects only matches whose best raw roster is more complete', () => {
    const candidates = parseRosterRepairCandidateRows([
      {
        matchId: '100',
        rawMetadataId: '1000',
        currentPlayerCount: '9',
        bestRawPlayerCount: '10',
      },
      {
        matchId: '101',
        rawMetadataId: '1001',
        currentPlayerCount: '12',
        bestRawPlayerCount: '12',
      },
      {
        matchId: '102',
        rawMetadataId: '1002',
        currentPlayerCount: '11',
        bestRawPlayerCount: '10',
      },
    ]);

    expect(candidates).toEqual([
      {
        matchId: 100,
        rawMetadataId: 1000,
        currentPlayerCount: 9,
        bestRawPlayerCount: 10,
        missingPlayerCount: 1,
      },
    ]);
  });

  it('does not assume a fixed twelve-player roster', () => {
    const candidates = parseRosterRepairCandidateRows([
      {
        matchId: 200,
        rawMetadataId: 2000,
        currentPlayerCount: 5,
        bestRawPlayerCount: 7,
      },
      {
        matchId: 201,
        rawMetadataId: 2001,
        currentPlayerCount: 0,
        bestRawPlayerCount: 3,
      },
    ]);

    expect(candidates.map((candidate) => candidate.missingPlayerCount)).toEqual([2, 3]);
  });

  it('ignores malformed candidate rows', () => {
    const candidates = parseRosterRepairCandidateRows([
      {
        matchId: 'not-a-number',
        rawMetadataId: '3000',
        currentPlayerCount: '5',
        bestRawPlayerCount: '6',
      },
      {
        matchId: '300',
        rawMetadataId: '0',
        currentPlayerCount: '5',
        bestRawPlayerCount: '6',
      },
      {
        matchId: '301',
        rawMetadataId: '3001',
        currentPlayerCount: '-1',
        bestRawPlayerCount: '6',
      },
    ]);

    expect(candidates).toEqual([]);
  });

  it('counts only players actually restored by reprocessing', () => {
    expect(calculateRestoredPlayerCount(9, 12)).toBe(3);
    expect(calculateRestoredPlayerCount(12, 12)).toBe(0);
    expect(calculateRestoredPlayerCount(12, 11)).toBe(0);
  });
});
