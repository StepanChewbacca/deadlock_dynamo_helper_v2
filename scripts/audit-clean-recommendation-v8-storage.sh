#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/apps/deadlock_dynamo_helper}"
AUDIT_REPORT="${AUDIT_REPORT:?AUDIT_REPORT is required}"
AUDIT_SUMMARY="${AUDIT_SUMMARY:?AUDIT_SUMMARY is required}"

cd "$DEPLOY_DIR"
production_api_container="$(sudo docker compose ps -q api)"
if [ -z "$production_api_container" ]; then
  echo 'Production API container is not running.' >&2
  exit 1
fi

storage_source="$(sudo docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/apps/api/storage"}}{{.Source}}{{end}}{{end}}' "$production_api_container")"
if [ -z "$storage_source" ] || [ ! -d "$storage_source" ]; then
  echo 'Could not resolve the production storage directory.' >&2
  exit 1
fi

protected_directories=(
  'build-decision-dataset-v3'
  'match-timeline-events-v1'
  'recommendation-decision-telemetry'
  'contextual-v3-training'
  'contextual-v3-candidate-evaluation-v2'
  'contextual-v3-final-test'
  'recommendation-value-v6-training'
  'recommendation-value-v6-live-candidates'
  'recommendation-value-v6-user-live-telemetry'
  'item-catalog-snapshots'
  'deadlock-live'
  'recommendation-candidate-generator-snapshots'
  'recommendation-historical-pro-replay-v1'
  'recommendation-pro-decision-dataset-v6-1'
  'recommendation-behavioral-v5-1'
  'recommendation-value-v8-diagnostic-1'
  'recommendation-v6-short-only-dataset-v6-baseline-1'
  'recommendation-value-v8-full-evaluation-1'
  'recommendation-value-v8-passive-shadow-1'
)

obsolete_directories=(
  'recommendation-value-v5-scale-sweep-full-crawler-20260725'
  'recommendation-value-v5-full-crawler-recovery-v3-20260725'
  'recommendation-value-v4-training-historical-bootstrap'
  'recommendation-value-v4-training-historical-bootstrap-tuning'
  'recommendation-value-v4-full-crawler-20260724'
  'recommendation-value-v4-training-historical-bootstrap-v2'
  'contextual-v3-candidate-evaluation-full-crawler-20260724'
  'match-timeline-events-v1-historical-db-20260726'
  'recommendation-value-v4-full-crawler-recovery-v3-20260725'
  'recommendation-behavioral-v4-full-crawler-20260724'
  'recommendation-behavioral-v4-training-historical-bootstrap'
  'recommendation-decision-dataset-v5-full-crawler-20260726'
  'recommendation-decision-dataset-v5-full-crawler-db-timeline-20260726'
  'recommendation-policy-v4-evaluation-historical-bootstrap'
  'recommendation-policy-v7-catboost-db-timeline-20260726'
  'contextual-v3-candidate-evaluation-full-crawler-recovery-v3-20260725'
  'contextual-v3-training-full-crawler-20260724'
  'recommendation-policy-v6-prior-sweep-db-timeline-20260726'
  'recommendation-value-v6-full-crawler-20260726'
  'recommendation-value-v6-full-crawler-db-timeline-20260726'
  'build-decision-dataset-v3-full-crawler-20260724'
  'recommendation-behavioral-v4-full-crawler-recovery-v3-20260725'
  'recommendation-policy-v6-full-crawler-20260726'
  'recommendation-policy-v6-full-crawler-db-timeline-20260726'
  'recommendation-value-v7-catboost-db-timeline-20260726'
  'recommendation-value-v6-prior-sweep-db-timeline-20260726'
  'recommendation-decision-dataset-v4-full-crawler-recovery-v3-20260725'
)

is_protected() {
  local candidate="$1"
  local protected
  for protected in "${protected_directories[@]}"; do
    if [ "$candidate" = "$protected" ]; then
      return 0
    fi
  done
  return 1
}

