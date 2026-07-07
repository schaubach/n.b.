#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -d ../frontend/build ]; then
  echo "frontend/build fehlt. Bitte zuerst im Ordner frontend 'npm run build' ausfuehren." >&2
  exit 1
fi

mkdir -p webapp
CONFIG_TMP=""
CONFIG_PRESENT=0
if [ -f webapp/mail-backend-config.json ]; then
  CONFIG_TMP="$(mktemp)"
  cp webapp/mail-backend-config.json "$CONFIG_TMP"
  CONFIG_PRESENT=1
fi
cleanup() {
  if [ -n "$CONFIG_TMP" ] && [ -f "$CONFIG_TMP" ]; then
    rm -f "$CONFIG_TMP"
  fi
}
trap cleanup EXIT

find webapp -mindepth 1 ! -name mail-backend-config.json ! -name .gitkeep -exec rm -rf {} +
cp -R ../frontend/build/. webapp/
if [ "$CONFIG_PRESENT" -eq 1 ]; then
  cp "$CONFIG_TMP" webapp/mail-backend-config.json
else
  rm -f webapp/mail-backend-config.json
fi
# Static files are served by nginx from a read-only bind mount. Make them
# readable regardless of the server user umask.
chmod -R a+rX webapp

if [ ! -f webapp/mail-backend-config.json ]; then
  echo "Hinweis: webapp/mail-backend-config.json fehlt. Bitte scripts/setup.sh ausfuehren." >&2
fi

echo "WebApp wurde nach mail-backend/webapp kopiert."
