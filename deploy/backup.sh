#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

umask 077
mkdir -p /backups /var/log/flow-ledger
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/backups/flow-ledger-${timestamp}.dump"
suffix=0
while [ -e "${target}" ]; do
  suffix=$((suffix + 1))
  target="/backups/flow-ledger-${timestamp}-${suffix}.dump"
done
temporary="${target}.tmp"

echo "$(date -u +%FT%TZ) backup started target=${target}"
pg_dump --format=custom --no-owner --no-privileges --file="${temporary}"
mv "${temporary}" "${target}"
sha256sum "${target}" > "${target}.sha256"
find /backups -type f \( -name 'flow-ledger-*.dump' -o -name 'flow-ledger-*.dump.sha256' \) \
  -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
echo "$(date -u +%FT%TZ) backup completed target=${target}"
