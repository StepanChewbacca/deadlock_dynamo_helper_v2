from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label} occurrence, found {count}")
    return content.replace(old, new, 1)


service_path = Path(
    "apps/api/src/deadlock-live/"
    "recommendation-decision-dataset-v4-historical-bootstrap.service.ts"
)
service = service_path.read_text()
service = replace_once(
    service,
    "    if (!trainingManifest.auditPassed || !trainingAudit.passed) {\n",
    "    if (!trainingAudit.passed) {\n",
    "training audit validation",
)
service_path.write_text(service)

spec_path = Path(
    "apps/api/test/"
    "recommendation-decision-dataset-v4-historical-bootstrap.spec.ts"
)
spec = spec_path.read_text()
spec = replace_once(
    spec,
    "    writeJson(join(trainingDirectory, 'manifest.json'), {\n"
    "      auditPassed: true,\n"
    "      artifacts: {\n",
    "    writeJson(join(trainingDirectory, 'manifest.json'), {\n"
    "      artifacts: {\n",
    "real training manifest fixture",
)
spec_path.write_text(spec)
