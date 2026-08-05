#!/bin/sh
set -eu

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${ENV_FILE:-${project_root}/deploy/.env.production}"
base_file="${project_root}/deploy/compose.production.yml"
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
  caddy)
    overlay_file="${project_root}/deploy/compose.caddy.yml"
    ;;
  external)
    overlay_file="${project_root}/deploy/compose.external-proxy.yml"
    ;;
  *)
    echo "invalid PROXY_MODE: ${proxy_mode}; expected caddy or external" >&2
    exit 2
    ;;
esac

exec docker compose \
  --env-file "${env_file}" \
  -f "${base_file}" \
  -f "${overlay_file}" \
  "$@"
