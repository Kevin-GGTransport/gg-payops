#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${POSTGRES_BIN_DIR:-/opt/homebrew/opt/postgresql@18/bin}"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"')"
  export DATABASE_URL
fi
: "${DATABASE_URL:?DATABASE_URL is not set (check .env)}"

HOST="$(node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.hostname)')"
PORT="$(node -e 'const u=new URL(process.env.DATABASE_URL);console.log(u.port||"5432")')"

if ! "$BIN_DIR/pg_isready" -h "$HOST" -p "$PORT"; then
  echo "PostgreSQL at $HOST:$PORT is not reachable." >&2
  echo "Start it with: brew services start postgresql@18" >&2
  exit 1
fi
