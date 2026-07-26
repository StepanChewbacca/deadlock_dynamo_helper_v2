const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const apiDirectory = join(root, 'apps/api');
const archivePath = '/tmp/recommendation-v6-lineage-files.tgz';
const targetFiles = [
  'apps/api/src/deadlock-live/recommendation-value-v6-training.service.ts',
  'apps/api/src/deadlock-live/recommendation-policy-v6-evaluation.service.ts',
  'apps/api/test/recommendation-value-v6-training.spec.ts',
  'apps/api/test/recommendation-policy-v6-evaluation-integration.spec.ts',
  'docs/recommendation-value-v6.md',
  'docs/recommendation-policy-v6-evaluation.md',
];

execFileSync(process.execPath, ['.github/scripts/apply-recommendation-v6-lineage.cjs'], {
  cwd: root,
  stdio: 'inherit',
});

execFileSync('yarn', ['nest', 'build'], {
  cwd: apiDirectory,
  stdio: 'inherit',
});

execFileSync(
  'yarn',
  [
    'jest',
    '--runInBand',
    'recommendation-value-v6-training.spec.ts',
    'recommendation-policy-v6-evaluation.spec.ts',
    'recommendation-policy-v6-evaluation-integration.spec.ts',
  ],
  {
    cwd: apiDirectory,
    stdio: 'inherit',
  },
);

execFileSync('tar', ['-czf', archivePath, ...targetFiles], {
  cwd: root,
  stdio: 'inherit',
});

const archive = readFileSync(archivePath).toString('base64');
console.log('RECOMMENDATION_V6_LINEAGE_ARCHIVE_BEGIN');
console.log(archive);
console.log('RECOMMENDATION_V6_LINEAGE_ARCHIVE_END');
console.error('Intentional CI failure after exporting verified lineage files.');
process.exit(1);
