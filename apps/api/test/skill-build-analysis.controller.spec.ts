import { BadRequestException } from '@nestjs/common';
import { SkillBuildAnalysisController } from '../src/deadlock-live/skill-build-analysis.controller';
import type { SkillBuildAnalysisService } from '../src/deadlock-live/skill-build-analysis.service';

describe('SkillBuildAnalysisController', () => {
  it('passes parsed hero, budget, and live levels to the service', () => {
    const response = Promise.resolve({ actions: [] });
    const service = {
      getHeroSkillBuild: jest.fn().mockReturnValue(response),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    expect(controller.getHeroSkillBuild('11', '12', '1,0,2,3')).toBe(response);
    expect(service.getHeroSkillBuild).toHaveBeenCalledWith(11, {
      maxPointBudget: 12,
      currentLevels: { 1: 1, 2: 0, 3: 2, 4: 3 },
    });
  });

  it('uses the full budget and initial levels by default', () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    controller.getHeroSkillBuild('11');

    expect(service.getHeroSkillBuild).toHaveBeenCalledWith(11, {
      maxPointBudget: 36,
      currentLevels: undefined,
    });
  });

  it('rejects an invalid hero id', () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    expect(() => controller.getHeroSkillBuild('invalid')).toThrow(BadRequestException);
  });

  it('rejects a point budget above the supported maximum', () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    expect(() => controller.getHeroSkillBuild('11', '37')).toThrow(BadRequestException);
  });

  it('rejects malformed live skill levels', () => {
    const service = {
      getHeroSkillBuild: jest.fn(),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    expect(() => controller.getHeroSkillBuild('11', undefined, '1,2,3')).toThrow(
      BadRequestException,
    );
    expect(() => controller.getHeroSkillBuild('11', undefined, '1,2,3,5')).toThrow(
      BadRequestException,
    );
  });
});
