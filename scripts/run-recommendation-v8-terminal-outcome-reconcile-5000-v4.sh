#!/usr/bin/env bash
set -euo pipefail

branch='agent/recommendation-value-v8-passive-shadow-1'
container='deadlock-recommendation-v8-training'
run_root='/home/ubuntu/apps/deadlock_dynamo_helper-training-5000'
replay_output='/app/apps/api/storage/recommendation-historical-pro-replay-terminal-5000-v2'
rebuild_script='scripts/run-recommendation-v8-terminal-outcome-rebuild-5000-v2.sh'
result='.github/training-results/recommendation-v8-terminal-outcome-rebuild-5000-v2.json'

patch_publish_result() {
  python3 - "$rebuild_script" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = """  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git fetch origin \"$branch\"
  git pull --rebase origin \"$branch\"
  git add \"$result\"
  git commit -m 'chore: publish isolated terminal outcome 5000-match restart'
  git push origin \"$branch\"
  echo \"TRAINING_RUN_DIR=$run_dir\" >> \"$GITHUB_ENV\"
"""
new = """  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git add \"$result\" scripts/run-recommendation-v8-terminal-outcome-rebuild-5000-v2.sh
  if ! git diff --cached --quiet; then
    git commit -m 'chore: publish isolated terminal outcome 5000-match restart'
  fi
  git fetch origin \"$branch\"
  git rebase \"origin/$branch\"
  git push origin \"HEAD:$branch\"
  echo \"TRAINING_RUN_DIR=$run_dir\" >> \"$GITHUB_ENV\"
"""
if new in text:
    raise SystemExit(0)
if old not in text:
    raise SystemExit('Expected publish_result block was not found.')
path.write_text(text.replace(old, new, 1))
PY
  bash -n "$rebuild_script"
}

active_training=false
if sudo docker ps --format '{{.Names}}' | grep -Fxq "$container"; then
  if sudo docker exec "$container" sh -lc "pgrep -f '[r]un-recommendation-v8-diagnostic-only-pipeline.mjs' >/dev/null"; then
    active_training=true
  fi
fi

patch_publish_result

if [ "$active_training" != 'true' ]; then
  exec bash scripts/run-recommendation-v8-terminal-outcome-cleanup-restart-5000-v3.sh
fi

image="$(sudo docker inspect --format='{{.Config.Image}}' "$container")"
case "$image" in
  *-terminal-outcomes-5000-v2) ;;
  *)
    echo "Unexpected active training image: $image" >&2
    exit 1
    ;;
esac

status="$(curl --fail --silent --show-error --max-time 30 \
  http://127.0.0.1:3010/deadlock/analysis/recommendation-historical-pro-replay/status)"
state="$(jq -r '.state // empty' <<<"$status")"
phase="$(jq -r '.phase // empty' <<<"$status")"
output_directory="$(jq -r '.outputDirectory // empty' <<<"$status")"

if [ "$output_directory" != "$replay_output" ]; then
  echo "Unexpected replay output directory: $output_directory" >&2
  exit 1
fi
case "$state" in
  RUNNING|COMPLETE) ;;
  *)
    echo "Active pipeline has invalid replay state: $state/$phase" >&2
    exit 1
    ;;
esac

run_dir="$(readlink -f "$run_root/current")"
test -n "$run_dir"
test -s "$run_dir/run.json"
printf '%s\n' "$status" > "$run_dir/replay-status.json"
sudo docker stats --no-stream "$container" > "$run_dir/docker-stats.txt"

python3 - "$run_dir/run.json" "$state" "$phase" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path(sys.argv[1])
state = sys.argv[2]
phase = sys.argv[3]
value = json.loads(path.read_text())
value['state'] = state
value['stage'] = 'HISTORICAL_REPLAY' if state == 'RUNNING' else phase
value['statusPublishedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
path.write_text(json.dumps(value, indent=2) + '\n')
PY

mkdir -p "$(dirname "$result")"
implementation_sha="$(jq -r '.implementationSha' "$run_dir/run.json")"
run_id="$(jq -r '.runId' "$run_dir/run.json")"
jq -n \
  --arg generatedAt "$(date --iso-8601=seconds)" \
  --arg workflowRunId "$GITHUB_RUN_ID" \
  --arg implementationSha "$implementation_sha" \
  --arg image "$image" \
  --arg runId "$run_id" \
  --arg reconciliationMode 'ACTIVE_RUN_VERIFIED_NO_RESTART' \
  --slurpfile run "$run_dir/run.json" \
  --slurpfile replayStatus "$run_dir/replay-status.json" \
  '{
    generatedAt: $generatedAt,
    workflowRunId: $workflowRunId,
    implementationSha: $implementationSha,
    image: $image,
    runId: $runId,
    reconciliationMode: $reconciliationMode,
    run: $run[0],
    replayStatus: $replayStatus[0]
  }' > "$result"

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add "$rebuild_script" "$result"
if ! git diff --cached --quiet; then
  git commit -m 'fix: publish active terminal outcome training evidence'
fi
git fetch origin "$branch"
git rebase "origin/$branch"
git push origin "HEAD:$branch"

printf 'Verified active training: state=%s phase=%s image=%s runDir=%s\n' \
  "$state" "$phase" "$image" "$run_dir"
