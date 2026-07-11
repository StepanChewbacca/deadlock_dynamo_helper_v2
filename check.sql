SELECT hero_id, array_agg(DISTINCT ability_slot ORDER BY ability_slot) as slots_used, COUNT(*) FROM match_player_skill_upgrades GROUP BY hero_id ORDER BY hero_id;
