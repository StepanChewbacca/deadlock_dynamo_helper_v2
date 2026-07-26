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

const valuePath =
  'apps/api/src/deadlock-live/recommendation-value-v6-training.service.ts';
const policyPath =
  'apps/api/src/deadlock-live/recommendation-policy-v6-evaluation.service.ts';
const valueTestPath =
  'apps/api/test/recommendation-value-v6-training.spec.ts';
const policyTestPath =
  'apps/api/test/recommendation-policy-v6-evaluation-integration.spec.ts';

replaceOnce(
  'value-source-artifacts-lineage',
  valuePath,
  `interface SourceArtifacts {
  manifest: Record<string, unknown>;
  audit: Record<string, unknown>;
  sha256: string;
  rowCount: number;
}`,
  `interface SourceArtifacts {
  manifest: Record<string, unknown>;
  audit: Record<string, unknown>;
  sha256: string;
  upstreamDatasetV4Sha256: string;
  rowCount: number;
}`,
);

replaceOnce(
  'value-audit-lineage',
  valuePath,
  `        source: {
          datasetVersion: source.manifest.datasetVersion,
          expectedSha256: options.expectedSourceSha256,`,
  `        source: {
          datasetVersion: source.manifest.datasetVersion,
          upstreamDatasetV4Sha256: source.upstreamDatasetV4Sha256,
          expectedSha256: options.expectedSourceSha256,`,
);

replaceOnce(
  'value-manifest-lineage',
  valuePath,
  `        source: {
          datasetVersion: source.manifest.datasetVersion,
          artifactSha256: source.sha256,
          sourceRowCount: sourceSummary.sourceRowCount,`,
  `        source: {
          datasetVersion: source.manifest.datasetVersion,
          artifactSha256: source.sha256,
          upstreamDatasetV4Sha256: source.upstreamDatasetV4Sha256,
          sourceRowCount: sourceSummary.sourceRowCount,`,
);

replaceOnce(
  'value-load-upstream-lineage',
  valuePath,
  `    const audit = await requiredJson(this.sourceAuditPath);
    if (manifest.datasetVersion !== RECOMMENDATION_DECISION_DATASET_V5_VERSION) {
      throw new Error('Recommendation Value V6 requires Dataset V5.2.');
    }
    if (audit.passed !== true) {
      throw new Error('Recommendation Dataset V5.2 did not pass its audit.');
    }
    const artifact = record(manifest.artifact);`,
  `    const audit = await requiredJson(this.sourceAuditPath);
    if (manifest.datasetVersion !== RECOMMENDATION_DECISION_DATASET_V5_VERSION) {
      throw new Error('Recommendation Value V6 requires Dataset V5.3.');
    }
    if (audit.passed !== true) {
      throw new Error('Recommendation Dataset V5.3 did not pass its audit.');
    }
    const upstreamDatasetV4Sha256 = requiredSha(
      record(manifest.source).sha256,
    );
    const artifact = record(manifest.artifact);`,
);

replaceOnce(
  'value-hash-error-version',
  valuePath,
  '`Recommendation Dataset V5.2 artifact hash mismatch: ${actualSha256} versus ${expectedSha256}.`',
  '`Recommendation Dataset V5.3 artifact hash mismatch: ${actualSha256} versus ${expectedSha256}.`',
);

replaceOnce(
  'value-source-return-lineage',
  valuePath,
  `      manifest,
      audit,
      sha256: actualSha256,
      rowCount: numeric(artifact.rowCount),`,
  `      manifest,
      audit,
      sha256: actualSha256,
      upstreamDatasetV4Sha256,
      rowCount: numeric(artifact.rowCount),`,
);

replaceOnce(
  'value-row-count-version',
  valuePath,
  "    throw new Error('Recommendation Dataset V5.2 row count does not match manifest.');",
  "    throw new Error('Recommendation Dataset V5.3 row count does not match manifest.');",
);

replaceOnce(
  'policy-source-bundle-lineage',
  policyPath,
  `  hashes: {
    behavioralValidation: string;
    behavioralModel: string;
    valuePrediction: string;
    valueModel: string;
  };
}`,
  `  hashes: {
    behavioralValidation: string;
    behavioralModel: string;
    valuePrediction: string;
    valueModel: string;
  };
  lineage: {
    behavioralDatasetV4Sha256: string;
    valueDatasetV4Sha256: string;
  };
}`,
);

replaceOnce(
  'policy-audit-lineage',
  policyPath,
  `          valueDatasetVersion: readNestedString(
            sources.valueManifest,
            ['source', 'datasetVersion'],
          ),
          hashes: sources.hashes,`,
  `          valueDatasetVersion: readNestedString(
            sources.valueManifest,
            ['source', 'datasetVersion'],
          ),
          lineage: sources.lineage,
          hashes: sources.hashes,`,
);

