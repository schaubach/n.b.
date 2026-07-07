# n.b. Mail-Backend

Dieses Verzeichnis enthaelt ein unabhaengig installierbares Mail-Backend fuer n.b. Es laeuft auf einem Ubuntu-Server mit Docker Compose und stellt zwei Dinge bereit:

- HTTPS-API fuer den Mailversand unter `https://SERVER_IP:8123/api/send-gradebook`
- geschuetzte Auslieferung der WebApp unter `https://SERVER_IP:8123/installwebapp/`

Das Python-Backend laeuft intern per HTTP. Nginx terminiert TLS auf Port `8123` und leitet API-Requests intern weiter.

## Sicherheitsmodell

- HTTPS/TLS schuetzt den Transportweg.
- Jeder API-Request wird mit HMAC-SHA256 signiert.
- Die Signatur wird aus `timestamp.nonce.body` gebildet.
- Das Backend prueft Signatur, Zeitfenster, Nonce-Replay, Request-Format, Domains und Rate-Limits.
- Sender und Empfaenger muessen zur Domain `@rbbk-do.de` gehoeren.
- Optional kann `ALLOWED_SENDERS` gesetzt werden. Dann werden nur diese Lehrenden-Mailadressen als Absender akzeptiert.
- SMTP-Zugangsdaten werden nicht im Backend gespeichert. Die WebApp sendet Mailadresse und IServ-Passwort nur ueber HTTPS und HMAC-signiert an das Backend.
- Der Pre-Shared-Key steht in `.env` und in `webapp/mail-backend-config.json`. Beide Dateien werden nicht versioniert.
- Die WebApp prueft vor dem Versand eine signierte Backend-Identitaet. Der private Schluessel liegt nur unter `identity/private.pem`, der Public Key wird in `mail-backend-config.json` ausgeliefert.

Personen mit Zugriff auf die ausgelieferte WebApp-Konfiguration koennen den Pre-Shared-Key grundsaetzlich auslesen. Dieses Restrisiko passt nur zu einer kontrollierten Verteilung an wenige vertrauenswuerdige Nutzer.

## Installation auf Ubuntu

~~~bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin openssl
sudo usermod -aG docker "$USER"
~~~

Danach neu anmelden oder die Gruppe aktualisieren.

## Setup

~~~bash
cd mail-backend
cp .env.example .env
nano .env
sh scripts/setup.sh
~~~

In `.env` setzen:

- `SERVER_NAME`: IP-Adresse oder DNS-Name des Servers, z. B. `10.97.12.34`
- `INSTALL_USER`: Benutzer fuer `/installwebapp`
- `INSTALL_PASSWORD`: Passwort fuer `/installwebapp`
- `NB_MAIL_PSK`: leer lassen, wenn `scripts/setup.sh` einen Schluessel erzeugen soll
- `ALLOWED_SENDERS`: empfohlene kommaseparierte Liste der erlaubten Lehrenden-Mailadressen, z. B. `lehrkraft1@rbbk-do.de`

Das im Auftrag genannte Installationspasswort gehoert in die lokale `.env`, nicht ins Repository.

## WebApp bereitstellen

Im Repository zuerst den WebApp-Build erstellen:

~~~bash
cd ../frontend
npm install
npm run build
cd ../mail-backend
sh scripts/sync-webapp.sh
~~~

`scripts/setup.sh` erzeugt `webapp/mail-backend-config.json` mit dem Pre-Shared-Key und dem Public Key der Backend-Identitaet. Diese Datei muss zusammen mit der WebApp ausgeliefert werden, wird aber nicht committed.

## Start

~~~bash
docker compose up -d --build
docker compose logs -f
~~~

Healthcheck:

~~~bash
curl -k https://SERVER_IP:8123/health
~~~

Installationsseite:

~~~text
https://SERVER_IP:8123/installwebapp/
~~~

Der Zugriff ist serverseitig per Nginx Basic Auth geschuetzt. Das Passwort liegt nicht im HTML und ist nicht per DevTools auslesbar.

## Zertifikat

`scripts/setup.sh` erzeugt ein selbstsigniertes Zertifikat:

~~~text
mail-backend/certs/server.crt
mail-backend/certs/server.key
~~~

Damit iPads die HTTPS-Verbindung akzeptieren, muss `server.crt` einmalig als vertrauenswuerdiges Zertifikat installiert werden. Das kann die nutzende Person selbst tun:

1. In Safari `https://SERVER_IP:8123/ca.crt` oeffnen.
2. Das Zertifikatsprofil laden.
3. In den iPad-Einstellungen das geladene Profil installieren.
4. Unter `Allgemein` -> `Info` -> `Zertifikatsvertrauenseinstellungen` das Zertifikat voll vertrauen.

Die genaue Bezeichnung kann je nach iPadOS-Version leicht abweichen. Nach dieser einmaligen Einrichtung erscheint beim Mailversand keine Zertifikatsabfrage. Alternativ kann ein intern vertrauenswuerdiges Zertifikat verwendet und als `certs/server.crt` / `certs/server.key` abgelegt werden.

## Firewall

Port `8123` sollte nur fuer das Schulnetz oder bekannte Geraete erreichbar sein, z. B. mit UFW:

~~~bash
sudo ufw allow from 10.97.0.0/16 to any port 8123 proto tcp
sudo ufw enable
sudo ufw status
~~~

## WebApp konfigurieren

In der WebApp muss in der Lehrendenkonfiguration die IP-Adresse des Mail-Backends eingetragen werden. Der Port ist fest `8123`.

Die WebApp liest den Pre-Shared-Key aus:

~~~text
mail-backend-config.json
~~~

Diese Datei wird von `scripts/setup.sh` in `mail-backend/webapp` erstellt. Fuer Entwicklungsbuilds kann die Datei lokal nach `frontend/public/mail-backend-config.json` kopiert werden. Diese Datei ist gitignored und darf nicht ins Repository. Beim Mailversand prueft die WebApp zuerst `https://SERVER_IP:8123/api/identity` mit einem Challenge-Response-Verfahren. Erst danach wird der eigentliche Versandrequest erzeugt.

## SMTP

Die SMTP-Konfiguration liegt serverseitig in `.env`:

~~~text
SMTP_HOST=rbbk-do.de
SMTP_PORT=587
SMTP_STARTTLS=true
ALLOWED_DOMAIN=rbbk-do.de
ALLOWED_SENDERS=lehrkraft1@rbbk-do.de,lehrkraft2@rbbk-do.de
~~~

Die WebApp uebermittelt pro Versand die Lehrenden-Mailadresse und das IServ-Passwort ueber HTTPS an das Backend. Das Backend meldet sich damit am SMTP-Server an.

## Logs

Das Backend protokolliert:

- abgelehnte Requests mit Grund,
- fehlgeschlagene Authentifizierung,
- Versandzeitpunkt, Empfaenger, Betreff und Versandstatus.

Nachrichtentexte werden nicht protokolliert.
