from pathlib import Path

PATH = Path('apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts')
text = PATH.read_text()

old_paths = """interface BuildPaths {
  dataset: string;
  manifest: string;
  audit: string;
  work: string;
  checkpoint: string;
  sourceParts: string;
  outputParts: string;
  partStats: string;
  snapshotCache: string;
}

interface BuildCheckpoint {
"""
new_paths = """interface BuildPaths {
  dataset: string;
  manifest: string;
  audit: string;
  work: string;
  checkpoint: string;
  finalizationCheckpoint: string;
  sourceParts: string;
  outputParts: string;
  partStats: string;
  snapshotCache: string;
}

interface BuildCheckpoint {
"""
if old_paths not in text:
    raise SystemExit('BuildPaths anchor is unavailable.')
text = text.replace(old_paths, new_paths, 1)

old_checkpoint = """interface BuildCheckpoint {
  sourceSha256: string;
  snapshotRegistrySha256: string;
  optionsHash: string;
  partitioningComplete: boolean;
  scannedRowCount: number;
  completedPartitions: number[];
  updatedAt: string;
}

interface SourceArtifact {
"""
new_checkpoint = """interface BuildCheckpoint {
  sourceSha256: string;
  snapshotRegistrySha256: string;
  optionsHash: string;
  partitioningComplete: boolean;
  scannedRowCount: number;
  completedPartitions: number[];
  updatedAt: string;
}

interface FinalizationCheckpoint {
  completedPartitions: number[];
  byteLength: number;
  updatedAt: string;
}

interface SourceArtifact {
"""
if old_checkpoint not in text:
    raise SystemExit('BuildCheckpoint anchor is unavailable.')
text = text.replace(old_checkpoint, new_checkpoint, 1)

old_combine = """async function combineParts(
  paths: BuildPaths,
  partitionCount: number,
): Promise<void> {
  const partial = `${paths.dataset}.partial`;
  await rm(partial, { force: true });
  const output = await open(partial, 'w');
  try {
    for (let index = 0; index < partitionCount; index += 1) {
      const path = outputPartPath(paths, index);
      if (!(await exists(path))) {
        continue;
      }
      for await (const chunk of createReadStream(path)) {
        await writeAll(output, chunk as Buffer);
      }
    }
  } finally {
    await output.close();
  }
  await rm(paths.dataset, { force: true });
  await rename(partial, paths.dataset);
}
"""
new_combine = """async function combineParts(
  paths: BuildPaths,
  partitionCount: number,
): Promise<void> {
  const partial = `${paths.dataset}.partial`;
  let checkpoint = await readJson<FinalizationCheckpoint>(
    paths.finalizationCheckpoint,
  );
  if (!checkpoint) {
    await rm(partial, { force: true });
    checkpoint = {
      completedPartitions: [],
      byteLength: 0,
      updatedAt: new Date().toISOString(),
    };
    await atomicJson(paths.finalizationCheckpoint, checkpoint);
  } else {
    validateFinalizationCheckpoint(checkpoint, partitionCount);
  }

  const partialSize = (await exists(partial)) ? (await stat(partial)).size : 0;
  if (partialSize < checkpoint.byteLength) {
    throw new Error(
      `Replay finalization partial is shorter than its checkpoint: ` +
        `${partialSize} versus ${checkpoint.byteLength}.`,
    );
  }

  const output = await open(partial, 'a+');
  try {
    await output.truncate(checkpoint.byteLength);
    const complete = new Set(checkpoint.completedPartitions);
    for (let index = 0; index < partitionCount; index += 1) {
      const path = outputPartPath(paths, index);
      if (complete.has(index)) {
        await rm(path, { force: true });
        continue;
      }
      if (!(await exists(path))) {
        throw new Error(`Replay output partition ${index} is unavailable.`);
      }
      for await (const chunk of createReadStream(path)) {
        await writeAll(output, chunk as Buffer);
      }
      await output.sync();
      checkpoint.byteLength = (await output.stat()).size;
      checkpoint.completedPartitions.push(index);
      checkpoint.completedPartitions.sort((left, right) => left - right);
      checkpoint.updatedAt = new Date().toISOString();
      await atomicJson(paths.finalizationCheckpoint, checkpoint);
      complete.add(index);
      await rm(path, { force: true });
    }
  } finally {
    await output.close();
  }
  await rm(paths.dataset, { force: true });
  await rename(partial, paths.dataset);
  await rm(paths.finalizationCheckpoint, { force: true });
}

function validateFinalizationCheckpoint(
  checkpoint: FinalizationCheckpoint,
  partitionCount: number,
): void {
  if (
    !Array.isArray(checkpoint.completedPartitions) ||
    !Number.isSafeInteger(checkpoint.byteLength) ||
    checkpoint.byteLength < 0
  ) {
    throw new Error('Replay finalization checkpoint is invalid.');
  }
  const unique = new Set<number>();
  for (const index of checkpoint.completedPartitions) {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= partitionCount ||
      unique.has(index)
    ) {
      throw new Error('Replay finalization checkpoint partitions are invalid.');
    }
    unique.add(index);
  }
}
"""
if old_combine not in text:
    raise SystemExit('combineParts anchor is unavailable.')
text = text.replace(old_combine, new_combine, 1)

old_create = """    work,
    checkpoint: join(work, 'checkpoint.json'),
    sourceParts: join(work, 'source-parts'),
"""
new_create = """    work,
    checkpoint: join(work, 'checkpoint.json'),
    finalizationCheckpoint: join(work, 'finalization-checkpoint.json'),
    sourceParts: join(work, 'source-parts'),
"""
if old_create not in text:
    raise SystemExit('createPaths anchor is unavailable.')
text = text.replace(old_create, new_create, 1)

PATH.write_text(text)
