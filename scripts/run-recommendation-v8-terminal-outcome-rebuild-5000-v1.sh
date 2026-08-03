#!/usr/bin/env bash
set -euo pipefail

request='.github/training-requests/recommendation-v8-timeline-audit-fix-resume-v2.json'
branch='agent/recommendation-value-v8-passive-shadow-1'
container='deadlock-recommendation-v8-training'
deploy_dir='/home/ubuntu/apps/deadlock_dynamo_helper'
run_root='/home/ubuntu/apps/deadlock_dynamo_helper-training-5000'

validate_request() {
  test "$(jq -r '.operation' "$request")" = 'APPLY_TERMINAL_OUTCOMES_AND_REBUILD_5000_V1'
  test "$(jq -r '.state' "$request")" = 'REQUESTED'
  test "$(jq -r '.matchLimit' "$request")" = '5000'
  test "$(jq -r '.rebuildReplay' "$request")" = 'true'
  test "$(jq -r '.fullTrainingAuthorized' "$request")" = 'false'
  test "$(jq -r '.productionRankingChanged' "$request")" = 'false'
  test "$(jq -r '.passiveShadowActivated' "$request")" = 'false'
  test "$(jq -r '.randomizedCanaryAuthorized' "$request")" = 'false'
  test "$(jq -r '.observedActionInjectionAuthorized' "$request")" = 'false'
  test "$(jq -r '.lowerAuditThresholdsAuthorized' "$request")" = 'false'
}

refuse_active_training() {
  if sudo docker ps --format '{{.Names}}' | grep -Fxq "$container"; then
    if sudo docker exec "$container" sh -lc "pgrep -f '[r]un-recommendation-v8-diagnostic-only-pipeline.mjs|[r]un-recommendation-v8-training-supervisor.mjs|[r]un-recommendation-v8-clean-diagnostic-supervisor.mjs' >/dev/null"; then
      echo 'An active Recommendation V8 training process exists; refusing to replace it.' >&2
      exit 1
    fi
  fi
}

apply_and_test() {
  python3 scripts/patch-recommendation-v8-terminal-outcomes-v1.py
  python3 scripts/patch-recommendation-v8-terminal-outcomes-v1-followup.py
  python3 scripts/patch-recommendation-v8-terminal-outcomes-v1-lineage.py
  git diff --check

  builder_image="deadlock-recommendation-v8-terminal-builder:${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  sudo docker build --target builder -t "$builder_image" .
  sudo docker run --rm --entrypoint yarn "$builder_image" \
    workspace @deadlock-live-probe/api test \
    recommendation-historical-pro-replay-terminal-outcomes.spec.ts \
    recommendation-historical-pro-replay-streaming-audit.spec.ts \
    recommendation-historical-pro-replay-artifact.spec.ts \
    recommendation-pro-decision-dataset-v6.spec.ts \
    recommendation-pro-decision-dataset-v6-artifact.spec.ts \
    --runInBand

  git config user.name 'Recommendation V8 Recovery'
  git config user.email 'actions@users.noreply.github.com'
  git add \
    apps/api/src/deadlock-live/recommendation-historical-pro-replay-outcomes.ts \
    apps/api/src/deadlock-live/recommendation-historical-pro-replay.ts \
    apps/api/src/deadlock-live/recommendation-historical-pro-replay-streaming-audit.ts \
    apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts \
    apps/api/src/deadlock-live/recommendation-historical-postgres-timeline-cache.service.ts \
    apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6.ts \
    apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6-streaming-audit.ts \
    apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6-artifact.service.ts \
    apps/api/test/recommendation-historical-pro-replay-terminal-outcomes.spec.ts
  if ! git diff --cached --quiet; then
    git commit -m 'fix: use terminal outcomes for censored horizons'
    git push origin "HEAD:$branch"
  fi
  implementation_sha="$(git rev-parse HEAD)"

  training_image="deadlock-recommendation-v8-training:${implementation_sha}-terminal-outcomes-5000-v1"
  sudo docker build -t "$training_image" .
  sudo docker run --rm --entrypoint node "$training_image" --check /app/scripts/run-recommendation-v8-diagnostic-only-pipeline.mjs
}

