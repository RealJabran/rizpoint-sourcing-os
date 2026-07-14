#!/usr/bin/env bash
set -euo pipefail

# Produces a checksumed custom-format dump. Upload it only to encrypted private
# backup storage using the platform backup identity; never commit dump files.
: "${RIZPOINT_BACKUP_DIR:?RIZPOINT_BACKUP_DIR is required}"
: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSFILE:?PGPASSFILE is required (do not use DATABASE_URL on the command line)}"
export PGSSLMODE="${PGSSLMODE:-require}"
mkdir -p "$RIZPOINT_BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$RIZPOINT_BACKUP_DIR/rizpoint-$stamp.dump"
pg_dump --format=custom --no-owner --no-privileges --file="$dump"
sha256sum "$dump" > "$dump.sha256"
echo "$dump"
