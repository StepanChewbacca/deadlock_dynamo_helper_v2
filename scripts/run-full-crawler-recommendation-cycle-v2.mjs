import { execFileSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const implementationCommit = '5f7c49cc18ad2233fc2c0bc2c0dc32b8f957cc55';
const implementationPath = '/tmp/run-full-crawler-recommendation-cycle-v2-impl.mjs';
const lockPath = '/tmp/full-crawler-recommendation-cycle-v2.lock';
const completedPath = '/tmp/full-crawler-recommendation-cycle-v2.completed';

if (await exists(completedPath)) {
  console.log('The corrected full crawler cycle already completed successfully; skipping duplicate run.');
  process.exit(0);
}

try {
  await mkdir(lockPath);
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'EEXIST') {
    console.log('Another corrected full crawler cycle is already active; skipping duplicate run.');
    process.exit(0);
  }
  throw error;
}

let succeeded = false;
try {
  execFileSync('git', ['fetch', '--depth=1', 'origin', implementationCommit], {
    stdio: 'inherit',
  });
  const implementation = execFileSync(
    'git',
    ['show', `${implementationCommit}:scripts/run-full-crawler-recommendation-cycle-v2.mjs`],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  await writeFile(implementationPath, implementation, 'utf8');
  await import(`${pathToFileURL(implementationPath).href}?run=${Date.now()}`);
  succeeded = true;
  await writeFile(completedPath, `${new Date().toISOString()}\n`, 'utf8');
} finally {
  await rm(implementationPath, { force: true });
  await rm(lockPath, { recursive: true, force: true });
  if (!succeeded) {
    await rm(completedPath, { force: true });
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
