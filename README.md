# SwipeNoten

SwipeNoten ist als lokale Offline-Webapp umgesetzt. Das Frontend enthaelt die komplette Laufzeitlogik: CSV-Klassenimport, Fotozuordnung, Bewertung, lokale Speicherung und CSV-Export laufen ohne Backend, MongoDB oder externe API.

## CSV-Import

Die App importiert Klassenlisten als CSV. Erwartete Spaltennamen sind:

```csv
Gruppe;Nachname;Vorname
Klasse.MEDU1;Liu;Zhang
Klasse.MEDU1;"El Bey";Karim
```

- Jede `Gruppe` wird als eigene Klasse angelegt oder aktualisiert.
- Beim Re-Import bleiben vorhandene Fotos erhalten.
- Neue Klassen fragen einmalig das Notensystem ab.

## Fotos

In jeder Klassenkachel gibt es neben dem Loesch-Button einen Foto-Button. Darueber oeffnet sich eine lokale Zuordnungsliste: pro Lernendenkarte kann ein Foto aufgenommen oder ausgewaehlt werden. Die App verkleinert das Foto lokal und speichert es verschluesselt am Lernenden-Datensatz.

Wird eine Klasse geloescht, werden Namen, Fotos, Bewertungsrunden und Noten dieser Klasse aus dem lokalen Tresor entfernt.

## Lokale Daten und Verschluesselung

- Beim ersten Start wird ein lokaler Tresor mit Passwort erstellt.
- Klassen, Lernendenfotos, Bewertungsrunden und Noten werden in IndexedDB gespeichert.
- Der gespeicherte Datenbestand wird vor dem Schreiben mit WebCrypto verschluesselt: PBKDF2-SHA-256 zur Schluesselableitung, AES-GCM fuer die Daten.
- Das Passwort wird nicht gespeichert. Ohne Passwort bleibt der lokale Datenbestand verschluesselt.
- Externe Fonts/CDNs wurden entfernt. Die App setzt eine Content-Security-Policy, die externe Verbindungen und fremde Ressourcen blockiert.

## Offline/PWA

Der Produktionsbuild liegt nach dem Build unter `frontend/build/` und enthaelt alle App-Assets. Der Service Worker cached beim ersten Start `index.html`, Manifest, Icon sowie die gehashten JS/CSS-Dateien aus `asset-manifest.json`.

Wichtig fuer iPad: Safari installiert PWAs nicht verlaesslich direkt aus einem kopierten `file://`-Ordner. Praktisch ist daher:

1. `frontend/build/` auf einen lokalen oder HTTPS-Webserver legen.
2. Die Seite einmal auf dem iPad in Safari oeffnen.
3. "Zum Home-Bildschirm" verwenden.
4. Danach laeuft die App mit den gecachten Assets ohne Internetverbindung weiter.

## Entwicklung

```bash
cd frontend
npm install
npm run build
npm test -- --watchAll=false --runTestsByPath src/lib/csvImport.test.js
```

Produktive Runtime-Abhaengigkeiten sind mit `npm audit --omit=dev` geprueft.
