# Security-Audit Mail-Backend

Stand: 2026-07-07

## Betrachteter Angreifer

Der betrachtete Angreifer kann den Netzwerkverkehr beobachten, eigene Requests an das Mail-Backend und `/installwebapp/` senden, Browser-DevTools verwenden und lokale Browser-Variablen manipulieren.

## Ergebnis

Das Backend ist gegen reine Netzbeobachtung abgesichert, wenn HTTPS korrekt genutzt wird und das Serverzertifikat auf den iPads vertrauenswuerdig installiert ist. API-Requests sind zusaetzlich HMAC-signiert, haben ein enges Zeitfenster und verwenden Nonces gegen Replay.

Ein Angreifer, der Zugriff auf die ausgelieferte WebApp-Konfiguration oder den Browser einer berechtigten Lehrkraft hat, kann den Pre-Shared-Key grundsaetzlich auslesen. Dagegen kann eine statische WebApp allein nicht vollstaendig schuetzen. Deshalb begrenzen serverseitige Kontrollen den Schaden:

- TLS fuer Transportverschluesselung,
- HMAC-SHA256 ueber `timestamp.nonce.body`,
- Zeitfenster- und Nonce-Pruefung,
- Empfaenger- und Absenderdomain,
- optionale Absender-Allowlist `ALLOWED_SENDERS`,
- Backend-Rate-Limits pro IP und Absender,
- Nginx-Rate-Limits vor API und Installationsseite,
- Basic Auth fuer `/installwebapp/`,
- keine Speicherung der SMTP-Passwoerter im Backend,
- keine Protokollierung von Mailinhalten.

## Angriffsvektoren

### Netzbeobachter liest Webverkehr

Bewertung: abgesichert, wenn das Zertifikat vertraut ist.

HTTPS verhindert das Mitlesen von SMTP-Passwort, Mailinhalten und HMAC-Secret. Wird eine Zertifikatswarnung weggeklickt, ist dieser Schutz geschwaecht. Deshalb muss `server.crt` per Profil/MDM oder manuell als vertrauenswuerdig installiert werden.

### Replay eines beobachteten API-Requests

Bewertung: abgesichert gegen normale Wiederholung.

Das Backend lehnt alte Zeitstempel und bereits verwendete Nonces ab. Die Nonce-Liste liegt im Speicher und wird nach einem Container-Neustart neu aufgebaut. Ohne TLS-Mitschnitt kann ein Netzbeobachter den signierten Body aber nicht sinnvoll kopieren.

### Manipulierter API-Request aus DevTools

Bewertung: teilweise begrenzt, nicht vollstaendig verhinderbar.

Wer den Pre-Shared-Key im Browser auslesen kann, kann eigene gueltig signierte Requests erzeugen. Die App kann das clientseitig nicht verhindern. Begrenzungen liegen serverseitig: erlaubte Domain, optional `ALLOWED_SENDERS`, Rate-Limits und SMTP-Authentifizierung mit dem Passwort der Lehrkraft.

Empfehlung: `ALLOWED_SENDERS` in `.env` setzen und Port `8123` per Firewall nur fuer das Schulnetz freigeben.

### Zugriff auf `/installwebapp/`

Bewertung: abgesichert durch HTTPS und Basic Auth, aber schutzbeduerftig.

Die Installationsseite enthaelt die WebApp und die `mail-backend-config.json` mit dem HMAC-Secret. Wer Zugriff auf `/installwebapp/` hat, kann diese Konfiguration herunterladen. Deshalb muss das Installationspasswort stark sein, darf nicht weitergegeben werden und Port `8123` sollte netzseitig eingeschraenkt werden.

### Manipulierte lokale Browserdaten

Bewertung: begrenzt durch lokale Verschluesselung, nicht durch Server erzwingbar.

Die WebApp-Daten liegen lokal verschluesselt. Wenn eine entsperrte App im Browser manipuliert wird, kann die UI oder ein lokaler Request veraendert werden. Das Backend kann nur die technischen Versandregeln pruefen, nicht die fachliche Richtigkeit der Noteninhalte.

## Betriebsempfehlungen

- `ALLOWED_SENDERS` in `.env` setzen.
- Starkes `INSTALL_PASSWORD` verwenden.
- `mail-backend/webapp/mail-backend-config.json`, `.env`, `certs/server.key` und `nginx/auth/.htpasswd` nicht kopieren oder committen.
- Port `8123` nur im Schulnetz freigeben.
- Zertifikat auf iPads vertrauenswuerdig installieren.
- Keine Zertifikatswarnungen akzeptieren.
- Regelmaessig `docker compose logs` auf abgelehnte Requests und Rate-Limit-Hinweise pruefen.
- Bei Verdacht auf Zugriff auf `/installwebapp/`: `NB_MAIL_PSK` neu erzeugen, `scripts/setup.sh` ausfuehren, WebApp neu synchronisieren und iPads aktualisieren.
