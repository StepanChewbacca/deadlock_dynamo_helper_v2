#!/usr/bin/env bash
set -u -o pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/apps/deadlock_dynamo_helper}"
AUDIT_REPORT="${AUDIT_REPORT:?AUDIT_REPORT is required}"
AUDIT_SUMMARY="${AUDIT_SUMMARY:?AUDIT_SUMMARY is required}"

cd "$DEPLOY_DIR" || exit 1
production_api_container="$(sudo docker compose ps -q api)"
if [ -z "$production_api_container" ]; then
  echo 'Production API container is not running.' >&2
  exit 1
fi
storage_source="$(sudo docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/apps/api/storage"}}{{.Source}}{{end}}{{end}}' "$production_api_container")"
if [ -z "$storage_source" ] || [ ! -d "$storage_source" ]; then
  echo 'Could not resolve production storage.' >&2
  exit 1
fi

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
protected_directories=' build-decision-dataset-v3 match-timeline-events-v1 recommendation-decision-telemetry contextual-v3-training contextual-v3-candidate-evaluation-v2 contextual-v3-final-test recommendation-value-v6-training recommendation-value-v6-live-candidates recommendation-value-v6-user-live-telemetry item-catalog-snapshots deadlock-live recommendation-candidate-generator-snapshots recommendation-historical-pro-replay-v1 recommendation-pro-decision-dataset-v6-1 recommendation-behavioral-v5-1 recommendation-value-v8-diagnostic-1 recommendation-v6-short-only-dataset-v6-baseline-1 recommendation-value-v8-full-evaluation-1 recommendation-value-v8-passive-shadow-1 '

before_available_bytes="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
estimated_bytes=0
deleted_count=0
missing_count=0
failure_count=0

{
  echo "Cleanup started at: $(date --iso-8601=seconds)"
  echo "Storage: $storage_source"
  echo 'Production and active V8 paths are protected by exact-name denylist.'
  echo
  df -hT /
  echo
  sudo docker ps --filter name=deadlock-recommendation-v8-training --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
  if [ -r /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json ]; then
    cat /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json
  fi
  echo
} | tee "$AUDIT_REPORT"

for directory in "${obsolete_directories[@]}"; do
  if [[ "$protected_directories" == *" $directory "* ]]; then
    echo "REFUSE protected: $directory" | tee -a "$AUDIT_REPORT"
    failure_count=$((failure_count + 1))
    continue
  fi
  path="$storage_source/$directory"
  if [[ "$path" != "$storage_source/"* ]]; then
    echo "REFUSE outside storage: $path" | tee -a "$AUDIT_REPORT"
    failure_count=$((failure_count + 1))
    continue
  fi
  if [ ! -e "$path" ]; then
    echo "SKIP missing: $directory" | tee -a "$AUDIT_REPORT"
    missing_count=$((missing_count + 1))
    continue
  fi

  bytes="$(sudo du -sb "$path" 2>/dev/null | awk '{print $1}')"
  bytes="${bytes:-0}"
  estimated_bytes=$((estimated_bytes + bytes))
  human="$(numfmt --to=iec-i --suffix=B "$bytes" 2>/dev/null || echo "${bytes}B")"
  echo "DELETE obsolete: $directory ($human)" | tee -a "$AUDIT_REPORT"
  sudo find "$path" -maxdepth 3 -type f \( -name 'manifest.json' -o -name 'audit.json' -o -name 'evaluation.json' -o -name 'model.json' \) -print 2>/dev/null | head -n 100 | tee -a "$AUDIT_REPORT" || true
  if sudo rm -rf "$path" && [ ! -e "$path" ]; then
    deleted_count=$((deleted_count + 1))
  else
    echo "FAILED delete: $directory" | tee -a "$AUDIT_REPORT"
    failure_count=$((failure_count + 1))
  fi
done

after_available_bytes="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
actual_bytes=$((after_available_bytes - before_available_bytes))

{
  echo
  echo '=== After cleanup ==='
  df -hT /
  sudo du -xsh "$storage_source" 2>/dev/null || true
  sudo du -xhd1 "$storage_source" 2>/dev/null | sort -h | tail -n 35 || true
  echo
  echo '=== Training remains active ==='
  sudo docker ps --filter name=deadlock-recommendation-v8-training --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
  if [ -r /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json ]; then
    cat /home/ubuntu/apps/deadlock_dynamo_helper-training/current/status.json
  fi
  echo "deletedCount=$deleted_count missingCount=$missing_count failureCount=$failure_count estimatedBytes=$estimated_bytes actualBytes=$actual_bytes"
} | tee -a "$AUDIT_REPORT"

cat > "$AUDIT_SUMMARY" <<JSON
{
  "schemaVersion": 1,
  "generatedAt": "$(date --iso-8601=seconds)",
  "storageSource": "$storage_source",
  "deletedDirectoryCount": $deleted_count,
  "missingDirectoryCount": $missing_count,
  "failureCount": $failure_count,
  "estimatedArtifactBytesRemoved": $estimated_bytes,
  "actualAvailableBytesIncrease": $actual_bytes,
  "beforeAvailableBytes": $before_available_bytes,
  "afterAvailableBytes": $after_available_bytes,
  "productionRuntimeChanged": false,
  "trainingContainerStopped": false
}
JSON

if [ "$failure_count" -ne 0 ]; then
  exit 1
fi
