#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
fi

get_env() {
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true
}

set_env() {
  key="$1"
  value="$2"
  if grep -qE "^$key=" .env; then
    sed -i "s|^$key=.*|$key=$value|" .env
  else
    printf "\n%s=%s\n" "$key" "$value" >> .env
  fi
}

if [ -z "$(get_env NB_MAIL_PSK)" ]; then
  set_env NB_MAIL_PSK "$(openssl rand -base64 48)"
fi

SERVER_NAME="$(get_env SERVER_NAME)"
if [ -z "$SERVER_NAME" ]; then
  SERVER_NAME="${1:-10.97.0.10}"
  set_env SERVER_NAME "$SERVER_NAME"
fi

INSTALL_USER="$(get_env INSTALL_USER)"
INSTALL_USER="${INSTALL_USER:-install}"
set_env INSTALL_USER "$INSTALL_USER"

INSTALL_PASSWORD="$(get_env INSTALL_PASSWORD)"
if [ -z "$INSTALL_PASSWORD" ]; then
  printf "Install-Passwort fuer /installwebapp eingeben: " >&2
  stty -echo
  read INSTALL_PASSWORD
  stty echo
  printf "\n" >&2
  set_env INSTALL_PASSWORD "$INSTALL_PASSWORD"
fi

mkdir -p certs nginx/auth webapp

SAN_PREFIX="DNS"
case "$SERVER_NAME" in
  *[!0-9.]* ) SAN_PREFIX="DNS" ;;
  * ) SAN_PREFIX="IP" ;;
esac

if [ ! -f certs/server.key ] || [ ! -f certs/server.crt ]; then
  openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
    -keyout certs/server.key \
    -out certs/server.crt \
    -subj "/CN=$SERVER_NAME" \
    -addext "subjectAltName=$SAN_PREFIX:$SERVER_NAME,DNS:localhost"
  chmod 600 certs/server.key
fi

HASH="$(openssl passwd -apr1 "$INSTALL_PASSWORD")"
printf "%s:%s\n" "$INSTALL_USER" "$HASH" > nginx/auth/.htpasswd
chmod 600 nginx/auth/.htpasswd

PSK="$(get_env NB_MAIL_PSK)"
cat > webapp/mail-backend-config.json <<EOF
{
  "preSharedKey": "$PSK"
}
EOF
chmod 600 webapp/mail-backend-config.json

cat <<EOF
Setup fertig.

- Zertifikat: mail-backend/certs/server.crt
- WebApp-Config: mail-backend/webapp/mail-backend-config.json
- Install-URL: https://$SERVER_NAME:8123/installwebapp/
- API-URL: https://$SERVER_NAME:8123/api/send-gradebook

Kopiere vor dem Start den Inhalt von frontend/build nach mail-backend/webapp.
EOF
