#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${POSTGRES_BIN_DIR:-/opt/homebrew/opt/postgresql@18/bin}"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')"
  export DATABASE_URL
fi
: "${DATABASE_URL:?DATABASE_URL is not set (check .env)}"

URL="${DATABASE_URL%%\?*}"

"$BIN_DIR/psql" -v ON_ERROR_STOP=1 "$URL" -c \
  "CREATE TABLE IF NOT EXISTS common._migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

for migration in "$ROOT"/prisma/migrations/*/migration.sql; do
  name="$(basename "$(dirname "$migration")")"
  applied="$("$BIN_DIR/psql" -tA "$URL" -c "SELECT 1 FROM common._migrations WHERE name = '$name'")"
  if [ "$applied" = "1" ]; then
    echo "==> Skip $name (already applied)"
  else
    echo "==> Applying $name"
    "$BIN_DIR/psql" -v ON_ERROR_STOP=1 "$URL" -f "$migration"
    "$BIN_DIR/psql" -v ON_ERROR_STOP=1 "$URL" -c "INSERT INTO common._migrations(name) VALUES ('$name')"
  fi
done

echo "Migrations applied to $URL"
