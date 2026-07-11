DELETE FROM match_player_skill_upgrades;
DELETE FROM match_player_items;
DELETE FROM match_players;
DELETE FROM matches;
DELETE FROM crawler_runs WHERE crawler_type = 'all_heroes';
DELETE FROM crawler_state WHERE crawler_type = 'all_heroes';
