#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value)


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    if new in value and old not in value:
        return
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    write(path, value.replace(old, new, 1))


SERVICE = 'apps/api/src/deadlock-live/recommendation-behavioral-v5-training.service.ts'
replace_once(SERVICE, "  open,\n", "")
replace_once(SERVICE, "import type { FileHandle } from 'node:fs/promises';\n", "")
replace_once(
    SERVICE,
    "import { openMaybeGzipNdjsonReadStream } from './gzip-ndjson';\n",
    "import {\n  GzipNdjsonWriter,\n  openMaybeGzipNdjsonReadStream,\n} from './gzip-ndjson';\n",
)
replace_once(
    SERVICE,
    "      const propensityWriter = await LineWriter.create(\n        `${this.paths.propensities}.partial`,\n      );\n",
    "      let propensityUncompressedByteLength = 0;\n      const propensityWriter = await GzipNdjsonWriter.create(\n        `${this.paths.propensities}.partial`,\n      );\n",
)
replace_once(
    SERVICE,
    "        await propensityWriter.close();\n      } catch (error) {\n",
    "        await propensityWriter.close();\n        propensityUncompressedByteLength =\n          propensityWriter.uncompressedByteLength;\n      } catch (error) {\n",
)
replace_once(
    SERVICE,
    "          fileName: PROPENSITY_FILE_NAME,\n          rowCount: predictionRowCount,\n          sha256: await hashFile(this.paths.propensities),\n",
    "          fileName: PROPENSITY_FILE_NAME,\n          format: 'NDJSON',\n          compression: 'GZIP',\n          rowCount: predictionRowCount,\n          byteLength: (await stat(this.paths.propensities)).size,\n          uncompressedByteLength: propensityUncompressedByteLength,\n          sha256: await hashFile(this.paths.propensities),\n",
)
replace_once(
    SERVICE,
    "            fileName: PROPENSITY_FILE_NAME,\n            sha256: audit.predictions.sha256,\n            byteLength: (await stat(this.paths.propensities)).size,\n            rowCount: predictionRowCount,\n",
    "            fileName: PROPENSITY_FILE_NAME,\n            format: 'NDJSON',\n            compression: 'GZIP',\n            sha256: audit.predictions.sha256,\n            byteLength: (await stat(this.paths.propensities)).size,\n            uncompressedByteLength: propensityUncompressedByteLength,\n            rowCount: predictionRowCount,\n",
)
value = read(SERVICE)
pattern = re.compile(r"\nclass LineWriter \{.*?\n\}\n\nfunction optionalSha", re.S)
if pattern.search(value):
    value, count = pattern.subn("\nfunction optionalSha", value, count=1)
    if count != 1:
        raise RuntimeError('Unable to remove Behavioral V5 LineWriter')
    write(SERVICE, value)
elif 'class LineWriter {' in value:
    raise RuntimeError('Behavioral V5 LineWriter has an unexpected shape')

TEST = 'apps/api/test/recommendation-behavioral-v5-training.spec.ts'
replace_once(
    TEST,
    "import { createHash } from 'node:crypto';\n",
    "import { createHash } from 'node:crypto';\nimport { gunzipSync } from 'node:zlib';\n",
)
replace_once(
    TEST,
    "    const propensities = (await readFile(\n      join(outputDirectory, 'propensities.ndjson'),\n      'utf8',\n    ))\n      .trim()\n",
    "    const propensities = gunzipSync(\n      await readFile(join(outputDirectory, 'propensities.ndjson')),\n    )\n      .toString('utf8')\n      .trim()\n",
)

print('Recommendation Behavioral V5 gzip patch applied.')
