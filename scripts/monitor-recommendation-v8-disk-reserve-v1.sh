#!/usr/bin/env sh
set -eu

storage_path='/app/apps/api/storage'
log_path='/runner/disk-guard.log'
minimum_available_kb="${RECOMMENDATION_V8_MINIMUM_AVAILABLE_KB:?RECOMMENDATION_V8_MINIMUM_AVAILABLE_KB is required}"
check_interval_s="${RECOMMENDATION_V8_DISK_CHECK_INTERVAL_S:-60}"

case "$minimum_available_kb" in
  ''|*[!0-9]*)
    echo 'RECOMMENDATION_V8_MINIMUM_AVAILABLE_KB must be a positive integer.' >&2
    exit 1
    ;;
esac

while true; do
  available_kb="$(df -Pk "$storage_path" | awk 'NR == 2 { print $4 }')"
  if [ -z "$available_kb" ]; then
    printf '%s unable to read available storage\n' "$(date -Iseconds)" >> "$log_path"
    kill -TERM 1
    exit 1
  fi

  printf '%s availableKb=%s minimumAvailableKb=%s\n' \
    "$(date -Iseconds)" \
    "$available_kb" \
    "$minimum_available_kb" >> "$log_path"

  if [ "$available_kb" -lt "$minimum_available_kb" ]; then
    printf '%s disk reserve reached; stopping Recommendation V8 container before ENOSPC\n' \
      "$(date -Iseconds)" >> "$log_path"
    kill -TERM 1
    exit 0
  fi

  sleep "$check_interval_s"
done