before_available_bytes="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
estimated_reclaim_bytes=0
deleted_count=0
missing_count=0

{
  echo "Storage cleanup audit generated at: $(date --iso-8601=seconds)"
  echo "Production API container: $production_api_container"
  echo "Storage source: $storage_source"
  echo
  echo '=== Training process before cleanup ==='
  sudo docker ps --filter name=deadlock-recommendation-v8-training --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
  if [ -r /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json ]; then
    cat /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json
  fi
  echo
  echo '=== Filesystem before cleanup ==='
  df -hT /
  echo
  echo '=== Protected runtime and active pipeline directories ==='
  printf '%s\n' "${protected_directories[@]}"
  echo
  echo '=== Obsolete artifact cleanup ==='
} | tee "$AUDIT_REPORT"

for directory in "${obsolete_directories[@]}"; do
  if is_protected "$directory"; then
    echo "Refusing to delete protected directory: $directory" | tee -a "$AUDIT_REPORT" >&2
    exit 1
  fi
  path="$storage_source/$directory"
  case "$path" in
    "$storage_source"/*) ;;
    *)
      echo "Refusing path outside storage: $path" | tee -a "$AUDIT_REPORT" >&2
      exit 1
      ;;
  esac
  if [ ! -e "$path" ]; then
    echo "SKIP missing: $directory" | tee -a "$AUDIT_REPORT"
    missing_count=$((missing_count + 1))
    continue
  fi

  bytes="$(sudo du -sb "$path" | awk '{print $1}')"
  human="$(numfmt --to=iec-i --suffix=B "$bytes")"
  estimated_reclaim_bytes=$((estimated_reclaim_bytes + bytes))
  deleted_count=$((deleted_count + 1))
  echo "DELETE obsolete: $directory ($human)" | tee -a "$AUDIT_REPORT"
  sudo find "$path" -maxdepth 4 -type f \( -name 'manifest.json' -o -name 'audit.json' -o -name 'evaluation.json' -o -name 'model.json' \) -print -exec sha256sum {} \; 2>/dev/null | tee -a "$AUDIT_REPORT" || true
  sudo rm -rf --one-file-system "$path"
done

sudo docker image prune -af --filter 'until=168h' | tee -a "$AUDIT_REPORT"
sudo docker builder prune -af --filter 'until=168h' | tee -a "$AUDIT_REPORT"

after_available_bytes="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
actual_reclaimed_bytes=$((after_available_bytes - before_available_bytes))

{
  echo
  echo '=== Filesystem after cleanup ==='
  df -hT /
  echo
  echo '=== Storage size after cleanup ==='
  sudo du -xsh "$storage_source"
  echo
  echo '=== Largest remaining storage directories ==='
  sudo du -xhd1 "$storage_source" 2>/dev/null | sort -h | tail -n 40
  echo
  echo '=== Training process after cleanup ==='
  sudo docker ps --filter name=deadlock-recommendation-v8-training --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
  if [ -r /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json ]; then
    cat /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json
  fi
  echo
  echo "Deleted directory count: $deleted_count"
  echo "Missing directory count: $missing_count"
  echo "Estimated artifact bytes removed: $estimated_reclaim_bytes"
  echo "Actual filesystem available-byte increase: $actual_reclaimed_bytes"
} | tee -a "$AUDIT_REPORT"

cat > "$AUDIT_SUMMARY" <<JSON
{
  "schemaVersion": 1,
  "generatedAt": "$(date --iso-8601=seconds)",
  "storageSource": "$storage_source",
  "deletedDirectoryCount": $deleted_count,
  "missingDirectoryCount": $missing_count,
  "estimatedArtifactBytesRemoved": $estimated_reclaim_bytes,
  "actualAvailableBytesIncrease": $actual_reclaimed_bytes,
  "beforeAvailableBytes": $before_available_bytes,
  "afterAvailableBytes": $after_available_bytes,
  "productionRuntimeChanged": false,
  "trainingContainerStopped": false
}
JSON
