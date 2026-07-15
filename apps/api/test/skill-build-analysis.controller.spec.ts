import { BadRequestException } from '@nestjs/common';
import { SkillBuildAnalysisController } from '../src/deadlock-live/skill-build-analysis.controller';
import type { SkillBuildAnalysisService } from '../src/deadlock-live/skill-build-analysis.service';

describe('SkillBuildAnalysisController', () => {
  it('passes parsed hero and point budget values to the service', () => {
    const response = { actions: [] };
    const service = {
      getHeroSkillBuild: jest.fn().mockReturnValue(response),
    } as unknown as SkillBuildAnalysisService;
    const controller = new SkillBuildAnalysisController(service);

    expect(controller.getHeroSkillBuild('11', '12')).toBe(response);
    expect(service.getHeroSkillBuild).toHaveBeenCalledWith(11, 12);
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
});
