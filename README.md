# n.b.

n.b. ist eine lokale WebApp fuer schnelle Notenvergabe und Notenstandspflege im Unterricht. Die App laeuft als statischer React-Build im Browser, speichert alle Daten verschluesselt lokal und braucht im normalen Betrieb kein Backend, keine Datenbank auf einem Server und keine externe Internetverbindung.

## Aktuelle Funktionen

### Klassenimport

- Klassen werden per CSV importiert, zum Beispiel aus IServ.
- Erwartete Spalten sind mindestens `Gruppe`, `Nachname` und `Vorname`.
- Wenn eine Spalte `Account` vorhanden ist, wird daraus intern die Mailadresse `<Account>@rbbk-do.de` gebildet.
- Jede `Gruppe` wird als eigene Klasse angelegt oder bei erneutem Import aktualisiert.
- Vorhandene Fotos, Noten und Bewertungen bleiben beim Re-Import erhalten.
- Beim Import einer neuen Klasse werden Notensystem und Standard-Notenskala ausgewaehlt.

Beispiel:

```csv
Gruppe;Nachname;Vorname;Account
KlasseA;Nachname1;Vorname1;account1
KlasseA;Nachname2;Vorname2;account2
```

### Fotos

- In jeder Klassenkachel gibt es eine Foto-Funktion.
- Auf kompatiblen Geraeten kann direkt die Kamera genutzt werden.
- Fotos werden lokal verkleinert und am jeweiligen Lernenden-Datensatz gespeichert.
- Wird eine Klasse geloescht, werden auch Namen, Fotos, Bewertungen, Noten, Notenstand-Overrides und Punkte-Daten dieser Klasse entfernt.

### Bewertungen

- Pro Klasse koennen Sonstige Leistungen und Klassenarbeiten/Klausuren angelegt werden.
- Sonstige Leistungen koennen als muendlich oder schriftlich markiert werden.
- Das Notensystem kann `1-6` oder `0-15 Punkte` sein.
- Bei `1-6` werden Klassenarbeitsnoten ganzzahlig behandelt.
- Bei `0-15 Punkte` heissen Klausuren in der Oberflaeche `Klausur` bzw. `KL`.
- Noten koennen im Bewertungsmodus schnell ueber die Kacheloberflaeche vergeben und spaeter im Notenstand angepasst werden.

### Punkte -> Noten

- Fuer schriftliche SL und Klassenarbeiten/Klausuren kann eine Punkte-zu-Noten-Bewertung genutzt werden.
- Pro Bewertung lassen sich Aufgaben-/Punktespalten anlegen.
- Die App berechnet erreichte Punkte, Prozentwert, Note und den Abstand zur naechstbesseren Note.
- Bei knappen Grenzen wird sichtbar hervorgehoben, wenn nur wenig zur besseren Note fehlt.
- Die verwendete Notenskala kann fuer eine einzelne Bewertung lokal angepasst werden.
- Die berechnete Note wird in den Notenstand uebernommen und kann dort manuell ueberschrieben werden; die berechnete Note bleibt sichtbar.

### Notenskalen

- Vordefinierte und importierte Notenskalen liegen im App-Ordner `frontend/public/notenskala`.
- In der App koennen Notenskalen importiert, neu angelegt, umbenannt und geloescht werden.
- In der Skalenansicht sind Note und Punkte fest gekoppelt; bearbeitet werden die Prozentgrenzen.
- Bestehende Bewertungen uebernehmen Aenderungen an globalen Skalen nicht automatisch.
- Lokale Skalenanpassungen in einer Punkte-zu-Noten-Bewertung gelten nur fuer diese Bewertung.

### Notenstand

