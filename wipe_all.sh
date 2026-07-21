#!/bin/bash
ssh my-vps << 'EOF'
sudo docker exec -i aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds << 'SQL'
DELETE FROM match_player_skill_upgrades;
DELETE FROM match_player_items;
DELETE FROM match_players;
DELETE FROM matches;
DELETE FROM crawler_runs WHERE crawler_type = 'all_heroes';
DELETE FROM crawler_state WHERE crawler_type = 'all_heroes';
SQL
EOF
