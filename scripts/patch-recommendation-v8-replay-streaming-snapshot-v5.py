from pathlib import Path

path = Path('apps/api/src/deadlock-live/recommendation-historical-pro-replay-artifact.service.ts')
text = path.read_text()

old = '''    const artifactRaw = await readFile(path, 'utf8');
    const artifactSha256 = createHash('sha256')
      .update(artifactRaw)
      .digest('hex');
    if (artifactSha256 !== requiredSha(entry.artifactSha256, 'artifactSha256')) {
      throw new Error(
        `Candidate generator artifact ${entry.fileName} SHA-256 mismatch.`,
      );
    }
    const artifact = JSON.parse(
      artifactRaw,
    ) as RecommendationCandidateGeneratorSnapshotArtifact;
'''
new = '''    const artifactSha256 = await hashFile(path);
    if (artifactSha256 !== requiredSha(entry.artifactSha256, 'artifactSha256')) {
      throw new Error(
        `Candidate generator artifact ${entry.fileName} SHA-256 mismatch.`,
      );
    }
    const artifact = await readLargeSnapshotArtifact(path);
'''
if text.count(old) != 1:
    raise SystemExit(f'Expected one snapshot loader replacement, found {text.count(old)}')
text = text.replace(old, new, 1)

anchor = '''async function partitionSource(input: {
'''
helper = r'''async function readLargeSnapshotArtifact(
  path: string,
): Promise<RecommendationCandidateGeneratorSnapshotArtifact> {
  const properties: Record<string, unknown> = {};
  const policies: unknown[] = [];
  let mode: 'KEY' | 'COLON' | 'VALUE' | 'POLICIES' | 'DONE' = 'KEY';
  let key = '';
  let token = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let topLevelStarted = false;
  let policiesArrayStarted = false;

  const finishValue = (): void => {
    if (!key || !token.trim()) {
      return;
    }
    properties[key] = JSON.parse(token) as unknown;
    key = '';
    token = '';
    depth = 0;
    inString = false;
    escaped = false;
    mode = 'KEY';
  };

  const finishPolicy = (): void => {
    if (!token.trim()) {
      return;
    }
    policies.push(JSON.parse(token) as unknown);
    token = '';
    depth = 0;
    inString = false;
    escaped = false;
  };

  for await (const chunk of createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: 1024 * 1024,
  })) {
    for (const character of chunk as string) {
      if (mode === 'DONE') {
        continue;
      }
      if (!topLevelStarted) {
        if (character === '{') {
          topLevelStarted = true;
        }
        continue;
      }
      if (mode === 'KEY') {
        if (/\s|,/.test(character)) {
          continue;
        }
        if (character === '}') {
          mode = 'DONE';
          continue;
        }
        if (character !== '"') {
          throw new Error(`Invalid snapshot JSON key in ${path}.`);
        }
        token = '"';
        mode = 'COLON';
        inString = true;
        continue;
      }
      if (mode === 'COLON') {
        if (inString) {
          token += character;
          if (escaped) {
            escaped = false;
          } else if (character === '\\') {
            escaped = true;
          } else if (character === '"') {
            inString = false;
            key = JSON.parse(token) as string;
            token = '';
          }
          continue;
        }
        if (/\s/.test(character)) {
          continue;
        }
        if (character !== ':') {
          throw new Error(`Invalid snapshot JSON separator in ${path}.`);
        }
        mode = key === 'policies' ? 'POLICIES' : 'VALUE';
        continue;
      }
      if (mode === 'POLICIES') {
        if (!policiesArrayStarted) {
          if (/\s/.test(character)) {
            continue;
          }
          if (character !== '[') {
            throw new Error(`Snapshot policies must be an array in ${path}.`);
          }
          policiesArrayStarted = true;
          continue;
        }
        if (!token && /\s|,/.test(character)) {
          continue;
        }
        if (!token && character === ']') {
          properties.policies = policies;
          key = '';
          policiesArrayStarted = false;
          mode = 'KEY';
          continue;
        }
        token += character;
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === '\\') {
            escaped = true;
          } else if (character === '"') {
            inString = false;
          }
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === '{' || character === '[') {
          depth += 1;
        } else if (character === '}' || character === ']') {
          depth -= 1;
        }
        if (depth === 0 && character === '}') {
          finishPolicy();
        }
        continue;
      }
      if (mode === 'VALUE') {
        if (!token && /\s/.test(character)) {
          continue;
        }
        if (!token && (character === ',' || character === '}')) {
          throw new Error(`Snapshot property ${key} has no value in ${path}.`);
        }
        token += character;
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === '\\') {
            escaped = true;
          } else if (character === '"') {
            inString = false;
          }
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === '{' || character === '[') {
          depth += 1;
          continue;
        }
        if (character === '}' || character === ']') {
          if (depth > 0) {
            depth -= 1;
            continue;
          }
        }
        if (depth === 0 && character === ',') {
          token = token.slice(0, -1);
          finishValue();
        } else if (depth === 0 && character === '}') {
          token = token.slice(0, -1);
          finishValue();
          mode = 'DONE';
        }
      }
    }
  }

  if (mode !== 'DONE') {
    throw new Error(`Snapshot JSON ended unexpectedly in ${path}.`);
  }
  return properties as unknown as RecommendationCandidateGeneratorSnapshotArtifact;
}

'''
if text.count(anchor) != 1:
    raise SystemExit(f'Expected one helper anchor, found {text.count(anchor)}')
text = text.replace(anchor, helper + anchor, 1)
path.write_text(text)
