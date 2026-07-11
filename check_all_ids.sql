SELECT mp."heroId", array_agg(DISTINCT sup."abilityId" ORDER BY sup."abilityId") as abilities_used, COUNT(*) as records
FROM match_players mp
JOIN match_player_skill_upgrades sup ON sup."matchPlayerId" = mp.id
GROUP BY mp."heroId"
ORDER BY mp."heroId";
