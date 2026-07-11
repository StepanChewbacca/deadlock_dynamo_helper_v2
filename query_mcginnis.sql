SELECT mp."heroId", mpsu."abilityId", mpsu."upgradeOrder", mp.id as player_id
FROM match_player_skill_upgrades mpsu
JOIN match_players mp ON mpsu."matchPlayerId" = mp.id
WHERE mp."heroId" = 4
ORDER BY mp.id, mpsu."upgradeOrder";