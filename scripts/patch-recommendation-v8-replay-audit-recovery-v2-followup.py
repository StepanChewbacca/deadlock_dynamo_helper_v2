from pathlib import Path

path = Path('apps/api/src/deadlock-live/recommendation-historical-pro-replay.ts')
text = path.read_text()
old = """    timeline: {
      decisionSnapshotJoined,
    },"""
new = """    timeline: {
      decisionSnapshotJoined: decisionTimelineJoined,
    },"""
if new not in text:
    if text.count(old) != 1:
        raise SystemExit(
            f'{path}: expected one decision timeline assignment, found {text.count(old)}'
        )
    path.write_text(text.replace(old, new, 1))