- Der Notenstand zeigt eine tabellarische Uebersicht pro Klasse.
- Namen und Spaltenueberschriften bleiben beim Scrollen sichtbar.
- KA/KL-Spalten stehen links, SL-Spalten rechts; Durchschnitts- und Endnotenspalten bleiben am rechten Tabellenende.
- Noten sind farbcodiert.
- Durchschnitte koennen manuell ueberschrieben oder wieder auf automatische Berechnung zurueckgesetzt werden.
- `SL gesamt` wird aus den angezeigten ganzen Werten von `SL muendl.` und `SL schrftl.` berechnet.
- Die Endnote wird aus gerundeter SL-Gesamtnote und gerundeter KA/KL-Gesamtnote gebildet.
- Export als CSV und Druckansicht sind vorhanden.

### Mailvorbereitung

- Die Lehrendenkonfiguration speichert Name, Mailadresse und Passwort lokal verschluesselt.
- In der Notenstandansicht koennen Mails fuer einzelne Lernende oder die ganze Klasse vorbereitet werden.
- Jede Mail enthaelt nur die Noten des jeweiligen Lernenden.
- Der direkte SMTP-Versand aus einer reinen Browser-/iPad-WebApp ist durch Browser-Sicherheitsregeln nicht verlaesslich moeglich. Fuer echten Versand braucht es eine native Mail-Bridge oder einen lokalen Backend-Prozess im Schulnetz.

### Lokale Daten und Verschluesselung

- Beim ersten Start wird ein lokaler Tresor mit Passwort erstellt.
- Das Passwort wird nicht gespeichert.
- Daten liegen in IndexedDB und werden vor dem Schreiben mit WebCrypto verschluesselt.
- Schluesselableitung: PBKDF2 mit SHA-256.
- Datenverschluesselung: AES-GCM.
- Externe Ressourcen und externe Verbindungen sind durch die Content-Security-Policy blockiert.

## Entwicklung

Voraussetzung: Node.js und npm.

```bash
cd frontend
npm install
npm test -- --watchAll=false
npm run build
```

Der fertige statische Build liegt danach in:

```text
frontend/build
```

## Wie bringe ich die WebApp auf mein iPad

Kurzfassung: Das iPad braucht keine zusaetzliche App. Die WebApp muss aber einmal ueber eine Webadresse in Safari geoeffnet werden, damit Safari sie als Home-Screen-App mit Offline-Cache speichern kann. Ein direkt kopierter `file://`-Ordner reicht dafuer nicht, weil Service Worker und PWA-Offline-Funktionen dort nicht sauber laufen.

### Empfohlener Weg

1. Auf dem Entwicklungsrechner den Produktionsbuild erstellen:

```bash
cd frontend
npm install
npm run build
```

2. Den Ordner `frontend/build` auf einen HTTPS-Webserver legen.

Das kann ein interner Schulserver, ein lokaler Server mit vertrauenswuerdigem Zertifikat oder ein anderer kontrollierter HTTPS-Ablageort sein. Wichtig ist: Safari auf dem iPad muss die Seite ueber `https://...` oeffnen koennen.

3. Auf dem iPad Safari oeffnen und die Webadresse der App aufrufen.

4. Einmal warten, bis die App vollstaendig geladen ist.

5. In Safari `Teilen` -> `Zum Home-Bildschirm` auswaehlen.

6. Die App ueber das neue Home-Screen-Symbol starten.

Nach dem ersten erfolgreichen Start liegen App-Dateien und Daten lokal auf dem iPad. Danach kann die App ohne Internetverbindung genutzt werden. Neue App-Versionen muessen wieder ueber die Webadresse geladen werden.

### Warum nicht einfach per Datei kopieren?

iPadOS behandelt lokal kopierte HTML-Dateien anders als installierte WebApps. Kamera, IndexedDB, Service Worker, Offline-Cache und Home-Screen-Verhalten sind ueber `file://` eingeschraenkt oder nicht verlaesslich. Fuer eine robuste Offline-App ist deshalb der einmalige Start ueber Safari und eine Webadresse notwendig.

### Lokaler Server im Schulnetz

