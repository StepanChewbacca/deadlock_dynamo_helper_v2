import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import {
  SKILL_BUILD_MAX_POINT_BUDGET,
  SkillBuildAnalysisService,
} from './skill-build-analysis.service';

@Controller('deadlock/analysis/heroes')
export class SkillBuildAnalysisController {
  constructor(private readonly skillBuildAnalysisService: SkillBuildAnalysisService) {}

  @Get(':heroId/skill-build')
  getHeroSkillBuild(
    @Param('heroId') heroIdValue: string,
    @Query('maxPointBudget') maxPointBudgetValue?: string,
  ) {
    const heroId = parsePositiveSafeInteger(heroIdValue, 'heroId');
    const maxPointBudget =
      maxPointBudgetValue === undefined
        ? SKILL_BUILD_MAX_POINT_BUDGET
        : parsePositiveSafeInteger(maxPointBudgetValue, 'maxPointBudget');

    if (maxPointBudget > SKILL_BUILD_MAX_POINT_BUDGET) {
      throw new BadRequestException(
        `maxPointBudget must not exceed ${SKILL_BUILD_MAX_POINT_BUDGET}.`,
      );
    }

    return this.skillBuildAnalysisService.getHeroSkillBuild(heroId, maxPointBudget);
  }
}

function parsePositiveSafeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} must be a positive safe integer.`);
  }
  return parsed;
}
