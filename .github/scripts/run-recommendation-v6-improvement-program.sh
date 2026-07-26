#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_REPOSITORY=/home/ubuntu/apps/deadlock_dynamo_helper
EXPECTED_COMMIT=251660fc3dd541925b8ade9c55d216a91a975d85
RESULT_DIRECTORY="$GITHUB_WORKSPACE/recommendation-v6-improvement-result"
V6_OVERRIDE_PATH=/tmp/recommendation-v6-improvement.override.yml
V7_POLICY_OVERRIDE_PATH=/tmp/recommendation-v7-policy.override.yml
V7_VALUE_CONTAINER_DIR=/app/apps/api/storage/recommendation-value-v7-catboost-db-timeline-20260726
V7_POLICY_CONTAINER_DIR=/app/apps/api/storage/recommendation-policy-v7-catboost-db-timeline-20260726

mkdir -p "$RESULT_DIRECTORY"
exec > >(tee "$RESULT_DIRECTORY/00-run.log") 2>&1

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e

  echo '=== RESTORE CLEAN PRODUCTION API ==='
  rm -f "$V6_OVERRIDE_PATH" "$V7_POLICY_OVERRIDE_PATH"
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
V7_VALUE_HOST_DIR="$VOLUME_ROOT/recommendation-value-v7-catboost-db-timeline-20260726"
V7_POLICY_HOST_DIR="$VOLUME_ROOT/recommendation-policy-v7-catboost-db-timeline-20260726"

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

DATASET_FILE_NAME=$(sudo cat "$DATASET_DIR/manifest.json" | node -e \
  "let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',(chunk)=>input+=chunk); process.stdin.on('end',()=>{const value=JSON.parse(input); process.stdout.write(String(value.artifact.fileName));});")
if ! sudo test -f "$DATASET_DIR/$DATASET_FILE_NAME"; then
  echo "Missing Dataset V5.3 artifact: $DATASET_DIR/$DATASET_FILE_NAME"
  exit 1
fi

node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v5-gzip.cjs" \
  "$DEPLOY_REPOSITORY"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-target-ablation.cjs" \
  "$DEPLOY_REPOSITORY"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-policy-v6-accept-v7.cjs" \
  "$DEPLOY_REPOSITORY"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-sweep-target-ablation.cjs" \
  "$GITHUB_WORKSPACE/scripts/run-recommendation-v6-prior-sweep.mjs"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v7-short-match-split.cjs" \
  "$GITHUB_WORKSPACE/scripts/train_recommendation_v7_catboost.py"
node "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-v7-comparator-schema.cjs" \
  "$GITHUB_WORKSPACE/scripts/compare-recommendation-v6-v7-results.mjs"

for script in \
  "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-target-ablation.cjs" \
  "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-policy-v6-accept-v7.cjs" \
  "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-sweep-target-ablation.cjs" \
  "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v7-short-match-split.cjs" \
  "$GITHUB_WORKSPACE/.github/scripts/patch-recommendation-v6-v7-comparator-schema.cjs" \
  "$GITHUB_WORKSPACE/scripts/analyze-recommendation-v6-shrinkage.mjs" \
  "$GITHUB_WORKSPACE/scripts/run-recommendation-v6-prior-sweep.mjs" \
  "$GITHUB_WORKSPACE/scripts/run-recommendation-v7-policy-evaluation.mjs" \
  "$GITHUB_WORKSPACE/scripts/compare-recommendation-v6-v7-results.mjs"; do
  node --check "$script"
done
python3 -m py_compile "$GITHUB_WORKSPACE/scripts/train_recommendation_v7_catboost.py"
git -C "$DEPLOY_REPOSITORY" diff --check

YARN_PREFIX="$RUNNER_TEMP/recommendation-v6-improvement-yarn"
rm -rf "$YARN_PREFIX"
npm install --global --prefix "$YARN_PREFIX" yarn@1.22.22
export PATH="$YARN_PREFIX/bin:$PATH"

sudo apt-get update
sudo apt-get install -y python3-venv
PYTHON_ENV="$RUNNER_TEMP/recommendation-v7-python"
rm -rf "$PYTHON_ENV"
python3 -m venv "$PYTHON_ENV"
"$PYTHON_ENV/bin/python" -m pip install --disable-pip-version-check --upgrade pip
"$PYTHON_ENV/bin/python" -m pip install --disable-pip-version-check catboost==1.2.10

cd "$DEPLOY_REPOSITORY"
yarn workspace @deadlock-live-probe/shared build
yarn workspace @deadlock-live-probe/build-domain build
yarn workspace @deadlock-live-probe/api build
sudo docker compose build api

cd "$GITHUB_WORKSPACE"
export DEADLOCK_DEPLOY_REPOSITORY="$DEPLOY_REPOSITORY"
export RECOMMENDATION_V6_SWEEP_RESULT_DIR="$RESULT_DIRECTORY"

echo '=== RUN V6 SHRINKAGE, PRIOR, SCALE, AND TARGET SWEEP ==='
node scripts/run-recommendation-v6-prior-sweep.mjs

echo '=== RUN V7 CATBOOST STATE AND CANDIDATE SCORERS ==='
sudo mkdir -p "$V7_VALUE_HOST_DIR" "$V7_POLICY_HOST_DIR"
sudo chown -R "$(id -u):$(id -g)" "$V7_VALUE_HOST_DIR" "$V7_POLICY_HOST_DIR"
"$PYTHON_ENV/bin/python" scripts/train_recommendation_v7_catboost.py \
  --dataset "$DATASET_DIR/$DATASET_FILE_NAME" \
  --manifest "$DATASET_DIR/manifest.json" \
  --audit "$DATASET_DIR/audit.json" \
  --output-dir "$V7_VALUE_HOST_DIR" \
  --report-dir "$RESULT_DIRECTORY"

echo '=== RUN V7 PROPENSITY-CORRECTED POLICY OPE ==='
export RECOMMENDATION_V7_VALUE_DIR="$V7_VALUE_CONTAINER_DIR"
export RECOMMENDATION_V7_POLICY_DIR="$V7_POLICY_CONTAINER_DIR"
export RECOMMENDATION_V7_BEHAVIORAL_DIR=/app/apps/api/storage/recommendation-behavioral-v4-full-crawler-recovery-v3-20260725
export RECOMMENDATION_V7_RESULT_DIR="$RESULT_DIRECTORY"
node scripts/run-recommendation-v7-policy-evaluation.mjs

echo '=== COMPARE V6 AND V7 AND BUILD THE NEXT ROADMAP ==='
node scripts/compare-recommendation-v6-v7-results.mjs

echo 'Recommendation V6/V7 improvement program completed.'
