import { HeroBuildContextualV3TrainingCoordinatorService } from '../src/deadlock-live/hero-build-contextual-v3-training-coordinator.service';
import {
  ContextualV3TrainingStatus,
  HeroBuildContextualV3TrainingService,
} from '../src/deadlock-live/hero-build-contextual-v3-training.service';

function createStatus(
  state: ContextualV3TrainingStatus['state'],
): ContextualV3TrainingStatus {
  return {
    state,
    phase: state === 'COMPLETE' ? 'COMPLETE' : 'PREPARING',
    currentPass: 0,
    totalPasses: 3,
    sourceRowCount: 0,
    processedRowCount: 0,
    trainRowCount: 0,
    validationRowCount: 0,
    sourceMatchCount: 0,
    trainMatchCount: 0,
    validationMatchCount: 0,
    outputDirectory: '/tmp/contextual-v3-training',
    manifestAvailable: false,
    auditAvailable: false,
    evaluationAvailable: false,
    modelAvailable: false,
  };
}

describe('HeroBuildContextualV3TrainingCoordinatorService', () => {
  it('rejects a concurrent start while the first preflight is in flight', async () => {
    let resolveStart!: (status: ContextualV3TrainingStatus) => void;
    const pending = new Promise<ContextualV3TrainingStatus>((resolve) => {
      resolveStart = resolve;
    });
    const trainingService = {
      getStatus: jest.fn(() => createStatus('IDLE')),
      start: jest.fn(() => pending),
      getManifest: jest.fn(),
      getAudit: jest.fn(),
      getEvaluation: jest.fn(),
      getArchetypes: jest.fn(),
    } as unknown as HeroBuildContextualV3TrainingService;
    const coordinator = new HeroBuildContextualV3TrainingCoordinatorService(
      trainingService,
    );

    const firstStart = coordinator.start({});
    await expect(coordinator.start({})).rejects.toThrow(
      'Contextual V3 training pipeline is already running.',
    );

    resolveStart(createStatus('RUNNING'));
    await expect(firstStart).resolves.toMatchObject({ state: 'RUNNING' });
    expect(trainingService.start).toHaveBeenCalledTimes(1);
  });
});
