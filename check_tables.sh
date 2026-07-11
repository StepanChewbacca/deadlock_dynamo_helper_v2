#!/bin/bash
ssh -i ~/.ssh/vps_oracle.key opc@141.253.104.108 << 'EOF'
docker exec -i aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds -c "\dt match*"
EOF