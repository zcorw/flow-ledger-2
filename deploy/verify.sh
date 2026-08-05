#!/bin/sh
set -eu

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${ENV_FILE:-${project_root}/deploy/.env.production}"
proxy_mode_override="${PROXY_MODE:-}"

if [ ! -f "${env_file}" ]; then
  echo "missing production environment file: ${env_file}" >&2
  exit 2
fi

set -a
. "${env_file}"
set +a

proxy_mode="${proxy_mode_override:-${PROXY_MODE:-caddy}}"
case "${proxy_mode}" in
  caddy|external) ;;
  *)
    echo "invalid PROXY_MODE: ${proxy_mode}; expected caddy or external" >&2
    exit 2
    ;;
esac

compose() {
  ENV_FILE="${env_file}" PROXY_MODE="${proxy_mode}" \
    sh "${project_root}/deploy/compose.sh" "$@"
}

if [ -n "${HEALTHCHECK_URL:-}" ]; then
  health_url="${HEALTHCHECK_URL}"
elif [ "${proxy_mode}" = "caddy" ]; then
  health_url="https://${DOMAIN}/api/v1/system/health"
else
  health_url="http://127.0.0.1:${EXTERNAL_PROXY_PORT:-18080}/api/v1/system/health"
fi
curl --fail --silent --show-error "${health_url}"
compose exec -T backend python -m app.healthcheck api
compose exec -T scheduler python -m app.healthcheck scheduler
compose exec -T backup sh /scripts/backup.sh
compose exec -T backup sh -c 'latest=$(ls -1t /backups/*.dump | head -n 1); test -s "$latest"; sha256sum -c "$latest.sha256"'
compose ps
echo "deployment verification completed with proxy mode ${proxy_mode}"
