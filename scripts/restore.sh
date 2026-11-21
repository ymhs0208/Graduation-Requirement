#!/bin/sh
# 還原備份。用法：sh scripts/restore.sh backups/20260101-120000.tgz
set -eu
ARCHIVE=${1:?請指定備份壓縮檔}
WORKDIR=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$WORKDIR"
SQL=$(find "$WORKDIR" -name gradtrack.sql | head -n 1)
UPLOADS=$(find "$WORKDIR" -type d -name uploads | head -n 1)
if [ -z "$SQL" ]; then
  echo "找不到 gradtrack.sql" >&2
  exit 1
fi
if docker compose ps db >/dev/null 2>&1; then
  docker compose exec -T db psql -U gradtrack -d gradtrack -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  docker compose exec -T db psql -U gradtrack -d gradtrack < "$SQL"
  if [ -n "$UPLOADS" ]; then
    docker compose cp "$UPLOADS/." api:/data/uploads
  fi
else
  psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  psql "$DATABASE_URL" < "$SQL"
  if [ -n "$UPLOADS" ]; then
    mkdir -p server/var/uploads
    cp -a "$UPLOADS/." server/var/uploads/
  fi
fi
rm -rf "$WORKDIR"
echo "還原完成。請重新啟動 API。"
