from pathlib import Path

path = Path('apps/api/src/deadlock-live/hero-build-contextual-v3-final-test.service.ts')
source = path.read_text()
source = source.replace(
    "      datasetAvailable: await fileExists(this.paths.dataset),\n",
    "      datasetAvailable: this.status.datasetAvailable,\n",
)
source = source.replace(
    "          decisionCount > 0 &&\n          duplicateDecisionCount === 0 &&\n",
    "          decisionCount > 0 &&\n          matchesWithRows.size === descriptors.length &&\n          duplicateDecisionCount === 0 &&\n",
)
start = source.find("async function fileExists(path: string): Promise<boolean> {")
if start == -1:
    raise RuntimeError('fileExists helper was not found')
end = source.find("\nfunction average(", start)
if end == -1:
    raise RuntimeError('fileExists helper end was not found')
source = source[:start] + source[end + 1:]
path.write_text(source)
