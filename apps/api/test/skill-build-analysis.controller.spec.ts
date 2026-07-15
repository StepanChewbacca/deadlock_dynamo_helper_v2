import { BadRequestException } from '@nestjs/common';
import { SkillBuildAnalysisController } from '../src/deadlock-live/skill-build-analysis.controller';
import type { SkillBuildAnalysisService } from '../src/deadlock-live/skill-build-analysis.service';

const SERVICE_RESPONSE = {
  heroId: 11,
  actions: [],
};

describe('SkillBuildAnalysisController', () => {
  it('passes parsed API hero, budget, and live levels to the service', async () => {
    const service = {
      getHeroSkillBuild: jest.fn().mockResolvedValue(SERVICE_RESPONSE),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await expect(
      controller.getHeroSkillBuild('11', '12', '1,0,2,3'),
    ).resolves.toMatchObject({ heroId: 11, resolvedHeroId: 11 });
    expect(service.getHeroSkillBuild).toHaveBeenCalledWith(11, {
      maxPointBudget: 12,
      currentLevels: { 1: 1, 2: 0, 3: 2, 4: 3 },
    });
  });

  it('resolves Victor GEP id to the Valve/API id without changing response identity', async () => {
    const service = {
      getHeroSkillBuild: jest.fn().mockResolvedValue({
        ...SERVICE_RESPONSE,
        heroId: 66,
      }),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await expect(
      controller.getHeroSkillBuild('27', undefined, undefined, 'gep'),
    ).resolves.toMatchObject({ heroId: 27, resolvedHeroId: 66 });
    expect(service.getHeroSkillBuild).toHaveBeenCalledWith(66, {
      maxPointBudget: 36,
      currentLevels: undefined,
    });
  });

  it('preserves existing GEP compatibility mappings for skill history', async () => {
    const service = {
      getHeroSkillBuild: jest.fn().mockResolvedValue({
        ...SERVICE_RESPONSE,
        heroId: 72,
      }),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await expect(
      controller.getHeroSkillBuild('6', undefined, undefined, 'gep'),
    ).resolves.toMatchObject({ heroId: 6, resolvedHeroId: 72 });
    expect(service.getHeroSkillBuild).toHaveBeenCalledWith(72, {
      maxPointBudget: 36,
      currentLevels: undefined,
    });
  });

  it('uses the full budget and initial levels by default', async () => {
    const service = {
      getHeroSkillBuild: jest.fn().mockResolvedValue(SERVICE_RESPONSE),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await controller.getHeroSkillBuild('11');

    expect(service.getHeroSkillBuild).toHaveBeenCalledWith(11, {
      maxPointBudget: 36,
      currentLevels: undefined,
    });
  });

  it('rejects an invalid hero id', async () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await expect(controller.getHeroSkillBuild('invalid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a point budget above the supported maximum', async () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await expect(controller.getHeroSkillBuild('11', '37')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects malformed live skill levels', async () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await expect(
      controller.getHeroSkillBuild('11', undefined, '1,2,3'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.getHeroSkillBuild('11', undefined, '1,2,3,5'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unsupported hero id source', async () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    await expect(
      controller.getHeroSkillBuild('11', undefined, undefined, 'unknown'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
