import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Match } from './entities/match.entity';
import { MatchPlayer } from './entities/match-player.entity';
import { MatchPlayerItem } from './entities/match-player-item.entity';
import { MatchPlayerSkillUpgrade } from './entities/match-player-skill-upgrade.entity';
import { RecentMatchesWindowService } from './recent-matches-window.service';

@Injectable()
export class LazyRecentMatchesWindowService extends RecentMatchesWindowService {
  constructor(
    @InjectRepository(Match)
    matchRepository: Repository<Match>,
    @InjectRepository(MatchPlayer)
    matchPlayerRepository: Repository<MatchPlayer>,
    @InjectRepository(MatchPlayerItem)
    matchPlayerItemRepository: Repository<MatchPlayerItem>,
    @InjectRepository(MatchPlayerSkillUpgrade)
    matchPlayerSkillUpgradeRepository: Repository<MatchPlayerSkillUpgrade>,
  ) {
    super(
      matchRepository,
      matchPlayerRepository,
      matchPlayerItemRepository,
      matchPlayerSkillUpgradeRepository,
    );
  }

  override onModuleInit(): void {
    // The full historical window is loaded lazily by situational matchup warmup.
  }
}
