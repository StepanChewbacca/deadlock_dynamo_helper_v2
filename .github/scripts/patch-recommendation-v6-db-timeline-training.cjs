const { readFileSync, writeFileSync } = require('node:fs');

const path = '.github/scripts/run-recommendation-v6-training.sh';
let content = readFileSync(path, 'utf8');

const anchor =
  "  ['resume: false', 'resume: true', 'Dataset V5 resume option'],";
const replacement = `  [
    '/app/apps/api/storage/match-timeline-events-v1',
    '/app/apps/api/storage/match-timeline-events-v1-historical-db-20260726',
    'historical timeline path',
  ],
  [
    '/app/apps/api/storage/recommendation-decision-dataset-v5-full-crawler-20260726',
    '/app/apps/api/storage/recommendation-decision-dataset-v5-full-crawler-db-timeline-20260726',
    'Dataset V5 output path',
  ],
  [
    '/app/apps/api/storage/recommendation-value-v6-full-crawler-20260726',
    '/app/apps/api/storage/recommendation-value-v6-full-crawler-db-timeline-20260726',
    'Value V6 output path',
  ],
  [
    '/app/apps/api/storage/recommendation-policy-v6-full-crawler-20260726',
    '/app/apps/api/storage/recommendation-policy-v6-full-crawler-db-timeline-20260726',
    'Policy V6 output path',
  ],
${anchor}`;

const anchorCount = content.split(anchor).length - 1;
if (anchorCount !== 1) {
  throw new Error(`Expected one Dataset V5 resume anchor, found ${anchorCount}.`);
}
content = content.replace(anchor, replacement);

const oldHeading = "echo '=== REUSE COMPLETED RECOMMENDATION V6 ARTIFACTS ==='";
const newHeading =
  "echo '=== BUILD RECOMMENDATION V6 WITH HISTORICAL DB TIMELINE ==='";
const headingCount = content.split(oldHeading).length - 1;
if (headingCount !== 1) {
  throw new Error(`Expected one training heading, found ${headingCount}.`);
}
content = content.replace(oldHeading, newHeading);

writeFileSync(path, content, 'utf8');
