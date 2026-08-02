#!/bin/sh
set -eu

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${ENV_FILE:-${project_root}/deploy/.env.production}"
compose_file="${project_root}/deploy/compose.production.yml"

if [ ! -f "${env_file}" ]; then
  echo "missing production environment file: ${env_file}" >&2
  exit 2
fi

set -a
. "${env_file}"
set +a

compose() {
  docker compose --env-file "${env_file}" -f "${compose_file}" "$@"
}

compose config --quiet
compose build
compose up -d postgres
compose run --rm -e BACKUP_ON_START=false backup /scripts/backup.sh
compose run --rm migrate
compose up -d --remove-orphans --wait --wait-timeout 180 backend scheduler frontend proxy backup

health_url="${HEALTHCHECK_URL:-https://${DOMAIN}/api/v1/system/health}"
attempt=0
until curl --fail --silent --show-error "${health_url}" > /dev/null; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 24 ]; then
    echo "deployment health check failed: ${health_url}" >&2
    compose ps
    exit 1
  fi
  sleep 5
done

compose ps
echo "deployment completed: ${health_url}"