replaceOnce(
  'policy-load-lineage-check',
  policyPath,
  `    ) {
      throw new Error('Recommendation Policy V6 requires Dataset V5.3 lineage.');
    }
    const behavioralModel = parseBehavioralModel(behavioralModelValue);`,
  `    ) {
      throw new Error('Recommendation Policy V6 requires Dataset V5.3 lineage.');
    }
    const behavioralDatasetV4Sha256 = requiredSha(
      readNestedString(behavioralManifest, [
        'source',
        'artifactSha256',
      ]),
      'Behavioral V4 source Dataset V4 SHA-256',
    );
    const valueDatasetV4Sha256 = requiredSha(
      readNestedString(valueManifest, [
        'source',
        'upstreamDatasetV4Sha256',
      ]),
      'Value V6 upstream Dataset V4 SHA-256',
    );
    if (behavioralDatasetV4Sha256 !== valueDatasetV4Sha256) {
      throw new Error(
        'Behavioral V4 and Value V6 do not share the same Dataset V4 lineage.',
      );
    }
    const behavioralModel = parseBehavioralModel(behavioralModelValue);`,
);

replaceOnce(
  'policy-source-return-lineage',
  policyPath,
  `      valueAudit,
      hashes,
    };`,
  `      valueAudit,
      hashes,
      lineage: {
        behavioralDatasetV4Sha256,
        valueDatasetV4Sha256,
      },
    };`,
);

replaceOnce(
  'policy-manifest-lineage',
  policyPath,
  `      valueDatasetVersion: readNestedString(
        input.sources.valueManifest,
        ['source', 'datasetVersion'],
      ),
      hashes: input.sources.hashes,`,
  `      valueDatasetVersion: readNestedString(
        input.sources.valueManifest,
        ['source', 'datasetVersion'],
      ),
      lineage: input.sources.lineage,
      hashes: input.sources.hashes,`,
);

replaceOnce(
  'policy-required-sha',
  policyPath,
  `function requiredText(value: unknown, name: string): string {
  const result = text(value);
  if (!result) {
    throw new Error(\`${name} must be a non-empty string.\`);
  }
  return result;
}

function requiredBoolean(value: unknown, name: string): boolean {`,
  `function requiredText(value: unknown, name: string): string {
  const result = text(value);
  if (!result) {
    throw new Error(\`${name} must be a non-empty string.\`);
  }
  return result;
}

function requiredSha(value: unknown, name: string): string {
  const result = requiredText(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw new Error(\`${name} must be a SHA-256 digest.\`);
  }
  return result;
}

function requiredBoolean(value: unknown, name: string): boolean {`,
);

replaceOnce(
  'value-test-audit-lineage',
  valueTestPath,
  `        datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        actualSha256: sourceSha256,`,
  `        datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        actualSha256: sourceSha256,
        upstreamDatasetV4Sha256: 'a'.repeat(64),`,
);

replaceOnce(
  'value-test-manifest-lineage',
  valueTestPath,
  `        datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        auditPassed: true,
        artifact: {`,
  `        datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        auditPassed: true,
        source: {
          sha256: 'a'.repeat(64),
        },
        artifact: {`,
);

replaceOnce(
  'policy-test-lineage-constant',
  policyTestPath,
  `  it('joins held-out artifacts and persists match-balanced OPE results', async () => {
    const behavioralRows = [`,
  `  it('joins held-out artifacts and persists match-balanced OPE results', async () => {
    const upstreamDatasetV4Sha256 = 'a'.repeat(64);
    const behavioralRows = [`,
);

replaceOnce(
  'policy-test-behavioral-lineage',
  policyTestPath,
  `        auditPassed: true,
        releaseGatePassed: true,
        artifacts: {`,
  `        auditPassed: true,
        releaseGatePassed: true,
        source: {
          artifactSha256: upstreamDatasetV4Sha256,
        },
        artifacts: {`,
);

replaceOnce(
  'policy-test-value-lineage',
  policyTestPath,
  `        source: {
          datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
        },`,
  `        source: {
          datasetVersion: RECOMMENDATION_DECISION_DATASET_V5_VERSION,
          upstreamDatasetV4Sha256,
        },`,
);

replaceOnce(
  'policy-test-audit-lineage',
  policyTestPath,
  `    expect(service.getAudit()).toMatchObject({
      passed: true,
      leakage: {`,
  `    expect(service.getAudit()).toMatchObject({
      passed: true,
      source: {
        lineage: {
          behavioralDatasetV4Sha256: upstreamDatasetV4Sha256,
          valueDatasetV4Sha256: upstreamDatasetV4Sha256,
        },
      },
      leakage: {`,
);

replaceOnce(
  'value-doc-lineage',
  'docs/recommendation-value-v6.md',
  `- an optional caller-supplied source SHA-256 to match.

Training uses a chronological match-level 70/15/15 split by default.`,
  `- an optional caller-supplied source SHA-256 to match.

The manifest and audit also preserve the upstream Dataset V4 SHA-256 used to build Dataset V5.3.

Training uses a chronological match-level 70/15/15 split by default.`,
);

replaceOnce(
  'policy-doc-lineage',
  'docs/recommendation-policy-v6-evaluation.md',
  `All source hashes are checked against their manifests before evaluation starts.

## Policies`,
  `All source hashes are checked against their manifests before evaluation starts.

The evaluator also requires Behavioral V4 and Value V6 to carry the same upstream Dataset V4 SHA-256 lineage. A corpus mismatch fails before any policy estimate is produced.

## Policies`,
);

console.log(JSON.stringify({ changes }, undefined, 2));
