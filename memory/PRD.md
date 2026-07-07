# n.b. — PRD

## Problem statement (original, DE)
Mobile/iPad-Webapp als Ergänzung zu iDoceo. Notenvergabe per Swipe (ohne Tippen).
Klassen werden aus iDoceo importiert (.idoceo-Archiv), Noten gehen als CSV zurück
nach iDoceo. Schüler*in wird per Vor-/Nachname + Bild dargestellt (alle Daten aus
iDoceo). Noten müssen der richtigen Klasse und Schüler*in zugeordnet werden.
Bewertung schnell und einfach. Single-User, lokal auf iPad.

## Key technical findings
- iDoceo hat KEINE öffentliche API. Datenaustausch nur per Datei (CSV/XLS) bzw.
  native Sync-Dienste. Vollautomatischer dateiloser 2-Wege-Sync ist nicht möglich.
- `.idoceo`-Archiv = ZipCrypto-verschlüsseltes ZIP (Passwort `test`) mit
  `idoceo_template.xml` (notepad=Klasse, student-Einträge mit sid/name/lastname/order)
  und `files/student_<sid>.jpg` (Foto je sid; nicht alle Schüler haben eins).
- Decryption: ZipCrypto manuell entschlüsselt (Data-Descriptor-Problem), siehe
  `backend/idoceo.py` (basiert auf der vom User gelieferten repair.py).

## Architecture
- Backend: FastAPI + Motor/MongoDB. Routen unter `/api`.
- Frontend: React (CRA) + Tailwind + framer-motion + react-router. Neo-Brutalist Design.
- Collections: classes, students (photo als base64 data-URL), sessions, grades.

## Implemented (2026-06-24)
- POST /api/import/idoceo: Upload .idoceo, entschlüsseln, parsen, Auto-Merge
  (neue Klasse anlegen / bekannte Klasse → neue Schüler ergänzen, vorhandene updaten).
- Klassenliste + Notensystem-Auswahl je Klasse (grades_1_6 / points_0_15), löschen.
- Bewertungsrunde (session) je Klasse mit aktuellem Datum.
- Swipe-Grading: Schülerkarte zentral, 16 Notenzellen an 4 Rändern; Karte zur
  nächsten Zelle ziehen = Note; Tap auf Zelle als Alternative; Undo; Fortschritt.
- Foto oder Initialen-Fallback auf der Karte.
- Zusammenfassung + CSV-Export (Spalten Vorname,Nachname,<Datum>) für iDoceo-Reimport.
- Getestet: Backend 14/14 pytest, Frontend Core-Flow 100% (testing agent iteration_1).

## Update (2026-06-25) – Mehrere Bewertungen sammeln + robuster Export
- CSV-Download von `<a href>` auf **Blob-Download** umgestellt (Preview-iframe blockierte
  direkte Downloads) + **Teilen-Button** (Web Share API mit Datei, iOS Share Sheet).
- **Sammel-System je Klasse**: mehrere Bewertungsrunden (sessions) werden gesammelt.
  Klassenkachel zeigt „X Bewertungen gesammelt" / „Noch keine Bewertung", Button
  „Neue Bewertung". Bestand bleibt bis explizit „Exportieren & löschen" oder
  „Teilen & löschen" gedrückt wird (Buttons in Klassenkachel UND auf Summary-Seite).
