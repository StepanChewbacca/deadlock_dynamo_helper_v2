import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import {
  HeroSkillLevels,
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
    @Query('levels') levelsValue?: string,
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

    return this.skillBuildAnalysisService.getHeroSkillBuild(heroId, {
      maxPointBudget,
      currentLevels: parseSkillLevels(levelsValue),
    });
  }
}

function parseSkillLevels(value: string | undefined): HeroSkillLevels | undefined {
  if (value === undefined) {
    return undefined;
  }

  const levels = value.split(',').map((part) => Number(part.trim()));
  if (
    levels.length !== 4 ||
    levels.some((level) => !Number.isSafeInteger(level) || level < 0 || level > 4)
  ) {
    throw new BadRequestException(
      'levels must contain four comma-separated integers between 0 and 4.',
    );
  }

  return {
    1: levels[0] as 0 | 1 | 2 | 3 | 4,
    2: levels[1] as 0 | 1 | 2 | 3 | 4,
    3: levels[2] as 0 | 1 | 2 | 3 | 4,
    4: levels[3] as 0 | 1 | 2 | 3 | 4,
  };
}

function parsePositiveSafeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} must be a positive safe integer.`);
  }
  return parsed;
}
