import { BadRequestException } from '@nestjs/common';
import { AnalysisOperationsController } from '../src/deadlock-live/analysis-operations.controller';

describe('AnalysisOperationsController', () => {
  it('delegates crawler status and start to the recent match crawler', async () => {
    const crawler = {
      getProgress: jest.fn().mockReturnValue({ isCrawling: false, status: 'Idle' }),
      startCrawling: jest.fn().mockResolvedValue(undefined),
    };
    const controller = createController({ crawler });

    expect(controller.getCrawlProgress()).toEqual({
      isCrawling: false,
      status: 'Idle',
    });
    await expect(controller.startCrawl()).resolves.toEqual({
      success: true,
      message: 'Background crawl initiated.',
    });
    expect(crawler.startCrawling).toHaveBeenCalledTimes(1);
  });

  it('delegates situational example discovery with parsed limits', async () => {
    const situationalDiagnostics = {
      findExamples: jest.fn().mockResolvedValue({
        warningExampleCount: 0,
        examples: [],
      }),
    };
    const controller = createController({ situationalDiagnostics });

    await expect(
      controller.getSituationalExamples('7', '12000', '8'),
    ).resolves.toEqual({
      warningExampleCount: 0,
      examples: [],
    });
    expect(situationalDiagnostics.findExamples).toHaveBeenCalledWith({
      limit: 7,
      maxEvaluatedActions: 12000,
      maxValidatedStates: 8,
    });
  });

  it('marks a primary supported item as warning-ready without rank promotion', async () => {
    const situationalDiagnostics = {
      findExamples: jest.fn().mockResolvedValue({
        warningExampleCount: 0,
        examples: [
          {
            actionKey: 'BUY:100',
            isPrimaryRecommendation: true,
            wasPromotedByMatchup: false,
            wouldTriggerWarning: false,
          },
          {
            actionKey: 'BUY:200',
            isPrimaryRecommendation: false,
            wasPromotedByMatchup: true,
            wouldTriggerWarning: false,
          },
        ],
      }),
    };
    const controller = createController({ situationalDiagnostics });

    await expect(controller.getSituationalExamples()).resolves.toEqual({
      warningExampleCount: 1,
      examples: [
        expect.objectContaining({
          actionKey: 'BUY:100',
          wouldTriggerWarning: true,
        }),
        expect.objectContaining({
          actionKey: 'BUY:200',
          wouldTriggerWarning: false,
        }),
      ],
    });
  });

  it('rejects invalid situational diagnostic limits', async () => {
    const controller = createController();

    await expect(controller.getSituationalExamples('0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refreshes the in-memory match window after reprocessing a match', async () => {
    const reprocessing = {
      reprocess: jest.fn().mockResolvedValue({ matchId: 123, status: 'processed' }),
    };
    const recentWindow = {
      refresh: jest.fn().mockResolvedValue({ matchCount: 1 }),
    };
    const controller = createController({ reprocessing, recentWindow });

    await expect(controller.reprocessStoredMatch(123)).resolves.toEqual({
      matchId: 123,
      status: 'processed',
    });
    expect(reprocessing.reprocess).toHaveBeenCalledWith(123);
    expect(recentWindow.refresh).toHaveBeenCalledTimes(1);
  });
});

function createController(overrides: {
  crawler?: Record<string, jest.Mock>;
  reprocessing?: Record<string, jest.Mock>;
  recentWindow?: Record<string, jest.Mock>;
  situationalDiagnostics?: Record<string, jest.Mock>;
} = {}): AnalysisOperationsController {
  return new AnalysisOperationsController(
    (overrides.crawler ?? {}) as any,
    (overrides.reprocessing ?? {}) as any,
    (overrides.recentWindow ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    (overrides.situationalDiagnostics ?? {}) as any,
  );
}