- **Aggregierter Export**: GET /api/classes/{id}/export.csv → eine Spalte je Runde
  (Header = Datum, Duplikate „ #2"), nur Zeilen mit ≥1 Note. DELETE
  /api/classes/{id}/sessions leert den Bestand (Schüler bleiben).
- Getestet: Backend 16/16 pytest, Frontend Multi-Round/Export/Share-Flow 100%
  (testing agent iteration_2). Keine offenen Bugs.

## Update (2026-07-02b) – Notenbereiche v3 + Listen-Korrektur
- Layout: 4 Randzonen (Top 1er, Right 2er, Bottom 3er, Left 4er) + zwei Flank-Zellen
  neben der Karte: **links 6 (0 P.)**, **rechts 5 (2 P.)** – 5/6 ohne Tendenzen.
- **Kein Benoten mehr per Klick auf die Karte** (nur Swipe in Zone oder Tap auf Zelle).
- Farbiges Flash-Feedback beim Vergeben (Center-Rot entfällt; Flanks 5/6 = rot).
- **Ende der Runde → direkt zur Notenliste** (Summary, kein „alles erledigt"-Screen).
- **Notenliste: Klick auf Zeile → GradePicker** (alle 14 Noten mit Punktwert,
  aktuelle hervorgehoben, „Note entfernen"). Verifiziert für beide Systeme.

## Update (2026-07-02c)
- **Karten-Tap = Überspringen** (keine Note; nächste*r Schüler*in). Pill „Tippen = überspringen".
- **Farbcodierung** der Noten in der Übersichtsliste: Tier 1 dunkelgrün → 6 dunkelrot
  (emerald→lime→amber→orange→red→dark red), für beide Systeme (Punkte per Tier-Mapping).

## Update (2026-07-02d)
- Grading-Zonen im Durchgang in Tier-Farben (identisch zur Liste).
- Summary: „Bearbeiten" entfernt; „Klassen" als langer Button ganz unten.
- **Session-Setup-Modal** vor jedem Start: Name (Default „mündliche Mitarbeit"),
  Gewichtung (Default 1), Datum (Default heute) – vorausgefüllt, ein Klick genügt.
  Backend speichert `weight`; Aggregat-CSV-Spalte = „{Name} {Datum} (x{Gewichtung})".

## Update (2026-07-02) – Große Notenbereiche + Fixes
- Datei-Import: `accept`-Filter entfernt (`.idoceo` war im iPad-Dialog ausgegraut).
- Alle nativen `window.confirm` durch **In-App-ConfirmModal** ersetzt (Sandbox-iframe
  blockierte native Dialoge → Löschen/Export „funktionierte nicht").
- **Klasse löschen**: Sicherheitsabfrage immer; bei nicht exportierten Bewertungen
  Zusatzoption „Exportieren, dann löschen" / „Ohne Export löschen".
- **Neues großflächiges Grading-Layout** (Rahmen): Oben 1er (1+/1/1- = 15/14/13),
  Rechts 2er (12/11/10), Unten 3er (9/8/7), Links 4er (6/5/4), **Tippen auf Karte = 5
  (3 Punkte)**. Jede Zelle zeigt primären Wert groß + Alt-System klein. Swipe in Zone
  oder Tippen vergibt Note. Verifiziert für beide Systeme + Zone→Note-Mapping.

## User persona
Lehrer*in mit iDoceo auf dem iPad, will mündliche Mitarbeit o.ä. sehr schnell benoten.

## Workflow (iPad)
iDoceo → .idoceo exportieren → in n.b. hochladen → Klasse + Notensystem wählen →
Bewerten (swipen) → CSV exportieren → in iDoceo per CSV-Import einlesen.

## Backlog / Next
- P1: Re-Import des CSV-Mappings in iDoceo dokumentieren / vereinfachen (Anleitung in UI).
- P1: Mehrere Bewertungsrunden je Klasse verwalten/auflisten (History-Ansicht).
- P2: ObjectId-Validierung → 404 statt 500 bei ungültiger ID.
- P2: PWA/„Zum Home-Bildschirm" + Offline-Cache für reines lokales Arbeiten.
- P2: Notenzellen-Reihenfolge/Belegung pro Lehrer konfigurierbar.
- P2: Stapel-Vorschau (nächste Karte) hinter aktueller Karte für mehr Tiefe.

## Update (2026-07-03) - Lokale Offline-App ohne Backend
- Backend-/MongoDB-Laufzeitpfad fuer die App entfernt: Das Frontend nutzt jetzt eine lokale axios-kompatible API-Schicht auf IndexedDB.
- Lokaler Passwort-Tresor vor der App: PBKDF2-SHA-256 + AES-GCM, Passwort wird nicht gespeichert.
- iDoceo-Parser nach JavaScript portiert; `.idoceo`-Import laeuft im Browser. Parser-Test nutzt `tests/sample.idoceo`.
- Externe Fonts/CDNs entfernt; CSP blockiert externe Ressourcen/Verbindungen. Systemfonts statt Google/Fontshare.
- PWA-Dateien ergaenzt: Manifest, Icon, Service Worker mit Asset-Manifest-Precache. `HashRouter` + `homepage: "."` fuer statische Auslieferung.
- iPad-Einschraenkung: Fuer Home-Screen/PWA muss der Build einmal per lokalem/HTTPS-Webserver geoeffnet werden; reines `file://` ist fuer Service Worker nicht ausreichend.

## Update (2026-07-03b) - CSV-Import und lokale Fotos
- Aktueller Importpfad ist CSV statt `.idoceo`: Spalten `Gruppe;Nachname;Vorname`, jede Gruppe wird als Klasse angelegt/aktualisiert.
- Foto-Button in jeder Klassenkachel ergaenzt. Pro Lernendenkarte kann lokal ein Foto aufgenommen/ausgewaehlt und verschluesselt gespeichert werden.
- Fotos liegen am Lernenden-Datensatz und werden beim Klassenloeschen zusammen mit Namen, Sessions und Noten entfernt.
- Alter Frontend-iDoceo-Parser und `fflate`-Runtime-Abhaengigkeit entfernt; neuer CSV-Parser ist getestet.
