import { CrawlerRun } from '../deadlock-live/entities/crawler-run.entity';
import { CrawlerState } from '../deadlock-live/entities/crawler-state.entity';
import { GameRuleset } from '../deadlock-live/entities/game-ruleset.entity';
import { Hero } from '../deadlock-live/entities/hero.entity';
import { ItemCatalogItem } from '../deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from '../deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from '../deadlock-live/entities/item-catalog-version.entity';
import { ItemComponent } from '../deadlock-live/entities/item-component.entity';
import { Item } from '../deadlock-live/entities/item.entity';
import { MatchPlayerItem } from '../deadlock-live/entities/match-player-item.entity';
import { MatchPlayerSkillUpgrade } from '../deadlock-live/entities/match-player-skill-upgrade.entity';
import { MatchPlayer } from '../deadlock-live/entities/match-player.entity';
import { Match } from '../deadlock-live/entities/match.entity';
import { RawMatchMetadata } from '../deadlock-live/entities/raw-match-metadata.entity';
import { ShadowModeDecision } from '../deadlock-live/entities/shadow-mode-decision.entity';

export const DATABASE_ENTITIES = [
  Match,
  MatchPlayer,
  MatchPlayerItem,
  MatchPlayerSkillUpgrade,
  Hero,
  Item,
  ItemComponent,
  CrawlerRun,
  CrawlerState,
  ShadowModeDecision,
  RawMatchMetadata,
  GameRuleset,
  ItemCatalogVersion,
  ItemCatalogItem,
  ItemCatalogRecipe,
];
