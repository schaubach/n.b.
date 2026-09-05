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

SERVER_NAME_ARG="${1:-}"
if [ -n "$SERVER_NAME_ARG" ]; then
  SERVER_NAME="$SERVER_NAME_ARG"
  set_env SERVER_NAME "$SERVER_NAME"
else
  SERVER_NAME="$(get_env SERVER_NAME)"
  if [ -z "$SERVER_NAME" ]; then
    SERVER_NAME="10.97.0.10"
    set_env SERVER_NAME "$SERVER_NAME"
  fi
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

mkdir -p certs nginx/auth webapp identity
chmod 755 certs nginx nginx/auth webapp identity

SAN_PREFIX="DNS"
case "$SERVER_NAME" in
  *[!0-9.]* ) SAN_PREFIX="DNS" ;;
  * ) SAN_PREFIX="IP" ;;
esac

cert_matches_server_name() {
  if [ ! -f certs/server.crt ]; then
    return 1
  fi
  SAN="$(openssl x509 -in certs/server.crt -noout -ext subjectAltName 2>/dev/null || true)"
  if [ "$SAN_PREFIX" = "IP" ]; then
    printf "%s" "$SAN" | grep -F "IP Address:$SERVER_NAME" >/dev/null 2>&1
  else
    printf "%s" "$SAN" | grep -F "DNS:$SERVER_NAME" >/dev/null 2>&1
  fi
}

if [ ! -f certs/server.key ] || [ ! -f certs/server.crt ] || ! cert_matches_server_name; then
  if [ -f certs/server.crt ]; then
    echo "Hinweis: Zertifikat wird fuer SERVER_NAME=$SERVER_NAME neu erzeugt." >&2
  fi
  openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
    -keyout certs/server.key \
    -out certs/server.crt \
    -subj "/CN=$SERVER_NAME" \
    -addext "subjectAltName=$SAN_PREFIX:$SERVER_NAME,DNS:localhost"
  chmod 600 certs/server.key
fi

HASH="$(openssl passwd -apr1 "$INSTALL_PASSWORD")"
printf "%s:%s\n" "$INSTALL_USER" "$HASH" > nginx/auth/.htpasswd
# The file is mounted read-only into the nginx container. It must be readable
# by nginx workers whose UID does not match the host user that ran setup.sh.
chmod 644 nginx/auth/.htpasswd

if [ ! -f identity/private.pem ] || [ ! -f identity/public.pem ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out identity/private.pem
  openssl rsa -in identity/private.pem -pubout -out identity/public.pem
  chmod 600 identity/private.pem
fi

PSK="$(get_env NB_MAIL_PSK)"
PUBLIC_KEY_JSON="$(awk 'BEGIN { printf "\""} { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); printf "%s\\n", $0 } END { printf "\""}' identity/public.pem)"
cat > webapp/mail-backend-config.json <<EOF
{
  "preSharedKey": "$PSK",
  "backendIdentityPublicKey": $PUBLIC_KEY_JSON
}
EOF
# This config is intentionally shipped with the WebApp and must be readable by nginx.
chmod 644 webapp/mail-backend-config.json

cat <<EOF
Setup fertig.

- Zertifikat: mail-backend/certs/server.crt
- Backend-Identitaet: mail-backend/identity/public.pem
- WebApp-Config: mail-backend/webapp/mail-backend-config.json
- Install-URL: https://$SERVER_NAME:8123/installwebapp/
- API-URL: https://$SERVER_NAME:8123/api/send-gradebook

Kopiere vor dem Start den Inhalt von frontend/build nach mail-backend/webapp.
EOF
