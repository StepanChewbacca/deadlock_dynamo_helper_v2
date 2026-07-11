#!/bin/bash
ssh -i ~/.ssh/vps_oracle.key opc@141.253.104.108 << 'EOF'
docker exec -i aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds << 'SQL'
DELETE FROM match_player_skill_upgrades;
DELETE FROM match_player_items;
DELETE FROM match_players;
DELETE FROM matches;
DELETE FROM crawler_runs WHERE crawler_type = 'all_heroes';
DELETE FROM crawler_state WHERE crawler_type = 'all_heroes';
SQL
EOF