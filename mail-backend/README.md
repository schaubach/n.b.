# n.b. Mail-Backend

Dieses Verzeichnis enthaelt ein unabhaengig installierbares Mail-Backend fuer n.b. Es laeuft auf einem Ubuntu-Server mit Docker Compose und stellt zwei Dinge bereit:

- HTTPS-API fuer den Mailversand unter `https://SERVER_IP:8123/api/send-gradebook`
- Versand passwortgeschuetzter ZIP-Backup-Anhaenge an die konfigurierte Lehrendenadresse
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
- Backup-Anhaenge werden bereits in der WebApp als passwortgeschuetztes Standard-ZIP mit dem gespeicherten IServ-Passwort erstellt; das Backend leitet sie nur als Mailanhang weiter.
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
sh scripts/setup.sh 10.97.12.34
~~~

Der optionale Parameter ist die IP-Adresse oder der DNS-Name, unter dem die iPads das Backend aufrufen. Wenn er angegeben wird, schreibt `setup.sh` ihn nach `.env` in `SERVER_NAME`.

In `.env` setzen:

- `SERVER_NAME`: IP-Adresse oder DNS-Name des Servers, z. B. `10.97.12.34`
- `INSTALL_USER`: Benutzer fuer `/installwebapp`
- `INSTALL_PASSWORD`: Passwort fuer `/installwebapp`
- `NB_MAIL_PSK`: leer lassen, wenn `scripts/setup.sh` einen Schluessel erzeugen soll
- `ALLOWED_SENDERS`: optionale kommaseparierte Liste der erlaubten Lehrenden-Mailadressen. Zum Aktivieren Kommentarzeichen in `.env` entfernen.

Das im Auftrag genannte Installationspasswort gehoert in die lokale `.env`, nicht ins Repository.

## Konfigurationsdateien

### `mail-backend/.env.example`

Diese Datei ist die versionierte Vorlage. Sie wird einmal kopiert:

~~~bash
cp .env.example .env
~~~

Die Vorlage enthaelt nur Platzhalter oder harmlose Beispielwerte. Echte Passwoerter und erzeugte Secrets gehoeren nicht in diese Datei.

### `mail-backend/.env`

Diese Datei ist die lokale Konfiguration des Mail-Backends und wird nicht committed. Bearbeiten:

~~~bash
nano .env
~~~

Pflichtwerte:

- `SERVER_NAME`: IP-Adresse oder DNS-Name, mit dem die iPads das Backend aufrufen, z. B. `10.97.12.34`. Dieser Wert wird fuer Zertifikat, Installations-URL und Backend-Identitaet genutzt.
- `INSTALL_USER`: Benutzername fuer `https://SERVER_IP:8123/installwebapp/`.
- `INSTALL_PASSWORD`: starkes Passwort fuer `/installwebapp/`.
- `SMTP_HOST`: SMTP-Server, hier `rbbk-do.de`.
- `SMTP_PORT`: SMTP-Port, hier `587`.
- `SMTP_STARTTLS`: `true` fuer STARTTLS.
- `ALLOWED_DOMAIN`: erlaubte Maildomain fuer Absender und Empfaenger, hier `rbbk-do.de`.

Empfohlene Werte:

- `ALLOWED_SENDERS`: kommaseparierte Liste erlaubter Lehrenden-Mailadressen. Zum Aktivieren Kommentarzeichen in `.env` entfernen, z. B. `ALLOWED_SENDERS=lehrkraft1@rbbk-do.de,lehrkraft2@rbbk-do.de`. Leer oder auskommentiert bedeutet: alle Absender aus `ALLOWED_DOMAIN` sind erlaubt.
- `NB_MAIL_PSK`: leer lassen, wenn `scripts/setup.sh` den HMAC-Schluessel erzeugen soll. Nur bei geplanter Rotation oder Wiederherstellung manuell setzen.

Feinschutz und Grenzwerte:

- `MAX_RECIPIENTS_PER_REQUEST`: maximale Anzahl Mails in einem Versandrequest.
- `MAX_MESSAGE_BYTES`: maximale Groesse pro Nachricht inklusive Backup-Anhang. Der Standard ist `12000000`, passend fuer mehrere Klassen mit verkleinerten Fotos.
- `MAX_SUBJECT_LENGTH`: maximale Betrefflaenge.
- `TIMESTAMP_WINDOW_SECONDS`: erlaubte Zeitabweichung fuer signierte Requests.
- `NONCE_TTL_SECONDS`: Speicherzeit fuer verwendete Nonces gegen Replay.
- `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_HOUR`, `RATE_LIMIT_PER_DAY`: serverseitige Versandlimits.
- `ALLOWED_ORIGINS`: nur fuer Entwicklung noetig, wenn die WebApp nicht von demselben Nginx-Origin kommt. In Produktion normalerweise leer lassen.

Bei HTTP 500 nach erfolgreicher Basic-Auth und Logzeilen wie `open() "/etc/nginx/auth/.htpasswd" failed (13: Permission denied)` bitte `sh scripts/setup.sh` erneut ausfuehren. Das Skript setzt die fuer den Nginx-Container notwendigen Leserechte auf `nginx/auth/.htpasswd` und `webapp/`.

Wenn `SERVER_NAME` per Parameter oder `.env` geaendert wird, prueft `setup.sh` das bestehende Zertifikat. Passt der Subject Alternative Name nicht mehr zum aktuellen `SERVER_NAME`, wird das Zertifikat automatisch neu erzeugt. Dieses neue Zertifikat muss auf den iPads wieder als vertrauenswuerdig installiert werden.

