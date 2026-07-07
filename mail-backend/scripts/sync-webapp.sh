#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -d ../frontend/build ]; then
  echo "frontend/build fehlt. Bitte zuerst im Ordner frontend 'npm run build' ausfuehren." >&2
  exit 1
fi

mkdir -p webapp
find webapp -mindepth 1 ! -name mail-backend-config.json ! -name .gitkeep -exec rm -rf {} +
cp -R ../frontend/build/. webapp/

if [ ! -f webapp/mail-backend-config.json ]; then
  echo "Hinweis: webapp/mail-backend-config.json fehlt. Bitte scripts/setup.sh ausfuehren." >&2
fi

echo "WebApp wurde nach mail-backend/webapp kopiert."
