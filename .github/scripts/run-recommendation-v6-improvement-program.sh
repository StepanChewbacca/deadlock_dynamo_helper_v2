#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_REPOSITORY=/home/ubuntu/apps/deadlock_dynamo_helper
EXPECTED_COMMIT=251660fc3dd541925b8ade9c55d216a91a975d85
RESULT_DIRECTORY="$GITHUB_WORKSPACE/recommendation-v6-improvement-result"
OVERRIDE_PATH=/tmp/recommendation-v6-improvement.override.yml

mkdir -p "$RESULT_DIRECTORY"
exec > >(tee "$RESULT_DIRECTORY/00-run.log") 2>&1

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e

  echo '=== RESTORE CLEAN PRODUCTION API ==='
  rm -f "$OVERRIDE_PATH"
  git -C "$DEPLOY_REPOSITORY" reset --hard "$EXPECTED_COMMIT"
  git -C "$DEPLOY_REPOSITORY" clean -fd
  cd "$DEPLOY_REPOSITORY"
  sudo docker compose build api
  sudo docker compose up -d --force-recreate --no-deps api

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

git -C "$DEPLOY_REPOSITORY" reset --hard "$EXPECTED_COMMIT"
git -C "$DEPLOY_REPOSITORY" clean -fd

VOLUME_ROOT=$(sudo docker volume inspect \
  deadlock_dynamo_helper_deadlock-storage \
  --format '{{ .Mountpoint }}')
DATASET_DIR="$VOLUME_ROOT/recommendation-decision-dataset-v5-full-crawler-db-timeline-20260726"
BEHAVIORAL_DIR="$VOLUME_ROOT/recommendation-behavioral-v4-full-crawler-recovery-v3-20260725"
BASELINE_VALUE_DIR="$VOLUME_ROOT/recommendation-value-v6-full-crawler-db-timeline-20260726"

for path in \
  "$DATASET_DIR/manifest.json" \
  "$DATASET_DIR/audit.json" \
  "$BEHAVIORAL_DIR/validation.ndjson" \
  "$BEHAVIORAL_DIR/model.json" \
  "$BEHAVIORAL_DIR/manifest.json" \
  "$BEHAVIORAL_DIR/audit.json" \
  "$BASELINE_VALUE_DIR/model.json" \
  "$BASELINE_VALUE_DIR/evaluation.json" \
  "$BASELINE_VALUE_DIR/audit.json"; do
  if ! sudo test -f "$path"; then
    echo "Missing required artifact: $path"
    exit 1
  fi
done

DATASET_FILE_NAME=$(sudo node -e \
  "const fs=require('fs'); const value=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(value.artifact.fileName));" \
  "$DATASET_DIR/manifest.json")
if ! sudo test -f "$DATASET_DIR/$DATASET_FILE_NAME"; then
  echo "Missing Dataset V5.3 artifact: $DATASET_DIR/$DATASET_FILE_NAME"
  exit 1
fi

node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v5-gzip.cjs" \
  "$DEPLOY_REPOSITORY"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-target-ablation.cjs" \
  "$DEPLOY_REPOSITORY"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-sweep-target-ablation.cjs" \
  "$GITHUB_WORKSPACE/scripts/run-recommendation-v6-prior-sweep.mjs"

node --check "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-target-ablation.cjs"
node --check "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-sweep-target-ablation.cjs"
node --check "$GITHUB_WORKSPACE/scripts/analyze-recommendation-v6-shrinkage.mjs"
node --check "$GITHUB_WORKSPACE/scripts/run-recommendation-v6-prior-sweep.mjs"
git -C "$DEPLOY_REPOSITORY" diff --check

YARN_PREFIX="$RUNNER_TEMP/recommendation-v6-improvement-yarn"
rm -rf "$YARN_PREFIX"
npm install --global --prefix "$YARN_PREFIX" yarn@1.22.22
export PATH="$YARN_PREFIX/bin:$PATH"

cd "$DEPLOY_REPOSITORY"
yarn workspace @deadlock-live-probe/shared build
yarn workspace @deadlock-live-probe/build-domain build
yarn workspace @deadlock-live-probe/api build
sudo docker compose build api

cd "$GITHUB_WORKSPACE"
export DEADLOCK_DEPLOY_REPOSITORY="$DEPLOY_REPOSITORY"
export RECOMMENDATION_V6_SWEEP_RESULT_DIR="$RESULT_DIRECTORY"
node scripts/run-recommendation-v6-prior-sweep.mjs

echo 'Recommendation V6 improvement sweep completed.'