Nach jeder relevanten Aenderung:

~~~bash
sh scripts/setup.sh
docker compose up -d --build
~~~

Wenn sich `NB_MAIL_PSK`, Zertifikat oder Backend-Identitaet geaendert haben, danach auch die WebApp neu synchronisieren:

~~~bash
sh scripts/sync-webapp.sh
~~~

`sync-webapp.sh` bewahrt die von `setup.sh` erzeugte `webapp/mail-backend-config.json`. Eine versehentlich im Frontend-Build enthaltene `mail-backend-config.json` ueberschreibt diese Server-Konfiguration nicht.

### `mail-backend/webapp/mail-backend-config.json`

Diese Datei wird automatisch von `scripts/setup.sh` erzeugt und enthaelt:

~~~json
{
  "preSharedKey": "automatisch erzeugter HMAC-Schluessel",
  "backendIdentityPublicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----\\n"
}
~~~

Sie muss zusammen mit dem WebApp-Build unter `/installwebapp/` ausgeliefert werden, wird aber nicht committed. Nicht per Hand bearbeiten; stattdessen `.env` bzw. `identity/` korrigieren und `scripts/setup.sh` erneut ausfuehren.

Fuer lokale Frontend-Entwicklung kann diese Datei nach `frontend/public/mail-backend-config.json` kopiert werden. Diese Entwicklungsdatei ist ebenfalls gitignored.

### `mail-backend/identity/private.pem` und `public.pem`

`scripts/setup.sh` erzeugt diese Dateien automatisch. `private.pem` bleibt ausschliesslich auf dem Server. `public.pem` wird in `mail-backend-config.json` eingetragen, damit die WebApp die Backend-Identitaet pruefen kann.

Bei Verdacht auf Zugriff auf die ausgelieferte WebApp-Konfiguration oder den privaten Schluessel:

1. `NB_MAIL_PSK` in `.env` leeren oder neu setzen.
2. `identity/private.pem` und `identity/public.pem` lokal entfernen.
3. `sh scripts/setup.sh` ausfuehren.
4. `sh scripts/sync-webapp.sh` ausfuehren.
5. WebApp auf den iPads neu laden.

### Lehrendenkonfiguration in der WebApp

In der App selbst wird unter der Lehrendenkonfiguration eingetragen:

- Name inkl. Bezeichnung,
- Mailadresse der Lehrkraft,
- IServPasswort,
- IP-Adresse oder DNS-Name des Mail-Backends ohne Port, z. B. `10.97.12.34`.

Port `8123` und `https://` setzt die WebApp automatisch. Die Werte werden lokal verschluesselt gespeichert. Die App prueft in dieser Ansicht per Healthcheck, ob das Mail-Backend erreichbar und das Zertifikat vertrauenswuerdig ist. Dort liegen auch die Funktionen `Backup` und `Import Backup`; Backups werden als passwortgeschuetztes Standard-ZIP mit CSV-Daten und Bildern erstellt und koennen mit dem IServ-Passwort in kompatiblen ZIP-Tools geoeffnet werden.

## WebApp bereitstellen

Im Repository zuerst den WebApp-Build erstellen:

~~~bash
cd ../frontend
npm install
npm run build
cd ../mail-backend
sh scripts/sync-webapp.sh
~~~

`scripts/setup.sh` erzeugt `webapp/mail-backend-config.json` mit dem Pre-Shared-Key und dem Public Key der Backend-Identitaet. Diese Datei muss zusammen mit der WebApp ausgeliefert werden, wird aber nicht committed. Eine neue WebApp-Version ueber /installwebapp/ ersetzt App-Dateien und Offline-Cache, loescht aber nicht die verschluesselte IndexedDB der installierten WebApp. Noten und Punkte bleiben erhalten, solange Protokoll, Host, Port und Pfad gleich bleiben.

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

Diese Datei wird von `scripts/setup.sh` in `mail-backend/webapp` erstellt. Fuer Entwicklungsbuilds kann die Datei lokal nach `frontend/public/mail-backend-config.json` kopiert werden. Diese Datei ist gitignored und darf nicht ins Repository. Beim Mailversand prueft die WebApp zuerst `https://SERVER_IP:8123/health`. Nur wenn der Healthcheck erreichbar ist, prueft sie danach `https://SERVER_IP:8123/api/identity` mit einem Challenge-Response-Verfahren. Erst danach wird der eigentliche Versandrequest erzeugt.

## SMTP

Die SMTP-Konfiguration liegt serverseitig in `.env`:

~~~text
SMTP_HOST=rbbk-do.de
SMTP_PORT=587
SMTP_STARTTLS=true
ALLOWED_DOMAIN=rbbk-do.de
# ALLOWED_SENDERS=lehrkraft1@rbbk-do.de,lehrkraft2@rbbk-do.de
~~~

Die WebApp uebermittelt pro Versand die Lehrenden-Mailadresse und das IServ-Passwort ueber HTTPS an das Backend. Die Lehrenden-Mailadresse bleibt der Absender (`From`). Fuer die SMTP-Anmeldung versucht das Backend zuerst den Accountnamen vor `@`, z. B. `pillekeit`, und danach die vollstaendige Mailadresse. Fehlgeschlagene SMTP-Anmeldungen nennen Host, Port, STARTTLS, die versuchten Logins und die SMTP-Serverantwort, aber nie das Passwort.

## Logs

Das Backend protokolliert:

- abgelehnte Requests mit Grund,
- fehlgeschlagene Authentifizierung,
- Versandzeitpunkt, Empfaenger, Betreff und Versandstatus.

Nachrichtentexte werden nicht protokolliert.
