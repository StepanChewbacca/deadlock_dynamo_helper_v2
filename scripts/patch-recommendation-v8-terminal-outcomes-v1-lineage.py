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


ARTIFACT = "apps/api/src/deadlock-live/recommendation-pro-decision-dataset-v6-artifact.service.ts"
replace_once(
    ARTIFACT,
    """    finalOutcomeAuxiliary: true;\n    shortHorizonTargets: ['3m', '5m', '10m'];""",
    """    finalOutcomeAuxiliary: false;\n    terminalOutcomeBackfill: true;\n    shortHorizonTargets: ['3m', '5m', '10m'];""",
)
replace_once(
    ARTIFACT,
    """          finalOutcomeAuxiliary: true,\n          shortHorizonTargets: ['3m', '5m', '10m'],""",
    """          finalOutcomeAuxiliary: false,\n          terminalOutcomeBackfill: true,\n          shortHorizonTargets: ['3m', '5m', '10m'],""",
)

print("Applied Recommendation V8 terminal outcome lineage patch.")
