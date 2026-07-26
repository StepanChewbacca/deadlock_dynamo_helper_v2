const { Client } = require('pg');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} = require('node:fs/promises');
const { join } = require('node:path');
const { createGunzip } = require('node:zlib');
const { createInterface } = require('node:readline');

const SCHEMA_VERSION = 1;
const TIMELINE_VERSION = 'MATCH_TIMELINE_V1';
const BACKFILL_VERSION = 'MATCH_TIMELINE_POSTGRES_BACKFILL_V1';
const DATASET_PATH =
  '/app/apps/api/storage/recommendation-decision-dataset-v5-full-crawler-20260726/dataset.ndjson.gz';
const OUTPUT_ROOT =
  '/app/apps/api/storage/match-timeline-events-v1-historical-db-20260726';
const BATCH_SIZE = 50;

async function main() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const dataset = await readDatasetMatchIds(DATASET_PATH);
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    backfillVersion: BACKFILL_VERSION,
    startedAt: new Date().toISOString(),
    datasetPath: DATASET_PATH,
    outputRoot: OUTPUT_ROOT,
    datasetRowCount: dataset.rowCount,
    requestedMatchCount: dataset.matchIds.length,
    processedMatchCount: 0,
    reusedMatchCount: 0,
    missingRawMetadataMatchCount: 0,
    failedMatchCount: 0,
    playerSnapshotCount: 0,
    objectiveEventCount: 0,
    warnings: [],
  };

  try {
    for (let offset = 0; offset < dataset.matchIds.length; offset += BATCH_SIZE) {
      const ids = dataset.matchIds.slice(offset, offset + BATCH_SIZE);
      const result = await client.query(
        `SELECT DISTINCT ON ("matchId")
           id,
           "matchId"::text AS "matchId",
           "payloadHash",
           source,
           payload,
           "fetchedAt"
         FROM raw_match_metadata
         WHERE "matchId" = ANY($1::bigint[])
         ORDER BY "matchId", id DESC`,
        [ids],
      );
      const rowsByMatchId = new Map(
        result.rows.map((row) => [String(row.matchId), row]),
      );

      for (const matchId of ids) {
        const metadata = rowsByMatchId.get(matchId);
        if (!metadata) {
          summary.missingRawMetadataMatchCount += 1;
          continue;
        }
        try {
          const existingAudit = await optionalJson(
            join(OUTPUT_ROOT, matchId, 'audit.json'),
          );
          if (
            existingAudit?.passed === true &&
            existingAudit?.source?.payloadHash === metadata.payloadHash
          ) {
            summary.reusedMatchCount += 1;
            summary.playerSnapshotCount += numberValue(
              existingAudit?.rows?.playerSnapshotCount,
            );
            summary.objectiveEventCount += numberValue(
              existingAudit?.rows?.objectiveEventCount,
            );
            continue;
          }

          const built = buildTimeline(metadata);
          await writeMatchArtifacts(matchId, metadata, built);
          summary.processedMatchCount += 1;
          summary.playerSnapshotCount += built.snapshots.length;
          summary.objectiveEventCount += built.objectives.length;
        } catch (error) {
          summary.failedMatchCount += 1;
          summary.warnings.push({
            matchId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const completed = Math.min(offset + ids.length, dataset.matchIds.length);
      await writeJson(join(OUTPUT_ROOT, 'checkpoint.json'), {
        ...summary,
        updatedAt: new Date().toISOString(),
        completedInputMatchCount: completed,
      });
      process.stdout.write(
        `${JSON.stringify({
          completedInputMatchCount: completed,
          requestedMatchCount: dataset.matchIds.length,
          processedMatchCount: summary.processedMatchCount,
          reusedMatchCount: summary.reusedMatchCount,
          missingRawMetadataMatchCount: summary.missingRawMetadataMatchCount,
          failedMatchCount: summary.failedMatchCount,
          playerSnapshotCount: summary.playerSnapshotCount,
          objectiveEventCount: summary.objectiveEventCount,
        })}\n`,
      );
    }
  } finally {
    await client.end();
  }

  summary.completedAt = new Date().toISOString();
  summary.auditedMatchCount =
    summary.processedMatchCount + summary.reusedMatchCount;
  summary.coverage =
    summary.requestedMatchCount > 0
      ? summary.auditedMatchCount / summary.requestedMatchCount
      : 0;
  summary.passed =
    summary.auditedMatchCount === summary.requestedMatchCount &&
    summary.missingRawMetadataMatchCount === 0 &&
    summary.failedMatchCount === 0 &&
    summary.playerSnapshotCount > 0;
  await writeJson(join(OUTPUT_ROOT, 'backfill-summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.passed) {
    process.exitCode = 1;
  }
}

async function readDatasetMatchIds(path) {
  const ids = new Set();
  let rowCount = 0;
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const matchId = String(row?.identity?.matchId ?? '');
    if (matchId) ids.add(matchId);
    rowCount += 1;
  }
  return { rowCount, matchIds: [...ids].sort(compareNumericStrings) };
}

function buildTimeline(metadata) {
  const matchInfo = metadata?.payload?.match_info;
  if (!matchInfo || typeof matchInfo !== 'object') {
    throw new Error('raw_match_metadata.payload.match_info is missing.');
  }
  const matchId = safeInteger(metadata.matchId, 'matchId');
  const startTimeS = finiteNumber(matchInfo.start_time) ?? 0;
  const players = Array.isArray(matchInfo.players) ? matchInfo.players : [];
  const snapshots = [];

  for (const player of players) {
    if (!player || typeof player !== 'object') continue;
    const heroId = safeInteger(player.hero_id, 'hero_id');
    const playerSlot = safeInteger(player.player_slot, 'player_slot');
    const teamId = optionalInteger(player.team);
    const steamId = String(player.account_id ?? `slot:${playerSlot}`);
    const stats = Array.isArray(player.stats) ? [...player.stats] : [];
    stats.sort(
      (left, right) =>
        numberValue(left?.time_stamp_s) - numberValue(right?.time_stamp_s),
    );

    for (const entry of stats) {
      if (!entry || typeof entry !== 'object') continue;
      const gameTimeS = optionalInteger(entry.time_stamp_s);
      if (gameTimeS === undefined || gameTimeS < 0) continue;
      const sourceEventId = sha256(
        `${BACKFILL_VERSION}:${metadata.id}:${playerSlot}:${gameTimeS}`,
      );
      snapshots.push({
        schemaVersion: SCHEMA_VERSION,
        timelineVersion: TIMELINE_VERSION,
        snapshotId: sha256(`${sourceEventId}:snapshot`),
        sourceEventId,
        matchId,
        gameTimeS,
        tick: gameTimeS * 60,
        steamId,
        heroId,
        ...(teamId === undefined ? {} : { teamId }),
        kills: numberValue(entry.kills),
        deaths: numberValue(entry.deaths),
        assists: numberValue(entry.assists),
        netWorth: numberValue(entry.net_worth),
        heroDamage: numberValue(entry.player_damage),
        ...(finiteNumber(entry.max_health) === undefined
          ? {}
          : { maxHealth: finiteNumber(entry.max_health) }),
        ...(finiteNumber(entry.level) === undefined
          ? {}
          : { level: finiteNumber(entry.level) }),
        receivedAt: timestamp(startTimeS, gameTimeS, metadata.fetchedAt),
      });
    }
  }

  snapshots.sort(compareSnapshots);
  const objectives = [];
  const rawObjectives = Array.isArray(matchInfo.objectives)
    ? matchInfo.objectives
    : [];
  for (let index = 0; index < rawObjectives.length; index += 1) {
    const objective = rawObjectives[index];
    if (!objective || typeof objective !== 'object') continue;
    const gameTimeS = optionalInteger(objective.destroyed_time_s);
    if (gameTimeS === undefined || gameTimeS <= 0) continue;
    const teamObjectiveId =
      optionalInteger(objective.team_objective_id) ?? index;
    const teamId = optionalInteger(objective.team);
    const sourceEventId = sha256(
      `${BACKFILL_VERSION}:${metadata.id}:objective:${teamObjectiveId}:${gameTimeS}`,
    );
    objectives.push({
      schemaVersion: SCHEMA_VERSION,
      timelineVersion: TIMELINE_VERSION,
      objectiveEventId: sha256(`${sourceEventId}:objective`),
      sourceEventId,
      matchId,
      gameTimeS,
      tick: gameTimeS * 60,
      eventName: 'historical_objective_destroyed',
      objectiveType: `team_objective_${teamObjectiveId}`,
      entityIndex: teamObjectiveId,
      ...(teamId === undefined ? {} : { teamId }),
      receivedAt: timestamp(startTimeS, gameTimeS, metadata.fetchedAt),
    });
  }
  objectives.sort(
    (left, right) =>
      left.gameTimeS - right.gameTimeS ||
      left.objectiveEventId.localeCompare(right.objectiveEventId),
  );

  const uniquePlayers = new Set(
    snapshots.map((snapshot) => `${snapshot.teamId}:${snapshot.heroId}`),
  );
  if (snapshots.length === 0) {
    throw new Error('No historical player stats snapshots were found.');
  }
  return { snapshots, objectives, uniquePlayerCount: uniquePlayers.size };
}

async function writeMatchArtifacts(matchId, metadata, built) {
  const finalDirectory = join(OUTPUT_ROOT, matchId);
  const partialDirectory = join(OUTPUT_ROOT, `.${matchId}.partial`);
  await rm(partialDirectory, { recursive: true, force: true });
  await mkdir(partialDirectory, { recursive: true });

  const eventsPath = join(partialDirectory, 'events.ndjson');
  const snapshotsPath = join(partialDirectory, 'player-snapshots.ndjson');
  const objectivesPath = join(partialDirectory, 'objective-events.ndjson');
  await writeFile(eventsPath, '', 'utf8');
  await writeNdjson(snapshotsPath, built.snapshots);
  await writeNdjson(objectivesPath, built.objectives);

  const generatedAt = new Date().toISOString();
  const artifacts = {
    events: await artifact(eventsPath),
    playerSnapshots: await artifact(snapshotsPath),
    objectiveEvents: await artifact(objectivesPath),
  };
  const audit = {
    schemaVersion: SCHEMA_VERSION,
    timelineVersion: TIMELINE_VERSION,
    backfillVersion: BACKFILL_VERSION,
    generatedAt,
    passed: built.snapshots.length > 0 && built.uniquePlayerCount > 0,
    matchId: Number(matchId),
    source: {
      kind: 'POSTGRES_RAW_MATCH_METADATA',
      metadataId: metadata.id,
      payloadHash: metadata.payloadHash,
      source: metadata.source,
    },
    rows: {
      eventCount: 0,
      playerSnapshotCount: built.snapshots.length,
      objectiveEventCount: built.objectives.length,
      uniquePlayerCount: built.uniquePlayerCount,
    },
    integrity: {
      duplicateSnapshotIdCount: duplicateCount(
        built.snapshots.map((entry) => entry.snapshotId),
      ),
      duplicateObjectiveEventIdCount: duplicateCount(
        built.objectives.map((entry) => entry.objectiveEventId),
      ),
      snapshotsSorted: isSorted(built.snapshots, compareSnapshots),
    },
    leakage: {
      snapshotsPreserveHistoricalTimestamp: true,
      finalAggregateStatsUsedAsDecisionTimeFeatures: false,
    },
  };
  audit.passed =
    audit.passed &&
    audit.integrity.duplicateSnapshotIdCount === 0 &&
    audit.integrity.duplicateObjectiveEventIdCount === 0 &&
    audit.integrity.snapshotsSorted;
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    timelineVersion: TIMELINE_VERSION,
    backfillVersion: BACKFILL_VERSION,
    generatedAt,
    matchId: Number(matchId),
    source: audit.source,
    artifacts,
    auditPassed: audit.passed,
  };
  await writeJson(join(partialDirectory, 'audit.json'), audit);
  await writeJson(join(partialDirectory, 'manifest.json'), manifest);
  await writeJson(join(partialDirectory, 'checkpoint.json'), {
    schemaVersion: SCHEMA_VERSION,
    timelineVersion: TIMELINE_VERSION,
    backfillVersion: BACKFILL_VERSION,
    matchId: Number(matchId),
    completedAt: generatedAt,
    playerSnapshotCount: built.snapshots.length,
    objectiveEventCount: built.objectives.length,
  });

  if (!audit.passed) {
    throw new Error(`Generated timeline audit failed for match ${matchId}.`);
  }
  await rm(finalDirectory, { recursive: true, force: true });
  await rename(partialDirectory, finalDirectory);
}

async function writeNdjson(path, rows) {
  const content = rows.length > 0
    ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
    : '';
  await writeFile(path, content, 'utf8');
}

async function artifact(path) {
  const fileStat = await stat(path);
  return {
    fileName: path.split('/').pop(),
    byteLength: fileStat.size,
    sha256: await hashFile(path),
  };
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function timestamp(startTimeS, gameTimeS, fallback) {
  if (startTimeS > 0) {
    return new Date((startTimeS + gameTimeS) * 1000).toISOString();
  }
  return fallback instanceof Date
    ? fallback.toISOString()
    : new Date(fallback ?? Date.now()).toISOString();
}

function finiteNumber(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function numberValue(value) {
  return finiteNumber(value) ?? 0;
}

function optionalInteger(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : undefined;
}

function safeInteger(value, name) {
  const result = optionalInteger(value);
  if (result === undefined) throw new Error(`${name} is not a safe integer.`);
  return result;
}

function compareSnapshots(left, right) {
  return (
    left.gameTimeS - right.gameTimeS ||
    (left.teamId ?? -1) - (right.teamId ?? -1) ||
    left.heroId - right.heroId ||
    left.steamId.localeCompare(right.steamId) ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
}

function compareNumericStrings(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return leftNumber - rightNumber || left.localeCompare(right);
}

function duplicateCount(values) {
  return values.length - new Set(values).size;
}

function isSorted(values, compare) {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1], values[index]) > 0) return false;
  }
  return true;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
