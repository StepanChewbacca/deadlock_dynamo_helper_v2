#!/bin/bash
ssh my-vps << 'EOF'
sudo docker exec -i aboba-telegramovich-postgres-1 psql -U postgres -d deadlock_builds -c "\dt match*"
EOF
