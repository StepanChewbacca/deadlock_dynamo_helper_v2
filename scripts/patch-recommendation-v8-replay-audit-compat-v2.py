from pathlib import Path

path = Path('apps/api/src/deadlock-live/recommendation-historical-pro-replay.ts')
text = path.read_text()

old_interface = """  timeline: {
    decisionSnapshotJoined: boolean;
  };"""
new_interface = """  timeline?: {
    decisionSnapshotJoined: boolean;
  };"""
if new_interface not in text:
    if text.count(old_interface) != 1:
        raise SystemExit(
            f'{path}: expected one timeline interface anchor, found {text.count(old_interface)}'
        )
    text = text.replace(old_interface, new_interface, 1)

old_audit = """    timelineRowCount += row.timeline.decisionSnapshotJoined ? 1 : 0;"""
new_audit = """    timelineRowCount +=
      row.timeline?.decisionSnapshotJoined ??
      row.shortHorizonOutcomes.some((outcome) => outcome.complete)
        ? 1
        : 0;"""
if new_audit not in text:
    if text.count(old_audit) != 1:
        raise SystemExit(
            f'{path}: expected one timeline audit anchor, found {text.count(old_audit)}'
        )
    text = text.replace(old_audit, new_audit, 1)

path.write_text(text)
