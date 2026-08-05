#!/usr/bin/env bash
set -euo pipefail

request='.github/training-requests/recommendation-v8-timeline-audit-fix-resume-v2.json'
container='deadlock-recommendation-v8-training'
deploy_dir='/home/ubuntu/apps/deadlock_dynamo_helper'
run_root='/home/ubuntu/apps/deadlock_dynamo_helper-training-5000'
replay_dir_name='recommendation-historical-pro-replay-terminal-5000-v2'
dataset_dir_name='recommendation-pro-decision-dataset-v6-terminal-5000-v2'
behavioral_dir_name='recommendation-behavioral-v5-terminal-5000-v2'
diagnostic_dir_name='recommendation-value-v8-diagnostic-terminal-5000-v2'
snapshot_id='v8-5000-c6637-30701422914'

refuse_active_training() {
  if sudo docker ps --format '{{.Names}}' | grep -Fxq "$container"; then
    if sudo docker exec "$container" sh -lc "pgrep -f '[r]un-recommendation-v8-diagnostic-only-pipeline.mjs|[r]un-recommendation-v8-training-supervisor.mjs|[r]un-recommendation-v8-clean-diagnostic-supervisor.mjs' >/dev/null"; then
      echo 'An active Recommendation V8 training process exists; refusing cleanup.' >&2
      exit 1
    fi
  fi
}

resolve_storage() {
  production_api_container="$(cd "$deploy_dir" && sudo docker compose ps -q api)"
  test -n "$production_api_container"
  storage_source="$(sudo docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/apps/api/storage"}}{{.Source}}{{end}}{{end}}' "$production_api_container")"
  test -n "$storage_source"
}

verify_capacity_contract() {
  test "$(jq -r '.minimumFreeGiB' "$request")" = '50'
  test "$(jq -r '.minimumRuntimeReserveGiB' "$request")" = '12'
  test "$(jq -r '.compactReplayCandidates' "$request")" = 'true'
  test "$(jq -r '.historicalOfflineCandidateLimit' "$request")" = '256'
  test "$(jq -r '.projectedObservedActionCandidateCoverage' "$request")" = '0.9993386075392879'
  test "$(jq -r '.observedActionInjectionAuthorized' "$request")" = 'false'
}

verify_preserved_inputs() {
  sudo test -s "$storage_source/recommendation-v8-bounded-5000-v1/replay-v3/dataset.ndjson"
  sudo test -s "$storage_source/recommendation-v8-bounded-5000-v1/replay-v3/manifest.json"
  sudo test -d "$storage_source/recommendation-v8-bounded-5000-v1/policy-v3"
  sudo test -s "$storage_source/recommendation-candidate-generator-snapshots-5000-v1/registry.json"
  sudo test -s "$storage_source/recommendation-candidate-generator-snapshots-5000-v1/$snapshot_id.json"
  sudo test -s "$storage_source/recommendation-candidate-generator-snapshots-5000-v1/$snapshot_id.audit.json"
  test "$(sudo jq -r '.passed' "$storage_source/recommendation-candidate-generator-snapshots-5000-v1/$snapshot_id.audit.json")" = 'true'
  sudo test -d "$storage_source/match-timeline-events-v1"
  sudo docker inspect aboba-telegramovich-postgres-1 >/dev/null
}

prepare_evidence() {
  cleanup_id="terminal-cleanup-v3-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
  cleanup_dir="$run_root/runs/$cleanup_id"
  sudo mkdir -p "$cleanup_dir/evidence"
  sudo chown -R "$(id -u):$(id -g)" "$run_root"

  {
    echo "generatedAt=$(date --iso-8601=seconds)"
    echo "storageSource=$storage_source"
    echo '=== filesystem ==='
    df -hT /
    df -B1 /
    echo '=== storage top level ==='
    sudo du -xhd1 "$storage_source" 2>/dev/null | sort -h | tail -n 100
    echo '=== Docker usage ==='
    sudo docker system df || true
    echo '=== training container ==='
    sudo docker ps -a --filter "name=^/${container}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
  } | tee "$cleanup_dir/disk-before.txt"

  preserve_directories=(
    recommendation-historical-pro-replay-v1
    "$replay_dir_name"
    build-decision-dataset-v3
    recommendation-v8-failed-artifacts
  )

  for name in "${preserve_directories[@]}"; do
    source="$storage_source/$name"
    if sudo test -d "$source"; then
      while IFS= read -r file; do
        test -n "$file" || continue
        relative="${file#${source}/}"
        target="$cleanup_dir/evidence/$name/$relative"
        mkdir -p "$(dirname "$target")"
        sudo cp "$file" "$target"
      done < <(
        sudo find "$source" -maxdepth 5 -type f \
          \( -name 'manifest.json' -o -name 'audit.json' -o -name 'checkpoint.json' -o -name 'finalization-checkpoint.json' -o -name 'status.json' -o -name 'summary.json' \) \
          -size -8M 2>/dev/null | head -n 500
      )
    fi
  done
}

