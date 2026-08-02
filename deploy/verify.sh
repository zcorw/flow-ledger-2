#!/bin/sh
set -eu

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${ENV_FILE:-${project_root}/deploy/.env.production}"
compose_file="${project_root}/deploy/compose.production.yml"

set -a
. "${env_file}"
set +a

compose() {
  docker compose --env-file "${env_file}" -f "${compose_file}" "$@"
}

health_url="${HEALTHCHECK_URL:-https://${DOMAIN}/api/v1/system/health}"
curl --fail --silent --show-error "${health_url}"
compose exec -T backend python -m app.healthcheck api
compose exec -T scheduler python -m app.healthcheck scheduler
compose exec -T backup sh /scripts/backup.sh
compose exec -T backup sh -c 'latest=$(ls -1t /backups/*.dump | head -n 1); test -s "$latest"; sha256sum -c "$latest.sha256"'
compose ps
echo "deployment verification completed"
