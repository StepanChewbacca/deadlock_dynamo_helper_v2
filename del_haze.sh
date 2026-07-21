#!/bin/bash
ssh my-vps << 'EOF'
sudo docker exec -i aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds << 'SQL'
DELETE FROM match_player_skill_upgrades WHERE match_player_id IN (SELECT id FROM match_players WHERE hero_id = 2);
DELETE FROM match_player_items WHERE match_player_id IN (SELECT id FROM match_players WHERE hero_id = 2);
DELETE FROM match_players WHERE hero_id = 2;
SQL
EOF
