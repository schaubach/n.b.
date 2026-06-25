# SwipeNoten — PRD

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

## User persona
Lehrer*in mit iDoceo auf dem iPad, will mündliche Mitarbeit o.ä. sehr schnell benoten.

## Workflow (iPad)
iDoceo → .idoceo exportieren → in SwipeNoten hochladen → Klasse + Notensystem wählen →
Bewerten (swipen) → CSV exportieren → in iDoceo per CSV-Import einlesen.

## Backlog / Next
- P1: Re-Import des CSV-Mappings in iDoceo dokumentieren / vereinfachen (Anleitung in UI).
- P1: Mehrere Bewertungsrunden je Klasse verwalten/auflisten (History-Ansicht).
- P2: ObjectId-Validierung → 404 statt 500 bei ungültiger ID.
- P2: PWA/„Zum Home-Bildschirm" + Offline-Cache für reines lokales Arbeiten.
- P2: Notenzellen-Reihenfolge/Belegung pro Lehrer konfigurierbar.
- P2: Stapel-Vorschau (nächste Karte) hinter aktueller Karte für mehr Tiefe.
