#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-service-measurement}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  read -r -p "Version tag (ej: 1.0.0): " VERSION
fi

if [[ -z "$VERSION" ]]; then
  echo "Error: version vacia."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: archivo .env no encontrado en $ENV_FILE"
  exit 1
fi

TMP_ENV_FILE="$(mktemp)"
trap 'rm -f "$TMP_ENV_FILE"' EXIT
# Evita problemas por CRLF al pasar --env-file en entornos Windows.
tr -d '\r' < "$ENV_FILE" > "$TMP_ENV_FILE"

# Docker --env-file no elimina comillas; normalizamos DATABASE_URL para evitar parseos invalidos.
if grep -q '^DATABASE_URL=' "$TMP_ENV_FILE"; then
  DB_LINE="$(grep -E '^DATABASE_URL=' "$TMP_ENV_FILE" | tail -n 1 || true)"
  DB_VALUE="${DB_LINE#DATABASE_URL=}"
  DB_VALUE="${DB_VALUE%\"}"
  DB_VALUE="${DB_VALUE#\"}"
  DB_VALUE="${DB_VALUE%\'}"
  DB_VALUE="${DB_VALUE#\'}"
  sed -i.bak -E "s|^DATABASE_URL=.*$|DATABASE_URL=$DB_VALUE|" "$TMP_ENV_FILE"
  rm -f "$TMP_ENV_FILE.bak"
fi

LOCAL_IMAGE="$IMAGE_NAME:$VERSION"
CONTAINER_NAME="${CONTAINER_NAME:-${IMAGE_NAME}-${VERSION}}"
CONTAINER_NAME="${CONTAINER_NAME//./-}"

if ! docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
  echo "Local image not found: $LOCAL_IMAGE"
  echo "Creating local image first..."
  "$SCRIPT_DIR/image-local.sh" "$VERSION"
fi

PORT_LINE="$(grep -E '^PORT=' "$ENV_FILE" | tail -n 1 || true)"
CONTAINER_PORT="${PORT_LINE#PORT=}"
CONTAINER_PORT="${CONTAINER_PORT%\"}"
CONTAINER_PORT="${CONTAINER_PORT#\"}"
CONTAINER_PORT="${CONTAINER_PORT%\'}"
CONTAINER_PORT="${CONTAINER_PORT#\'}"

if [[ -z "$CONTAINER_PORT" ]]; then
  CONTAINER_PORT="4001"
fi

HOST_PORT="${HOST_PORT:-$CONTAINER_PORT}"

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Removing existing container: $CONTAINER_NAME"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Running $LOCAL_IMAGE as $CONTAINER_NAME"
echo "Host port: $HOST_PORT -> Container port: $CONTAINER_PORT"
docker run -d \
  --name "$CONTAINER_NAME" \
  --env-file "$TMP_ENV_FILE" \
  -p "$HOST_PORT:$CONTAINER_PORT" \
  "$LOCAL_IMAGE"

echo "Container started: $CONTAINER_NAME"
echo "Tail logs: docker logs -f $CONTAINER_NAME"
echo "Effective env in container:"
docker inspect "$CONTAINER_NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(NODE_ENV|APP_NAME|PORT|LOKI_URL|VALKEY_URL|CACHE_TTL|DATABASE_URL)=' || true
