#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-service-measurement}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-$REPO_ROOT/.dockerfile}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
	read -r -p "Version tag (ej: 1.0.0): " VERSION
fi

if [[ -z "$VERSION" ]]; then
	echo "Error: version vacia."
	exit 1
fi

if [[ ! -f "$DOCKERFILE_PATH" ]]; then
	echo "Error: no existe Dockerfile en $DOCKERFILE_PATH"
	exit 1
fi

LOCAL_IMAGE="$IMAGE_NAME:$VERSION"

if [[ -z "${DATABASE_URL:-}" && -f "$ENV_FILE" ]]; then
	DATABASE_URL_LINE="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -n 1 || true)"
	if [[ -n "$DATABASE_URL_LINE" ]]; then
		DATABASE_URL="${DATABASE_URL_LINE#DATABASE_URL=}"
		DATABASE_URL="${DATABASE_URL%\"}"
		DATABASE_URL="${DATABASE_URL#\"}"
		DATABASE_URL="${DATABASE_URL%\'}"
		DATABASE_URL="${DATABASE_URL#\'}"
	fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
	echo "Error: DATABASE_URL no esta definida."
	echo "Define DATABASE_URL en el entorno o en $ENV_FILE para ejecutar prisma:generate:org durante el build."
	exit 1
fi

echo "Building $LOCAL_IMAGE"
docker build \
	--build-arg DATABASE_URL="$DATABASE_URL" \
	-t "$LOCAL_IMAGE" \
	-f "$DOCKERFILE_PATH" \
	"$REPO_ROOT"

echo "Local image created: $LOCAL_IMAGE"