resolve_storage_and_run() {
  production_api_container="$(cd "$deploy_dir" && sudo docker compose ps -q api)"
  test -n "$production_api_container"
  storage_type="$(sudo docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/apps/api/storage"}}{{.Type}}{{end}}{{end}}' "$production_api_container")"
  storage_name="$(sudo docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/apps/api/storage"}}{{.Name}}{{end}}{{end}}' "$production_api_container")"
  storage_source="$(sudo docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/apps/api/storage"}}{{.Source}}{{end}}{{end}}' "$production_api_container")"
  test -n "$storage_type"
  test -n "$storage_source"

  run_id="terminal-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  run_dir="$run_root/runs/$run_id"
  sudo mkdir -p "$run_dir"
  sudo chown -R "$(id -u):$(id -g)" "$run_root"
  ln -sfn "$run_dir" "$run_root/current"
  : > "$run_dir/training.log"

  catalog_row="$(sudo docker exec aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds -X -A -t -F '|' -c 'SELECT c.id, c."clientVersion" FROM item_catalog_versions c WHERE c."clientVersion" = 6637 ORDER BY c.id DESC LIMIT 1;')"
  test "$(echo "$catalog_row" | cut -d'|' -f2)" = '6637'
  catalog_version_id="$(echo "$catalog_row" | cut -d'|' -f1)"

  cat > "$run_dir/run.json" <<JSON
{
  "runId": "$run_id",
  "state": "PREPARING",
  "stage": "TERMINAL_OUTCOME_REBUILD",
  "matchLimit": 5000,
  "implementationSha": "$implementation_sha",
  "rebuildReplay": true,
  "fullTrainingAuthorized": false,
  "productionRankingChanged": false,
  "passiveShadowActivated": false,
  "randomizedCanaryAuthorized": false,
  "observedActionInjected": false,
  "auditThresholdsLowered": false
}
JSON

  suffix="before-terminal-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  directories=(
    recommendation-historical-pro-replay-v1
    recommendation-pro-decision-dataset-v6-1
    recommendation-behavioral-v5-1
    recommendation-value-v8-diagnostic-1
  )
  for directory in "${directories[@]}"; do
    source="$storage_source/$directory"
    backup="$storage_source/${directory}.${suffix}"
    test ! -e "$backup"
    if [ -e "$source" ]; then
      sudo mv "$source" "$backup"
    fi
  done
  printf '%s\n' "$suffix" > "$run_dir/storage-backup-suffix.txt"

  mount_args=()
  if [ "$storage_type" = 'volume' ]; then
    mount_args+=(--mount "type=volume,src=$storage_name,dst=/app/apps/api/storage")
  elif [ "$storage_type" = 'bind' ]; then
    mount_args+=(--mount "type=bind,src=$storage_source,dst=/app/apps/api/storage")
  else
    echo "Unsupported storage mount type: $storage_type" >&2
    exit 1
  fi

  sudo docker rm -f "$container" >/dev/null 2>&1 || true
  sudo docker run -d \
    --name "$container" \
    --restart=no \
    --cpus=2 \
    --memory=6g \
    --memory-swap=6g \
    --pids-limit=256 \
    --network aboba-telegramovich_default \
    -p 127.0.0.1:3010:3000 \
    --env-file "$deploy_dir/.env" \
    -e DB_HOST=aboba-telegramovich-postgres-1 \
    -e DB_PORT=5432 \
    -e DB_USER=postgres \
    -e DB_NAME=deadlock_builds \
    -e DEADLOCK_TIMELINE_COLLECTOR_ENABLED=false \
    -e DEADLOCK_RECENT_MATCH_CRAWLER_ENABLED=false \
    -e DEADLOCK_REFERENCE_DATA_IMPORT_ENABLED=false \
    -e DEADLOCK_RECOMMENDATION_OUTCOME_LINKER_ENABLED=false \
    -e DEADLOCK_TIMELINE_RECIPE_REFRESH_ENABLED=false \
    -e DEADLOCK_CONTEXTUAL_SHADOW_ENABLED=false \
    -e DEADLOCK_CONTEXTUAL_V3_LIVE_MODE=DISABLED \
    -e DEADLOCK_RECOMMENDATION_VALUE_V6_LIVE_MODE=DISABLED \
    -e DEADLOCK_RECOMMENDATION_VALUE_V8_SHADOW_ENABLED=false \
    -e DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SOURCE_DIR=/app/apps/api/storage/recommendation-v8-bounded-5000-v1/policy-v3 \
    -e DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_DIR=/app/apps/api/storage/recommendation-candidate-generator-snapshots-5000-v1 \
    -e DEADLOCK_RECOMMENDATION_HISTORICAL_PRO_REPLAY_SOURCE_DIR=/app/apps/api/storage/recommendation-v8-bounded-5000-v1/replay-v3 \
    -e DEADLOCK_RECOMMENDATION_CANDIDATE_GENERATOR_SNAPSHOT_REGISTRY_PATH=/app/apps/api/storage/recommendation-candidate-generator-snapshots-5000-v1/registry.json \
    -e NODE_OPTIONS=--max-old-space-size=4096 \
    "${mount_args[@]}" \
    --mount "type=bind,src=$run_dir,dst=/runner" \
    "$training_image"

  for attempt in $(seq 1 120); do
    if curl --fail --silent http://127.0.0.1:3010/deadlock/analysis/recommendation-historical-pro-replay/status >/dev/null; then
      break
    fi
    if [ "$(sudo docker inspect --format='{{.State.Running}}' "$container")" != 'true' ]; then
      sudo docker logs --tail=300 "$container"
      exit 1
    fi
    sleep 2
  done
  curl --fail --silent http://127.0.0.1:3010/deadlock/analysis/recommendation-historical-pro-replay/status >/dev/null

  sudo docker exec -d \
    -e API_BASE_URL=http://127.0.0.1:3000 \
    -e SNAPSHOT_ID=v8-5000-c6637-30701422914 \
    -e CANDIDATE_GENERATOR_VERSION=RECOMMENDATION_CANDIDATE_GENERATOR_V6_2_SUPPORT_UNION_5000 \
    -e CANDIDATE_POLICY_VERSION=RECOMMENDATION_CANDIDATE_POLICY_V6_2_SUPPORT_UNION_5000 \
    -e CATALOG_VERSION_ID="$catalog_version_id" \
    -e TRAINING_WINDOW_START=2026-07-18T12:31:22.000Z \
    -e TRAINING_WINDOW_END=2026-07-22T09:32:54.000Z \
    -e TUNING_START=2026-07-26T05:57:36.000Z \
    -e FUTURE_TEST_START=2026-07-27T20:43:24.000Z \
    -e REPLAY_PARTITION_COUNT=16 \
    -e REPLAY_SNAPSHOT_STALENESS_S=300 \
    -e DATASET_DECISION_SNAPSHOT_STALENESS_S=300 \
    -e DIAGNOSTIC_MAX_ROWS=2000000 \
    -e PIPELINE_POLL_INTERVAL_MS=10000 \
    -e PIPELINE_TIMEOUT_MS=172800000 \
    -e PIPELINE_REQUEST_TIMEOUT_MS=30000 \
    -e PIPELINE_REQUEST_RETRY_COUNT=240 \
    -e PIPELINE_REQUEST_RETRY_DELAY_MS=5000 \
    "$container" \
    sh -lc 'node /app/scripts/run-recommendation-v8-diagnostic-only-pipeline.mjs >> /runner/training.log 2>&1'

  for attempt in $(seq 1 120); do
    if sudo docker exec "$container" sh -lc "pgrep -f '[r]un-recommendation-v8-diagnostic-only-pipeline.mjs' >/dev/null"; then
      break
    fi
    sleep 1
  done
  sudo docker exec "$container" sh -lc "pgrep -f '[r]un-recommendation-v8-diagnostic-only-pipeline.mjs' >/dev/null"

  for attempt in $(seq 1 120); do
    status="$(curl --silent --show-error --max-time 10 http://127.0.0.1:3010/deadlock/analysis/recommendation-historical-pro-replay/status || true)"
    state="$(jq -r '.state // empty' <<<"$status" 2>/dev/null || true)"
    if [ "$state" = 'RUNNING' ] || [ "$state" = 'COMPLETE' ]; then
      echo "$status" | tee "$run_dir/replay-status.json"
      break
    fi
    sleep 2
  done
  test -s "$run_dir/replay-status.json"

  python3 - "$run_dir/run.json" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
