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

compose config --quiet
compose build
compose up -d postgres
compose run --rm -e BACKUP_ON_START=false backup /scripts/backup.sh
compose run --rm migrate
if [ "${proxy_mode}" = "caddy" ]; then
  compose up -d --remove-orphans --wait --wait-timeout 180 \
    backend scheduler frontend proxy backup
else
  compose up -d --remove-orphans --wait --wait-timeout 180 \
    backend scheduler frontend backup
fi

if [ -n "${HEALTHCHECK_URL:-}" ]; then
  health_url="${HEALTHCHECK_URL}"
elif [ "${proxy_mode}" = "caddy" ]; then
  health_url="https://${DOMAIN}/api/v1/system/health"
else
  health_url="http://127.0.0.1:${EXTERNAL_PROXY_PORT:-18080}/api/v1/system/health"
fi
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
echo "deployment completed with proxy mode ${proxy_mode}: ${health_url}"
