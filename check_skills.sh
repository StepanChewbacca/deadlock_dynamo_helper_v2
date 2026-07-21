#!/bin/bash
ssh my-vps << 'EOF'
sudo docker exec -i aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds << 'SQL'
SELECT mp.hero_id, mpsu.ability_id, mpsu.upgrade_order
FROM match_player_skill_upgrades mpsu
JOIN match_players mp ON mpsu.match_player_id = mp.id
WHERE mp.hero_id = 2
ORDER BY mp.id, mpsu.upgrade_order
LIMIT 50;
SQL
EOF
