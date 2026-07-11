DELETE FROM match_player_skill_upgrade WHERE match_player_id IN (SELECT id FROM match_player WHERE hero_id = 2);
DELETE FROM match_player_item WHERE match_player_id IN (SELECT id FROM match_player WHERE hero_id = 2);
DELETE FROM match_player WHERE hero_id = 2;