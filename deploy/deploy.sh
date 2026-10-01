#!/bin/sh
set -eu

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="${ENV_FILE:-${project_root}/deploy/.env.production}"
proxy_mode_override="${PROXY_MODE:-}"
image_tag_override="${IMAGE_TAG:-}"

if [ ! -f "${env_file}" ]; then
  echo "missing production environment file: ${env_file}" >&2
  exit 2
fi

set -a
. "${env_file}"
set +a

image_tag="${image_tag_override:-${IMAGE_TAG:-latest}}"
case "${image_tag}" in
  ''|*[!A-Za-z0-9_.-]*)
    echo "invalid IMAGE_TAG: ${image_tag}" >&2
    exit 2
    ;;
esac
IMAGE_TAG="${image_tag}"
export IMAGE_TAG

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

validate_non_negative_integer() {
  value="$1"
  name="$2"
  case "${value}" in
    ''|*[!0-9]*)
      echo "invalid ${name}: ${value}; expected a non-negative integer" >&2
      exit 2
      ;;
  esac
}

preflight_resources() {
  min_memory_mb="${DEPLOY_MIN_AVAILABLE_MEMORY_MB:-128}"
  min_disk_mb="${DEPLOY_MIN_DOCKER_FREE_MB:-2048}"
  validate_non_negative_integer "${min_memory_mb}" DEPLOY_MIN_AVAILABLE_MEMORY_MB
  validate_non_negative_integer "${min_disk_mb}" DEPLOY_MIN_DOCKER_FREE_MB

  available_memory_mb="$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)"
  swap_free_mb="$(awk '/^SwapFree:/ { print int($2 / 1024) }' /proc/meminfo)"
  if [ -n "${available_memory_mb}" ]; then
    echo "deployment preflight: available memory ${available_memory_mb} MB, free swap ${swap_free_mb:-0} MB"
    if [ "${available_memory_mb}" -lt "${min_memory_mb}" ]; then
      echo "deployment preflight failed: available memory is below ${min_memory_mb} MB" >&2
      exit 1
    fi
  fi

  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  if [ -z "${docker_root}" ] || [ ! -d "${docker_root}" ]; then
    echo "deployment preflight failed: invalid Docker root directory: ${docker_root}" >&2
    exit 1
  fi
  available_disk_mb="$(df -Pk "${docker_root}" | awk 'NR == 2 { print int($4 / 1024) }')"
  echo "deployment preflight: Docker root ${docker_root}, available disk ${available_disk_mb} MB"
  if [ "${available_disk_mb}" -lt "${min_disk_mb}" ]; then
    echo "deployment preflight failed: Docker disk space is below ${min_disk_mb} MB" >&2
    docker system df >&2 || true
    exit 1
  fi
  docker system df
}

prune_old_docker_data() {
  prune_enabled="${DEPLOY_PRUNE_ENABLED:-true}"
  prune_until="${DEPLOY_PRUNE_UNTIL:-168h}"
  case "${prune_enabled}" in
    true)
      echo "pruning unused images and obsolete build cache older than ${prune_until}"
      if ! docker image prune --all --force --filter "until=${prune_until}"; then
        echo "warning: unable to prune unused images" >&2
      fi
      if ! docker builder prune --all --force --filter "until=${prune_until}"; then
        echo "warning: unable to prune obsolete Docker build cache" >&2
      fi
      ;;
    false) ;;
    *)
      echo "invalid DEPLOY_PRUNE_ENABLED: ${prune_enabled}; expected true or false" >&2
      exit 2
      ;;
  esac
}

compose config --quiet
preflight_resources
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
echo "pulling application images for ${IMAGE_TAG}"
compose pull backend
compose pull frontend
compose up -d postgres
compose run --rm -e BACKUP_ON_START=false backup /scripts/backup.sh
compose run --rm migrate
if [ "${proxy_mode}" = "caddy" ]; then
  compose up -d --no-build --remove-orphans --wait --wait-timeout 180 \
    backend scheduler frontend proxy backup
else
  compose up -d --no-build --remove-orphans --wait --wait-timeout 180 \
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
prune_old_docker_data
echo "deployment completed with proxy mode ${proxy_mode}: ${health_url}"
