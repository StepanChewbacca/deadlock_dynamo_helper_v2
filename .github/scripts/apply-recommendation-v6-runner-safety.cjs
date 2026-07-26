const { readFileSync, writeFileSync } = require('node:fs');

const changes = [];

function replaceOnce(name, path, before, after) {
  const content = readFileSync(path, 'utf8');
  const beforeCount = content.split(before).length - 1;
  const afterCount = content.split(after).length - 1;

  if (beforeCount === 0 && afterCount === 1) {
    changes.push({ name, path, status: 'already-applied' });
    return;
  }

  if (beforeCount !== 1) {
    throw new Error(
      `${name}: expected one target in ${path}, found ${beforeCount}; applied target count ${afterCount}`,
    );
  }

  writeFileSync(path, content.replace(before, after), 'utf8');
  changes.push({ name, path, status: 'applied' });
}

const scriptPath = 'scripts/run-recommendation-v6-full-crawler-cycle.mjs';

replaceOnce(
  'import-read-file',
  scriptPath,
  "import { mkdir, rm, stat, writeFile } from 'node:fs/promises';",
  "import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';",
);

replaceOnce(
  'lock-constants',
  scriptPath,
  `const lockPath = '/tmp/recommendation-v6-full-crawler.lock';
const completedPath = '/tmp/recommendation-v6-full-crawler.completed';`,
  `const lockPath = '/tmp/recommendation-v6-full-crawler.lock';
const lockOwnerPath = join(lockPath, 'owner.json');
const completedPath = '/tmp/recommendation-v6-full-crawler.completed';
const lockWaitTimeoutMs = 13 * 60 * 60_000;
const staleLockAgeMs = 13 * 60 * 60_000;`,
);

replaceOnce(
  'lock-acquisition',
  scriptPath,
  `await mkdir(resultDirectory, { recursive: true });

if (await exists(completedPath)) {
  console.log('Recommendation V6 full-crawler cycle already completed; skipping duplicate run.');
  process.exit(0);
}

try {
  await mkdir(lockPath);
} catch (error) {
  if (error && typeof error === 'object' && error.code === 'EEXIST') {
    console.log('Another Recommendation V6 full-crawler cycle is active; skipping duplicate run.');
    process.exit(0);
  }
  throw error;
}`,
  `await mkdir(resultDirectory, { recursive: true });

if (await exists(completedPath)) {
  console.log('Recommendation V6 full-crawler cycle already completed; skipping duplicate run.');
  process.exit(0);
}

const lockAcquired = await acquireCycleLock();
if (!lockAcquired) {
  console.log('The active Recommendation V6 cycle completed while this duplicate run was waiting.');
  process.exit(0);
}`,
);

replaceOnce(
  'restored-state',
  scriptPath,
  `let failure;
let succeeded = false;
try {`,
  `let failure;
let succeeded = false;
let restored = false;
try {`,
);

replaceOnce(
  'defer-completed-marker',
  scriptPath,
  `  succeeded = true;
  await writeFile(completedPath, \`${'${new Date().toISOString()}'}\\n\`, 'utf8');
} catch (error) {`,
  `  succeeded = true;
} catch (error) {`,
);

replaceOnce(
  'track-restore-success',
  scriptPath,
  `  try {
    await restoreProductionApi();
  } catch (restoreError) {`,
  `  try {
    await restoreProductionApi();
    restored = true;
  } catch (restoreError) {`,
);

replaceOnce(
  'completed-marker-after-restore',
  scriptPath,
  `  await rm(lockPath, { recursive: true, force: true });
  if (!succeeded) {
    await rm(completedPath, { force: true });
  }`,
  `  if (succeeded && restored && !failure) {
    await writeFile(completedPath, \`${'${new Date().toISOString()}'}\\n\`, 'utf8');
  } else {
    await rm(completedPath, { force: true });
  }
  await rm(lockPath, { recursive: true, force: true });`,
);

replaceOnce(
  'stale-lock-functions',
  scriptPath,
  `if (failure) {
  throw failure;
}

async function inspectRequiredSources(volumeRoot) {`,
  `if (failure) {
  throw failure;
}

async function acquireCycleLock() {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= lockWaitTimeoutMs) {
    if (await exists(completedPath)) {
      return false;
    }
    try {
      await mkdir(lockPath);
      await writeFile(
        lockOwnerPath,
        \`${'${JSON.stringify({'}
          pid: process.pid,
          runId: process.env.GITHUB_RUN_ID,
          runAttempt: process.env.GITHUB_RUN_ATTEMPT,
          createdAt: new Date().toISOString(),
        }, undefined, 2)}\\n\`,
        'utf8',
      );
      return true;
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        throw error;
      }
    }

    const lock = await inspectCycleLock();
    if (!lock.active) {
      console.log(\`Removing stale Recommendation V6 lock: ${'${lock.reason}'}\`);
      await rm(lockPath, { recursive: true, force: true });
      continue;
    }
    console.log(
      \`Recommendation V6 cycle owned by PID ${'${lock.pid}'} is active; waiting for completion.\`,
    );
    await sleep(30_000);
  }
  throw new Error('Timed out waiting for the active Recommendation V6 cycle lock.');
}

async function inspectCycleLock() {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { active: false, reason: 'lock disappeared' };
    }
    throw error;
  }
  const ageMs = Date.now() - lockStat.mtimeMs;
  if (ageMs > staleLockAgeMs) {
    return {
      active: false,
      reason: \`lock age ${'${Math.round(ageMs / 60_000)}'} minutes\`,
    };
  }
  try {
    const owner = JSON.parse(await readFile(lockOwnerPath, 'utf8'));
    const pid = Number(owner.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return { active: false, reason: 'invalid owner PID' };
    }
    try {
      process.kill(pid, 0);
      return { active: true, pid, reason: 'owner process is alive' };
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ESRCH') {
        return { active: false, pid, reason: 'owner process is not alive' };
      }
      if (error && typeof error === 'object' && error.code === 'EPERM') {
        return {
          active: true,
          pid,
          reason: 'owner process exists without signal permission',
        };
      }
      throw error;
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { active: false, reason: 'owner metadata is missing' };
    }
    if (error instanceof SyntaxError) {
      return { active: false, reason: 'owner metadata is invalid JSON' };
    }
    throw error;
  }
}

async function inspectRequiredSources(volumeRoot) {`,
);

console.log(JSON.stringify({ changes }, undefined, 2));
