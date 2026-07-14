#!/usr/bin/env bash
set -euo pipefail

: "${RIZPOINT_RESTORE_CONFIRM:?Set RIZPOINT_RESTORE_CONFIRM=RESTORE_ISOLATED}"
: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSFILE:?PGPASSFILE is required}"
: "${1:?pass a pg_dump custom-format backup}"
if [[ "$RIZPOINT_RESTORE_CONFIRM" != "RESTORE_ISOLATED" || "$PGDATABASE" != rizpoint_restore_* ]]; then
  echo "Refusing restore: use an isolated database named rizpoint_restore_* and explicit confirmation." >&2
  exit 64
fi
export PGSSLMODE="${PGSSLMODE:-require}"
backup="$1"
sha256sum --check "$backup.sha256"
[[ "$(psql -tAc 'SELECT current_database()')" == "$PGDATABASE" ]]
pg_restore --clean --if-exists --no-owner --no-privileges "$backup"
psql -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS organizations FROM organizations;'
psql -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS calculations FROM profit_results;'
psql -v ON_ERROR_STOP=1 -c "SELECT count(*) AS foreign_keys FROM pg_constraint WHERE contype = 'f';"
