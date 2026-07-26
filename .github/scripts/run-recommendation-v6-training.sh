#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_REPOSITORY=/home/ubuntu/apps/deadlock_dynamo_helper
EXPECTED_COMMIT=251660fc3dd541925b8ade9c55d216a91a975d85
RESULT_DIRECTORY="$GITHUB_WORKSPACE/recommendation-v6-full-crawler-result"
mkdir -p "$RESULT_DIRECTORY"
exec > >(tee "$RESULT_DIRECTORY/00-run.log") 2>&1

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  echo '=== RESTORE CLEAN PRODUCTION API ==='
  cd "$DEPLOY_REPOSITORY"
  git reset --hard "$EXPECTED_COMMIT"
  sudo docker compose build api
  sudo docker compose up -d --force-recreate --no-deps api
  rm -f /tmp/recommendation-v6-full-crawler.override.yml
  local healthy=0
  for attempt in $(seq 1 180); do
    if curl --max-time 10 --fail --silent \
      http://127.0.0.1:3000/deadlock/analysis/recommendation-telemetry/status \
      >/dev/null; then
      healthy=1
      break
    fi
    sleep 5
  done
  if [ "$healthy" -ne 1 ]; then
    echo 'Production API did not become healthy after restoration.'
    if [ "$original_status" -eq 0 ]; then
      original_status=1
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

current_commit=$(git -C "$DEPLOY_REPOSITORY" rev-parse HEAD)
if [ "$current_commit" != "$EXPECTED_COMMIT" ]; then
  echo "Expected deployment commit $EXPECTED_COMMIT, found $current_commit"
  exit 1
fi
if ! git -C "$DEPLOY_REPOSITORY" diff --quiet || \
  ! git -C "$DEPLOY_REPOSITORY" diff --cached --quiet; then
  echo 'Deployment repository contains tracked changes before the temporary patch.'
  git -C "$DEPLOY_REPOSITORY" status --short
  exit 1
fi

VOLUME_ROOT=$(sudo docker volume inspect \
  deadlock_dynamo_helper_deadlock-storage \
  --format '{{ .Mountpoint }}')
SOURCE_DIR="$VOLUME_ROOT/recommendation-decision-dataset-v4-full-crawler-recovery-v3-20260725"
BEHAVIORAL_DIR="$VOLUME_ROOT/recommendation-behavioral-v4-full-crawler-recovery-v3-20260725"

echo '=== STORAGE BEFORE TRAINING ==='
df -h "$VOLUME_ROOT"
sudo find "$VOLUME_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
  | grep -E '^(recommendation|contextual-v3)' \
  | sort \
  | while read -r name; do sudo du -sh "$VOLUME_ROOT/$name"; done

for path in \
  "$SOURCE_DIR/dataset.ndjson" \
  "$SOURCE_DIR/manifest.json" \
  "$SOURCE_DIR/audit.json" \
  "$BEHAVIORAL_DIR/validation.ndjson" \
  "$BEHAVIORAL_DIR/model.json" \
  "$BEHAVIORAL_DIR/manifest.json" \
  "$BEHAVIORAL_DIR/audit.json"; do
  if ! sudo test -f "$path"; then
    echo "Missing required artifact: $path"
    exit 1
  fi
  sudo stat -c '%n %s bytes' "$path"
done

available_kb=$(df -Pk "$VOLUME_ROOT" | awk 'NR == 2 { print $4 }')
minimum_kb=$((50 * 1024 * 1024))
if [ "$available_kb" -lt "$minimum_kb" ]; then
  echo "At least 50 GiB free is required after cleanup; available KB: $available_kb"
  exit 1
fi

rm -rf /tmp/recommendation-v6-full-crawler.lock
rm -f /tmp/recommendation-v6-full-crawler.completed

node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v5-gzip.cjs" \
  "$DEPLOY_REPOSITORY"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-validator-gzip.cjs" \
  "$GITHUB_WORKSPACE/scripts/validate-recommendation-v6-full-crawler-result.mjs"

node <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const path = 'scripts/run-recommendation-v6-full-crawler-cycle.mjs';
let content = readFileSync(path, 'utf8');
const replacements = [
  [
    '/app/apps/api/storage/recommendation-decision-dataset-v4-full-crawler-v2-20260724',
    '/app/apps/api/storage/recommendation-decision-dataset-v4-full-crawler-recovery-v3-20260725',
    'Dataset V4 source path',
  ],
  [
    '/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-v2-20260724',
    '/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-recovery-v3-20260725',
    'Behavioral V4 source path',
  ],
  ['resume: false', 'resume: true', 'Dataset V5 resume option'],
  [
    `  const outputDirectories = [\n    directories.datasetV5,\n    directories.valueV6,\n    directories.policyV6,\n  ];`,
    `  const outputDirectories = [directories.valueV6, directories.policyV6];\n  const datasetV5HostPath = storageHostPath(volumeRoot, directories.datasetV5);\n  commandOutput('sudo', ['mkdir', '-p', datasetV5HostPath]);`,
    'resumable output cleanup',
  ],
  [
    `  assertTrue(\n    status.state !== 'COMPLETE',\n    \`${'${name}'} unexpectedly started with a completed artifact in a clean directory.\`,\n  );\n  if (status.state !== 'RUNNING') {`,
    `  if (status.state === 'COMPLETE') {\n    console.log(\`[${'${name}'}] reusing completed artifact\`);\n    return status;\n  }\n  if (status.state !== 'RUNNING') {`,
    'completed stage reuse',
  ],
];
for (const [before, after, name] of replacements) {
  const count = content.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${name}: expected one target, found ${count}.`);
  }
  content = content.replace(before, after);
}
writeFileSync(path, content, 'utf8');
NODE

node --check .github/scripts/patch-recommendation-v5-gzip.cjs
node --check .github/scripts/patch-recommendation-v6-validator-gzip.cjs
node --check scripts/run-recommendation-v6-full-crawler-cycle.mjs
node --check scripts/validate-recommendation-v6-full-crawler-result.mjs
git -C "$DEPLOY_REPOSITORY" diff --check

echo '=== BUILD AND TARGETED TESTS ==='
cd "$DEPLOY_REPOSITORY"
yarn install --frozen-lockfile --ignore-engines
yarn workspace @deadlock-live-probe/shared build
yarn workspace @deadlock-live-probe/build-domain build
yarn workspace @deadlock-live-probe/api build
yarn workspace @deadlock-live-probe/api jest --runInBand \
  recommendation-decision-dataset-v5.spec.ts \
  recommendation-value-v6-training.spec.ts \
  recommendation-policy-v6-evaluation.spec.ts \
  recommendation-policy-v6-evaluation-integration.spec.ts
sudo docker compose build api

cd "$GITHUB_WORKSPACE"
echo '=== START RECOMMENDATION V6 CYCLE ==='
node scripts/run-recommendation-v6-full-crawler-cycle.mjs

echo '=== VALIDATE RECOMMENDATION V6 CYCLE ==='
node scripts/validate-recommendation-v6-full-crawler-result.mjs

echo '=== STORAGE AFTER TRAINING ==='
df -h "$VOLUME_ROOT"
