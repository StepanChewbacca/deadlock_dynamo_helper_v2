#!/usr/bin/env python3
from pathlib import Path

source = Path('.github/workflows/deploy.yml').read_text(encoding='utf-8')


def remove_block(text: str, start_marker: str, end_marker: str) -> str:
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[:start] + text[end:]

source = remove_block(
    source,
    '      - name: Verify Contextual V3 production state locally\n',
    '      - name: Verify Recommendation Value V6 global canary locally\n',
)
source = remove_block(
    source,
    '      - name: Verify HTTPS reverse proxy locally\n',
    '      - name: Verify Recommendation Value V6 through local HTTPS\n',
)
source = remove_block(
    source,
    '      - name: Verify public API route\n',
    '      - name: Verify Recommendation Value V6 public route\n',
)
source = source.replace(
    '      - name: Verify Recommendation Value V6 global canary locally\n',
    '      - name: Verify exclusive Recommendation Value V6 locally\n',
)
source = source.replace(
    '      - name: Verify Recommendation Value V6 through local HTTPS\n',
    '      - name: Verify exclusive Recommendation Value V6 through local HTTPS\n',
)
source = source.replace(
    '      - name: Verify Recommendation Value V6 public route\n',
    '      - name: Verify exclusive Recommendation Value V6 public route\n',
)
local_status_command = "          sudo docker compose exec -T api node -e \"const expectedSha = '799803f4882ca2ece436ab1087c41641713377f8a33f9bab0f0f4636a381938e'; fetch('http://127.0.0.1:3000/deadlock/analysis/recommendation-value-v6-live/status').then(async (response) => { const status = await response.json(); console.log(JSON.stringify(status)); if (!response.ok || status.mode !== 'CANARY' || status.rolloutScope !== 'ALL_USERS' || status.allowlistCount !== 0 || status.model?.state !== 'READY' || status.model?.modelSha256 !== expectedSha) process.exit(1); }).catch((error) => { console.error(error); process.exit(1); });\"\n"
status_probe = "          sudo docker compose exec -T api node -e \"fetch('http://127.0.0.1:3000/deadlock/live/build-recommendations/status').then(async (response) => { const status = await response.json(); console.log(JSON.stringify(status)); if (!response.ok || typeof status.trackedMatchCount !== 'number') process.exit(1); }).catch((error) => { console.error(error); process.exit(1); });\"\n"
if status_probe not in source:
    if local_status_command not in source:
        raise RuntimeError('local V6 status command was not found')
    source = source.replace(local_status_command, local_status_command + status_probe, 1)

Path('deploy-v6-exclusive.yml').write_text(source, encoding='utf-8')
