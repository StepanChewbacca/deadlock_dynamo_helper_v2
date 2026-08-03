from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old!r}")
    target.write_text(text.replace(old, new, 1))


DATASET = "apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6.ts"
replace_once(
    DATASET,
    "  terminalOutcomeApplied: boolean;",
    "  terminalOutcomeApplied?: boolean;",
)
replace_once(
    DATASET,
    "      row.state.timelineJoined || row.terminalOutcomeApplied ? 1 : 0;",
    "      row.state.timelineJoined || row.terminalOutcomeApplied === true ? 1 : 0;",
)

DATASET_STREAMING = "apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6-streaming-audit.ts"
replace_once(
    DATASET_STREAMING,
    "      row.state.timelineJoined || row.terminalOutcomeApplied ? 1 : 0;",
    "      row.state.timelineJoined || row.terminalOutcomeApplied === true ? 1 : 0;",
)

print("Applied Recommendation V8 terminal outcome compatibility follow-up.")
