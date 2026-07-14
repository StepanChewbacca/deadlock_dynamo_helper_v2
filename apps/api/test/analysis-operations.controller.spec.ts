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
} = {}): AnalysisOperationsController {
  return new AnalysisOperationsController(
    (overrides.crawler ?? {}) as any,
    (overrides.reprocessing ?? {}) as any,
    (overrides.recentWindow ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}
