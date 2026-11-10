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
ADMIN_URL="${URL%/*}/postgres"
DB_NAME="${URL##*/}"
DB_USER="$(node -e 'console.log(new URL(process.env.DATABASE_URL).username)')"

bash "$ROOT/scripts/db-start.sh"

"$BIN_DIR/psql" -v ON_ERROR_STOP=1 "$ADMIN_URL" -v db_name="$DB_NAME" -v db_user="$DB_USER" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name')\gexec
SQL

bash "$ROOT/scripts/db-migrate.sh"
pnpm db:seed

echo "Local PostgreSQL is ready: $URL"