Wenn die App nur im Schulnetz verteilt werden soll, ist ein interner HTTPS-Webserver ideal:

- `frontend/build` auf den Server kopieren.
- Die URL intern bekannt machen.
- Die App einmal auf jedem iPad in Safari oeffnen.
- Danach `Zum Home-Bildschirm` verwenden.

Die Noten- und Fotodaten verlassen dabei nicht das jeweilige iPad; der Server liefert nur die App-Dateien aus.

## Mail-Backend

Das optionale Mail-Backend liegt in `mail-backend/`. Es ist nur fuer den echten Mailversand noetig. Die normale WebApp bleibt lokal und kann ohne Mail-Backend genutzt werden.

Das Backend wird auf einem Ubuntu-Server im Schulnetz betrieben. Nginx terminiert HTTPS auf Port `8123`, schuetzt die Installationsseite mit Basic Auth, prueft HMAC-signierte API-Requests und leitet den Versand ueber SMTP/STARTTLS an IServ weiter.

### Installation auf Ubuntu

1. Docker und OpenSSL installieren:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin openssl
sudo usermod -aG docker "$USER"
```

Danach einmal neu anmelden, damit die Docker-Gruppe aktiv ist.

2. Konfiguration anlegen:

```bash
cd mail-backend
cp .env.example .env
nano .env
```

Wichtige Werte in `.env`:

```text
SERVER_NAME=10.97.0.10
INSTALL_USER=install
INSTALL_PASSWORD=
ALLOWED_DOMAIN=rbbk-do.de
ALLOWED_SENDERS=lehrkraft1@rbbk-do.de,lehrkraft2@rbbk-do.de
```

`INSTALL_PASSWORD` und `NB_MAIL_PSK` gehoeren nur in die lokale `.env` und nie ins Repository. `ALLOWED_SENDERS` ist empfohlen: Wenn die Liste gesetzt ist, akzeptiert das Backend nur diese Lehrenden-Mailadressen als Absender. Wenn sie leer bleibt, sind alle Absender der erlaubten Domain zugelassen.

3. Setup ausfuehren:

```bash
sh scripts/setup.sh
```

Das Skript erzeugt bei Bedarf:

- einen HMAC-Schluessel fuer die WebApp,
- ein selbstsigniertes HTTPS-Zertifikat,
- die Basic-Auth-Datei fuer `/installwebapp/`,
- `webapp/mail-backend-config.json` fuer die WebApp.

4. WebApp bauen und in das Mail-Backend kopieren:

```bash
cd ../frontend
npm install
npm run build
cd ../mail-backend
sh scripts/sync-webapp.sh
```

5. Backend starten:

```bash
docker compose up -d --build
```

6. Funktion pruefen:

```bash
curl -k https://SERVER_IP:8123/health
```

Die Installationsadresse fuer Safari auf dem iPad lautet:

```text
https://SERVER_IP:8123/installwebapp/
```

Das Zertifikat `mail-backend/certs/server.crt` muss einmalig auf jedem iPad als vertrauenswuerdig installiert werden. Das kann die nutzende Person selbst tun: in Safari `https://SERVER_IP:8123/ca.crt` oeffnen, das Profil laden, in den iPad-Einstellungen installieren und anschliessend unter Zertifikatsvertrauenseinstellungen voll vertrauen. Danach erscheint beim Mailversand keine Zertifikatsabfrage und kein zusaetzliches Passwortfenster.

Zusaetzlich prueft die WebApp vor dem Versand eine signierte Backend-Identitaet mit dem Public Key aus dem Installationspaket. Wenn diese Pruefung fehlschlaegt, wird nicht versendet.

Port `8123` sollte per Firewall nur fuer das Schulnetz oder bekannte Geraete erreichbar sein. Weitere Details, Sicherheitsmodell und Betriebsnotizen stehen in `mail-backend/README.md` und `mail-backend/SECURITY.md`.
