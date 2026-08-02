#!/bin/sh
set -eu

source_file="${1:-}"
case "${source_file}" in
  /backups/flow-ledger-*.dump) ;;
  *) echo "restore source must be a /backups/flow-ledger-*.dump file" >&2; exit 2 ;;
esac
if [ ! -f "${source_file}" ]; then
  echo "restore source does not exist: ${source_file}" >&2
  exit 2
fi

echo "$(date -u +%FT%TZ) restore validation started source=${source_file}"
if [ -f "${source_file}.sha256" ]; then
  sha256sum -c "${source_file}.sha256"
fi
pg_restore --list "${source_file}" > /dev/null
sh /scripts/backup.sh
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  --dbname="${PGDATABASE}" \
  "${source_file}"
echo "$(date -u +%FT%TZ) restore completed source=${source_file}"
