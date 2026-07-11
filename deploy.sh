#!/bin/bash
set -e

# Always sync from the project root regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Syncing files to my-vps... ==="
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'storage' \
  --exclude '*.hprof' \
  --exclude 'apps/overwolf-client/dist' \
  "$SCRIPT_DIR/" my-vps:~/deadlock/

echo "=== Triggering Docker Compose build & start on my-vps... ==="
ssh my-vps "cd ~/deadlock && docker compose up --build -d"

echo "=== Deploy finished successfully! ==="
