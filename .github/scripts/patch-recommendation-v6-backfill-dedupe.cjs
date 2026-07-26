const { readFileSync, writeFileSync } = require('node:fs');

const path = '.github/scripts/backfill-recommendation-v6-timeline-from-db.cjs';
let content = readFileSync(path, 'utf8');

const snapshotNeedle = '  snapshots.sort(compareSnapshots);';
const snapshotReplacement = `  const deduplicatedSnapshots = [...new Map(
    snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]),
  ).values()];
  snapshots.length = 0;
  snapshots.push(...deduplicatedSnapshots);
  snapshots.sort(compareSnapshots);`;

const objectiveNeedle = `  objectives.sort(
    (left, right) =>
      left.gameTimeS - right.gameTimeS ||
      left.objectiveEventId.localeCompare(right.objectiveEventId),
  );`;
const objectiveReplacement = `  const deduplicatedObjectives = [...new Map(
    objectives.map((objective) => [objective.objectiveEventId, objective]),
  ).values()];
  objectives.length = 0;
  objectives.push(...deduplicatedObjectives);
  objectives.sort(
    (left, right) =>
      left.gameTimeS - right.gameTimeS ||
      left.objectiveEventId.localeCompare(right.objectiveEventId),
  );`;

content = replaceOnce(content, snapshotNeedle, snapshotReplacement);
content = replaceOnce(content, objectiveNeedle, objectiveReplacement);
writeFileSync(path, content, 'utf8');

function replaceOnce(source, needle, replacement) {
  if (source.includes(replacement)) return source;
  const index = source.indexOf(needle);
  if (index < 0) {
    throw new Error(`Patch target was not found: ${needle.slice(0, 80)}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + needle.length)}`;
}
