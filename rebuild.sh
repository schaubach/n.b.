#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/mail-backend"
SERVER_NAME="${1:-}"

usage() {
  cat <<'EOF'
Verwendung:
  ./rebuild.sh [SERVER_NAME]

Beispiele:
  ./rebuild.sh
  ./rebuild.sh 10.97.12.34

Ohne SERVER_NAME verwendet setup.sh den bestehenden Wert aus mail-backend/.env.
EOF
}

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

if [ "$SERVER_NAME" = "-h" ] || [ "$SERVER_NAME" = "--help" ]; then
  usage
  exit 0
fi

fail() {
  printf '\nFehler in Zeile %s. Der Neuaufbau wurde abgebrochen.\n' "$1" >&2
}
trap 'fail "$LINENO"' ERR

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Fehlendes Programm: %s\n' "$1" >&2
    exit 1
  fi
}

require_command npm
require_command docker
require_command openssl

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose Plugin fehlt. Bitte docker-compose-plugin installieren." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker ist nicht erreichbar. Bitte Docker starten und die Benutzerrechte pruefen." >&2
  exit 1
fi

if [ ! -f "$FRONTEND_DIR/package.json" ] || [ ! -f "$FRONTEND_DIR/package-lock.json" ]; then
  echo "frontend/package.json oder frontend/package-lock.json fehlt." >&2
  exit 1
fi

if [ ! -f "$BACKEND_DIR/docker-compose.yml" ]; then
  echo "mail-backend/docker-compose.yml fehlt." >&2
  exit 1
fi

echo "[1/5] Frontend-Abhaengigkeiten installieren"
(
  cd "$FRONTEND_DIR"
  npm ci --no-audit --no-fund
)

echo "[2/5] Frontend neu bauen"
(
  cd "$FRONTEND_DIR"
  npm run build
)

echo "[3/5] Mail-Backend konfigurieren"
if [ -n "$SERVER_NAME" ]; then
  (
    cd "$BACKEND_DIR"
    sh scripts/setup.sh "$SERVER_NAME"
  )
else
  (
    cd "$BACKEND_DIR"
    sh scripts/setup.sh
  )
fi

echo "[4/5] WebApp-Build mit dem Mail-Backend synchronisieren"
(
  cd "$BACKEND_DIR"
  sh scripts/sync-webapp.sh
)

echo "[5/5] Container neu bauen und im Hintergrund starten"
(
  cd "$BACKEND_DIR"
  docker compose up -d --build
)

echo
echo "Container-Status:"
(
  cd "$BACKEND_DIR"
  docker compose ps
)

echo
echo "Neuaufbau erfolgreich abgeschlossen."
