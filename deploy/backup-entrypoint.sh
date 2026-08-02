#!/bin/sh
set -eu

mkdir -p /backups /var/log/flow-ledger
if [ "${BACKUP_ON_START:-true}" = "true" ]; then
  sh /scripts/backup.sh >> /var/log/flow-ledger/backup.log 2>&1
fi
printf '%s %s\n' "${BACKUP_CRON:-0 2 * * *}" \
  'sh /scripts/backup.sh >> /var/log/flow-ledger/backup.log 2>&1' > /etc/crontabs/root
exec crond -f -l 2
