#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="${IMAGE_NAME:-service-measurement}"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
	read -r -p "Version tag (ej: 1.0.0): " VERSION
fi

if [[ -z "$VERSION" ]]; then
	echo "Error: version vacia."
	exit 1
fi

GITHUB_LOGIN="${GITHUB_LOGIN:-}"
if [[ -z "$GITHUB_LOGIN" ]]; then
	read -r -p "GitHub login/usuario: " GITHUB_LOGIN
fi

if [[ -z "$GITHUB_LOGIN" ]]; then
	echo "Error: login de GitHub vacio."
	exit 1
fi

LOCAL_IMAGE="$IMAGE_NAME:$VERSION"
GHCR_IMAGE="ghcr.io/$GITHUB_LOGIN/$IMAGE_NAME:$VERSION"

if ! docker image inspect "$LOCAL_IMAGE" >/dev/null 2>&1; then
	echo "Local image not found: $LOCAL_IMAGE"
	echo "Creating local image first..."
	"$SCRIPT_DIR/image-local.sh" "$VERSION"
fi

echo "Login to GHCR as $GITHUB_LOGIN"
echo "Usa un GitHub Personal Access Token con scope write:packages cuando Docker lo pida como password."
docker login ghcr.io -u "$GITHUB_LOGIN"

echo "Tagging $LOCAL_IMAGE as $GHCR_IMAGE"
docker tag "$LOCAL_IMAGE" "$GHCR_IMAGE"

echo "Pushing $GHCR_IMAGE"
docker push "$GHCR_IMAGE"

echo "Done: $GHCR_IMAGE"
