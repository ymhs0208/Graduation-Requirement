#!/bin/sh
# 備份資料庫與上傳檔。在專案根目錄執行：sh scripts/backup.sh
set -eu
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=${1:-"./backups/$STAMP"}
mkdir -p "$OUT"
if docker compose ps db >/dev/null 2>&1; then
  docker compose exec -T db pg_dump -U gradtrack gradtrack > "$OUT/gradtrack.sql"
  docker compose cp api:/data/uploads "$OUT/uploads"
else
  pg_dump "$DATABASE_URL" > "$OUT/gradtrack.sql"
  mkdir -p "$OUT/uploads"
  cp -a server/var/uploads/. "$OUT/uploads/" 2>/dev/null || true
fi
tar -C "$(dirname "$OUT")" -czf "$OUT.tgz" "$(basename "$OUT")"
echo "備份完成：$OUT.tgz"
