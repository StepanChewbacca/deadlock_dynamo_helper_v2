import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const datasetPath =
  '/home/ubuntu/apps/deadlock_dynamo_helper/apps/api/storage/recommendation-decision-dataset-v4-historical-bootstrap/dataset.ndjson';
const outputDirectory = join(
  process.env.GITHUB_WORKSPACE ?? process.cwd(),
  'recommendation-v4-value-outcome-conflict-result',
);

await mkdir(outputDirectory, { recursive: true });

const outcomesByMatchSteamTeam = new Map();
const outcomesByMatchSteam = new Map();
const outcomesByMatchTeam = new Map();
const conflictSamples = [];
const steamIds = new Set();
const teamIds = new Set();
let rowCount = 0;
let eligibleRowCount = 0;
let conflictCountMatchSteamTeam = 0;
let conflictCountMatchSteam = 0;
let conflictCountMatchTeam = 0;

const lines = createInterface({
  input: createReadStream(datasetPath, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

for await (const line of lines) {
  if (!line.trim()) continue;
  rowCount += 1;
  const row = JSON.parse(line);
  if (row?.trainingEligibility?.outcome !== true || typeof row?.outcomeLabel?.playerWon !== 'boolean') {
    continue;
  }
  eligibleRowCount += 1;
  const outcome = row.outcomeLabel.playerWon;
  const matchId = String(row.matchId);
  const steamId = String(row.steamId);
  const teamId = row.teamId === undefined ? 'UNKNOWN_TEAM' : String(row.teamId);
  steamIds.add(steamId);
  teamIds.add(teamId);

  const keys = [
    ['matchSteamTeam', `${matchId}\u0000${steamId}\u0000${teamId}`, outcomesByMatchSteamTeam],
    ['matchSteam', `${matchId}\u0000${steamId}`, outcomesByMatchSteam],
    ['matchTeam', `${matchId}\u0000${teamId}`, outcomesByMatchTeam],
  ];
  for (const [kind, key, map] of keys) {
    const previous = map.get(key);
    if (previous !== undefined && previous !== outcome) {
      if (kind === 'matchSteamTeam') conflictCountMatchSteamTeam += 1;
      if (kind === 'matchSteam') conflictCountMatchSteam += 1;
      if (kind === 'matchTeam') conflictCountMatchTeam += 1;
      if (conflictSamples.length < 100) {
        conflictSamples.push({
          kind,
          key: key.replaceAll('\u0000', '|'),
          previous,
          current: outcome,
          decisionId: row.decisionId,
          matchId,
          steamId,
          teamId,
          heroId: row.heroId,
          decisionOccurredAt: row.decisionOccurredAt,
        });
      }
    } else if (previous === undefined) {
      map.set(key, outcome);
    }
  }

  if (rowCount % 10000 === 0) {
    console.log(JSON.stringify({ rowCount, eligibleRowCount, conflictCountMatchSteamTeam }));
  }
}

const result = {
  rowCount,
  eligibleRowCount,
  uniqueSteamIdCount: steamIds.size,
  steamIdSample: [...steamIds].slice(0, 50),
  uniqueTeamIdCount: teamIds.size,
  teamIds: [...teamIds].sort(),
  uniqueMatchSteamTeamKeyCount: outcomesByMatchSteamTeam.size,
  uniqueMatchSteamKeyCount: outcomesByMatchSteam.size,
  uniqueMatchTeamKeyCount: outcomesByMatchTeam.size,
  conflictCountMatchSteamTeam,
  conflictCountMatchSteam,
  conflictCountMatchTeam,
  conflictSamples,
};

await writeFile(join(outputDirectory, 'diagnostic.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result));
