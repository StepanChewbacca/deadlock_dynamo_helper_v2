from pathlib import Path
import re
import sys


def main() -> None:
    path = Path(sys.argv[1])
    deployed_commit = sys.argv[2]
    if not re.fullmatch(r'[a-f0-9]{40}', deployed_commit):
        raise ValueError('deployed commit must be a 40-character hexadecimal SHA')

    source = path.read_text()
    source = re.sub(
        r"const expectedCommit = '[a-f0-9]{40}';",
        f"const expectedCommit = '{deployed_commit}';",
        source,
        count=1,
    )

    if 'API configuration was reset while the stage was running' not in source:
        start_marker = 'async function runStage({ name, endpoint, body, timeoutMs }) {'
        end_marker = '\nasync function readArtifact'
        start = source.index(start_marker)
        end = source.index(end_marker, start)
        replacement = r'''async function runStage({ name, endpoint, body, timeoutMs }) {
  await writeState({ state: 'RUNNING', stage: name });
  const expectedOutputDirectory = {
    '02-contextual-training': directories.contextualTraining,
    '03-contextual-candidates': directories.contextualCandidates,
    '04-bootstrap': directories.bootstrap,
    '05-behavioral-v4': directories.behavioral,
    '06-value-v4': directories.valueV4,
    '07-value-v5': directories.valueV5,
    '08-policy-v4': directories.policyV4,
  }[name];

  let status = await requestJson('GET', endpoint + '/status');
  await saveJson(`${name}-00-before-status.json`, status);
  if (status.state === 'COMPLETE') {
    await saveJson(`${name}-02-status.json`, status);
    return status;
  }
  if (
    expectedOutputDirectory &&
    typeof status.outputDirectory === 'string' &&
    status.outputDirectory !== expectedOutputDirectory
  ) {
    throw new Error(
      `${name} API configuration was reset: expected ${expectedOutputDirectory}, received ${status.outputDirectory}.`,
    );
  }
  if (status.state !== 'RUNNING') {
    status = await requestJson('POST', endpoint + '/start', body);
    await saveJson(`${name}-01-start-response.json`, status);
  }

  const startedAt = Date.now();
  let lastProgressLogAt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    status = await requestJson('GET', endpoint + '/status');
    await saveJson(`${name}-02-status.json`, status);
    if (status.state === 'COMPLETE') {
      await writeState({ state: 'RUNNING', stage: `${name}:COMPLETE`, status });
      return status;
    }
    if (status.state === 'FAILED') {
      throw new Error(`${name} failed: ${String(status.error ?? 'unknown error')}`);
    }
    if (
      status.state === 'IDLE' ||
      (expectedOutputDirectory &&
        typeof status.outputDirectory === 'string' &&
        status.outputDirectory !== expectedOutputDirectory)
    ) {
      throw new Error(
        `${name} API configuration was reset while the stage was running.`,
      );
    }
    if (Date.now() - lastProgressLogAt >= 60_000) {
      console.log(`[${name}] ${JSON.stringify(status)}`);
      await writeState({ state: 'RUNNING', stage: name, status });
      lastProgressLogAt = Date.now();
    }
    await sleep(15_000);
  }
  throw new Error(
    `${name} exceeded its ${Math.round(timeoutMs / 60_000)} minute timeout.`,
  );
}
'''
        source = source[:start] + replacement + source[end:]

    path.write_text(source)


if __name__ == '__main__':
    main()