path = Path(sys.argv[1])
value = json.loads(path.read_text())
value['state'] = 'RUNNING'
value['stage'] = 'HISTORICAL_REPLAY'
value['trainingRestartedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
path.write_text(json.dumps(value, indent=2) + '\n')
PY
  sudo docker stats --no-stream "$container" | tee "$run_dir/docker-stats.txt"

  echo "TRAINING_RUN_DIR=$run_dir" >> "$GITHUB_ENV"
  echo "TRAINING_RUN_ID=$run_id" >> "$GITHUB_ENV"
  publish_result
}

publish_result() {
  result='.github/training-results/recommendation-v8-terminal-outcome-rebuild-5000-v1.json'
  mkdir -p "$(dirname "$result")"
  jq -n \
    --arg generatedAt "$(date --iso-8601=seconds)" \
    --arg workflowRunId "$GITHUB_RUN_ID" \
    --arg implementationSha "$implementation_sha" \
    --arg image "$training_image" \
    --arg runId "$run_id" \
    --slurpfile run "$run_dir/run.json" \
    --slurpfile replayStatus "$run_dir/replay-status.json" \
    '{
      generatedAt: $generatedAt,
      workflowRunId: $workflowRunId,
      implementationSha: $implementationSha,
      image: $image,
      runId: $runId,
      run: $run[0],
      replayStatus: $replayStatus[0]
    }' > "$result"

  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git fetch origin "$branch"
  git pull --rebase origin "$branch"
  git add "$result"
  git commit -m 'chore: publish terminal outcome 5000-match restart result'
  git push origin "$branch"
}

validate_request
refuse_active_training
apply_and_test
resolve_storage_and_run
