#!/usr/bin/env bash
set -euo pipefail

request='.github/training-requests/recommendation-v8-timeline-audit-fix-resume-v2.json'
container='deadlock-recommendation-v8-training'
rebuild_script='scripts/run-recommendation-v8-terminal-outcome-rebuild-5000-v2.sh'
minimum_runtime_reserve_gib="$(jq -r '.minimumRuntimeReserveGiB' "$request")"
minimum_runtime_reserve_kb=$((minimum_runtime_reserve_gib * 1024 * 1024))

test "$minimum_runtime_reserve_gib" = '12'
test "$(jq -r '.minimumFreeGiB' "$request")" = '50'
test "$(jq -r '.compactReplayCandidates' "$request")" = 'true'
test "$(jq -r '.observedActionInjectionAuthorized' "$request")" = 'false'

start_disk_guard() {
  if ! sudo docker ps --format '{{.Names}}' | grep -Fxq "$container"; then
    return 1
  fi

  sudo docker exec -d \
    -e RECOMMENDATION_V8_MINIMUM_AVAILABLE_KB="$minimum_runtime_reserve_kb" \
    -e RECOMMENDATION_V8_DISK_CHECK_INTERVAL_S=60 \
    "$container" \
    sh /app/scripts/monitor-recommendation-v8-disk-reserve-v1.sh

  for attempt in $(seq 1 30); do
    if sudo docker exec "$container" sh -lc "pgrep -f '[m]onitor-recommendation-v8-disk-reserve-v1.sh' >/dev/null"; then
      return 0
    fi
    sleep 1
  done

  echo 'Recommendation V8 disk reserve guard did not start.' >&2
  return 1
}

bash "$rebuild_script" &
rebuild_pid=$!
guard_started=false

while kill -0 "$rebuild_pid" >/dev/null 2>&1; do
  if [ "$guard_started" = 'false' ] && sudo docker ps --format '{{.Names}}' | grep -Fxq "$container"; then
    start_disk_guard
    guard_started=true
  fi
  sleep 2
done

set +e
wait "$rebuild_pid"
rebuild_status=$?
set -e

if [ "$guard_started" = 'false' ] && sudo docker ps --format '{{.Names}}' | grep -Fxq "$container"; then
  start_disk_guard
  guard_started=true
fi

test "$rebuild_status" -eq 0
test "$guard_started" = 'true'
sudo docker exec "$container" sh -lc "pgrep -f '[m]onitor-recommendation-v8-disk-reserve-v1.sh' >/dev/null"