remove_obsolete_artifacts() {
  sudo docker rm -f "$container" >/dev/null 2>&1 || true

  obsolete=(
    recommendation-historical-pro-replay-v1
    "$replay_dir_name"
    "$dataset_dir_name"
    "$behavioral_dir_name"
    "$diagnostic_dir_name"
    recommendation-v8-failed-artifacts
    recommendation-candidate-generator-snapshots
    build-decision-dataset-v3
    contextual-v3-training
    contextual-v3-final-test
    contextual-v3-candidate-evaluation-v2
    recommendation-pro-decision-dataset-v6-1
    recommendation-behavioral-v5-1
    recommendation-value-v8-diagnostic-1
    recommendation-v6-short-only-dataset-v6-baseline-1
    recommendation-value-v8-full-evaluation-1
    recommendation-value-v8-passive-shadow-1
    recommendation-value-v5-scale-sweep-full-crawler-20260725
    recommendation-value-v5-full-crawler-recovery-v3-20260725
    recommendation-value-v4-training-historical-bootstrap
    recommendation-value-v4-training-historical-bootstrap-tuning
    recommendation-value-v4-full-crawler-20260724
    recommendation-value-v4-training-historical-bootstrap-v2
    contextual-v3-candidate-evaluation-full-crawler-20260724
    match-timeline-events-v1-historical-db-20260726
    recommendation-value-v4-full-crawler-recovery-v3-20260725
    recommendation-behavioral-v4-full-crawler-20260724
    recommendation-behavioral-v4-training-historical-bootstrap
    recommendation-decision-dataset-v5-full-crawler-20260726
    recommendation-decision-dataset-v5-full-crawler-db-timeline-20260726
    recommendation-policy-v4-evaluation-historical-bootstrap
    recommendation-policy-v7-catboost-db-timeline-20260726
    contextual-v3-candidate-evaluation-full-crawler-recovery-v3-20260725
    contextual-v3-training-full-crawler-20260724
    recommendation-policy-v6-prior-sweep-db-timeline-20260726
    recommendation-value-v6-full-crawler-20260726
    recommendation-value-v6-full-crawler-db-timeline-20260726
    build-decision-dataset-v3-full-crawler-20260724
    recommendation-behavioral-v4-full-crawler-recovery-v3-20260725
    recommendation-policy-v6-full-crawler-20260726
    recommendation-policy-v6-full-crawler-db-timeline-20260726
    recommendation-value-v7-catboost-db-timeline-20260726
    recommendation-value-v6-prior-sweep-db-timeline-20260726
    recommendation-decision-dataset-v4-full-crawler-recovery-v3-20260725
  )

  : > "$cleanup_dir/removed-artifacts.txt"
  for name in "${obsolete[@]}"; do
    path="$storage_source/$name"
    if sudo test -e "$path"; then
      size="$(sudo du -sh "$path" 2>/dev/null | awk '{print $1}' || true)"
      printf '%s\t%s\n' "${size:-unknown}" "$name" | tee -a "$cleanup_dir/removed-artifacts.txt"
      sudo rm -rf "$path"
    fi
  done

  sudo find "$storage_source/recommendation-candidate-generator-snapshots-5000-v1" \
    -maxdepth 1 -type f -name '*.partial' -mmin +30 -delete 2>/dev/null || true

  sudo docker builder prune -af || true
  sudo docker image prune -af --filter 'until=24h' || true
}

verify_cleanup() {
  verify_preserved_inputs

  for name in "$replay_dir_name" "$dataset_dir_name" "$behavioral_dir_name" "$diagnostic_dir_name" recommendation-historical-pro-replay-v1; do
    sudo test ! -e "$storage_source/$name"
  done

  free_bytes="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
  minimum_free_gib="$(jq -r '.minimumFreeGiB' "$request")"
  minimum_free_bytes=$((minimum_free_gib * 1024 * 1024 * 1024))

  {
    echo "generatedAt=$(date --iso-8601=seconds)"
    echo "freeBytes=$free_bytes"
    echo "minimumFreeGiB=$minimum_free_gib"
    echo "minimumFreeBytes=$minimum_free_bytes"
    echo '=== filesystem ==='
    df -hT /
    df -B1 /
    echo '=== preserved inputs ==='
    sudo du -sh \
      "$storage_source/recommendation-v8-bounded-5000-v1" \
      "$storage_source/recommendation-candidate-generator-snapshots-5000-v1" \
      "$storage_source/match-timeline-events-v1"
    echo '=== storage top level ==='
    sudo du -xhd1 "$storage_source" 2>/dev/null | sort -h | tail -n 100
    echo '=== Docker usage ==='
    sudo docker system df || true
  } | tee "$cleanup_dir/disk-after.txt"

  test "$free_bytes" -ge "$minimum_free_bytes"
}

refuse_active_training
resolve_storage
verify_capacity_contract
verify_preserved_inputs
prepare_evidence
remove_obsolete_artifacts
verify_cleanup

exec bash scripts/run-recommendation-v8-terminal-outcome-rebuild-5000-v2.sh
