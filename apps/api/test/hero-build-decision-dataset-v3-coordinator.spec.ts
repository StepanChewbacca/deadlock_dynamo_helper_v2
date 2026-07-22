import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HeroBuildDecisionDatasetV3CoordinatorService,
  recoverInterruptedFinalization,
} from '../src/deadlock-live/hero-build-decision-dataset-v3-coordinator.service';
import type {
  HeroBuildDecisionDatasetV3Service,
  HeroBuildDecisionDatasetV3Status,
} from '../src/deadlock-live/hero-build-decision-dataset-v3.service';

describe('HeroBuildDecisionDatasetV3CoordinatorService', () => {
  it('rejects a second start while the first start preflight is pending', async () => {
    let finishStart: (
      value: HeroBuildDecisionDatasetV3Status,
    ) => void = () => undefined;
    const pendingStart = new Promise<HeroBuildDecisionDatasetV3Status>(
      (resolve) => {
        finishStart = resolve;
      },
    );
    const idleStatus = createStatus('IDLE');
    const runningStatus = createStatus('RUNNING');
    const datasetService = {
      getStatus: jest.fn(() => idleStatus),
      getManifest: jest.fn(),
      getAudit: jest.fn(),
      start: jest.fn(() => pendingStart),
    } as unknown as HeroBuildDecisionDatasetV3Service;
    const coordinator = new HeroBuildDecisionDatasetV3CoordinatorService(
      datasetService,
    );

    const firstStart = coordinator.start();

    await expect(coordinator.start()).rejects.toThrow(
      'Contextual V3 decision dataset extraction is already running.',
    );
    expect(datasetService.start).toHaveBeenCalledTimes(1);

    finishStart(runningStatus);
    await expect(firstStart).resolves.toEqual(runningStatus);
  });
});

describe('recoverInterruptedFinalization', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restores a completed dataset rename to the resumable partial path', () => {
    const directory = createTemporaryDirectory();
    const dataset = '{"decisionId":"1:2:3"}\n';
    writeFileSync(join(directory, 'dataset.ndjson'), dataset, 'utf8');
    writeFileSync(
      join(directory, 'checkpoint.json'),
      JSON.stringify({
        nextHeroIndex: 2,
        heroIds: [1, 2],
        datasetByteLength: Buffer.byteLength(dataset),
      }),
      'utf8',
    );

    expect(recoverInterruptedFinalization(directory)).toBe(true);
    expect(existsSync(join(directory, 'dataset.ndjson'))).toBe(false);
    expect(
      readFileSync(
        join(directory, 'dataset.ndjson.partial'),
        'utf8',
      ),
    ).toBe(dataset);
  });

  it('does not move an artifact that does not match the checkpoint length', () => {
    const directory = createTemporaryDirectory();
    const dataset = '{"decisionId":"1:2:3"}\n';
    writeFileSync(join(directory, 'dataset.ndjson'), dataset, 'utf8');
    writeFileSync(
      join(directory, 'checkpoint.json'),
      JSON.stringify({
        nextHeroIndex: 2,
        heroIds: [1, 2],
        datasetByteLength: Buffer.byteLength(dataset) + 1,
      }),
      'utf8',
    );

    expect(recoverInterruptedFinalization(directory)).toBe(false);
    expect(existsSync(join(directory, 'dataset.ndjson'))).toBe(true);
    expect(
      existsSync(join(directory, 'dataset.ndjson.partial')),
    ).toBe(false);
  });

  function createTemporaryDirectory(): string {
    const directory = mkdtempSync(
      join(tmpdir(), 'deadlock-v3-dataset-'),
    );
    directories.push(directory);
    return directory;
  }
});

function createStatus(
  state: HeroBuildDecisionDatasetV3Status['state'],
): HeroBuildDecisionDatasetV3Status {
  return {
    state,
    phase: state === 'RUNNING' ? 'PREPARING' : 'COMPLETE',
    totalMatchCount: 0,
    totalHeroCount: 0,
    processedHeroCount: 0,
    processedMatchCount: 0,
    rowCount: 0,
    excludedSequenceCount: 0,
    excludedSellActionCount: 0,
    datasetAvailable: false,
    manifestAvailable: false,
    auditAvailable: false,
    checkpointAvailable: false,
    resumedFromCheckpoint: false,
    persistenceMode: 'CHECKPOINT_PER_HERO',
    storageDirectory: '/tmp',
    datasetPath: '/tmp/dataset.ndjson',
  };
}
