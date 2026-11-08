import { parseCsvRows } from "./csvImport";

const HEADERS = ["mail", "erreichte punkte", "maximale punkte", "status"];
const STATUSES = new Set(["geprüft", "ungeprüft", "veraltet", "unveröffentlicht, geprüft", "unveröffentlicht, ungeprüft", "unveröffentlicht, veraltet", "unbewertet", "fehlt"]);

export function importMail(value) {
  let text = String(value || "");
  if (/^'[=+\-@\t\r\n]/.test(text)) text = text.slice(1);
  return text.trim().toLowerCase();
}

export function importNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+(?:[,.]\d+)?$/.test(text)) return NaN;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) && number <= 1e9 ? number : NaN;
}

export function parsePointsImport(text, students) {
  if (String(text).length > 2 * 1024 * 1024) throw new Error("Die CSV-Datei darf höchstens 2 MB groß sein.");
  const table = parseCsvRows(text, { delimiter: ";", strict: true });
  if (table.length < 2) throw new Error("Die CSV-Datei enthält keine Datenzeilen.");
  if (table.length > 2001) throw new Error("Die CSV-Datei enthält mehr als 2000 Datenzeilen.");
  const headers = table[0].map((value) => value.trim().toLowerCase());
  for (const name of HEADERS) {
    if (headers.filter((header) => header === name).length !== 1) throw new Error(`CSV-Spalte fehlt oder ist doppelt: ${name}`);
  }
  const indices = HEADERS.map((name) => headers.indexOf(name));
  const rows = table.slice(1).map((values, index) => {
    const [mail, achieved, maximum, status] = indices.map((column) => String(values[column] ?? "").trim());
    const matches = students.filter((student) => importMail(student.email) && importMail(student.email) === importMail(mail));
    return {
      key: `csv-${index}`, line: index + 2, mail: importMail(mail), status,
      student_id: matches.length === 1 ? matches[0].id : "",
      achieved, maximum, decision: "pending",
      source_issues: [
        ...(values.length !== headers.length ? ["Anzahl der Felder stimmt nicht mit der Kopfzeile überein."] : []),
        ...(matches.length > 1 ? ["Die Mailadresse ist mehreren Lernenden der Klasse zugeordnet."] : []),
      ],
    };
  });
  const matched = new Set(rows.map((row) => row.student_id));
  students.filter((student) => !student.inactive && !matched.has(student.id)).forEach((student) => rows.push({
    key: `missing-${student.id}`, line: null, mail: student.email || "", status: "Keine CSV-Zeile",
    student_id: student.id, achieved: "", maximum: "", decision: "pending", source_issues: ["Keine eindeutig zugeordnete CSV-Zeile für diese Person."],
  }));
  const analysis = inspectPointsImport(rows, students);
  return rows.map((row, index) => ({ ...row, decision: analysis[index].issues.length ? "pending" : "accept" }));
}

export function inspectPointsImport(rows, students) {
  const studentsById = new Map(students.map((student) => [student.id, student]));
  const maxima = new Set(rows.filter((row) => row.decision !== "missing").map((row) => importNumber(row.maximum)).filter((value) => Number.isFinite(value) && value > 0));
  const mails = new Map();
  const targets = new Map();
  for (const row of rows) {
    if (row.line && importMail(row.mail)) mails.set(importMail(row.mail), (mails.get(importMail(row.mail)) || 0) + 1);
    if (row.decision !== "missing" && row.student_id) targets.set(row.student_id, (targets.get(row.student_id) || 0) + 1);
  }
  return rows.map((row) => {
    const student = studentsById.get(row.student_id);
    const achieved = importNumber(row.achieved);
    const maximum = importNumber(row.maximum);
    const errors = [];
    const warnings = [...(row.source_issues || [])];
    if (!student) errors.push("Keine eindeutige Zuordnung zu Lernenden dieser Klasse.");
    if (!row.mail) warnings.push("Mailadresse fehlt.");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(importMail(row.mail))) warnings.push("Mailadresse hat kein gültiges Format.");
    if (student?.inactive) warnings.push("Lernende Person ist inaktiv; Übernahme ausdrücklich bestätigen.");
    if ((mails.get(importMail(row.mail)) || 0) > 1) warnings.push("Mailadresse kommt mehrfach in der CSV vor.");
    if ((targets.get(row.student_id) || 0) > 1) errors.push("Mehrere Zeilen für dieselbe Person: nur eine übernehmen, die übrigen als fehlend markieren.");
    if (achieved === null) errors.push("Erreichte Punkte fehlen (leer ist nicht 0).");
    else if (!Number.isFinite(achieved)) errors.push("Erreichte Punkte müssen eine nicht negative Dezimalzahl sein (max. 1 Milliarde).");
    if (!Number.isFinite(maximum) || !(maximum > 0)) errors.push("Maximale Punkte müssen eine positive Dezimalzahl sein (max. 1 Milliarde).");
    if (Number.isFinite(achieved) && Number.isFinite(maximum) && achieved > maximum) errors.push("Erreichte Punkte überschreiten die maximalen Punkte.");
    if (maxima.size > 1) warnings.push("Unterschiedliche Höchstpunktzahlen: Note wird aus dem Prozentwert dieser Zeile berechnet.");
    if (!STATUSES.has(row.status)) warnings.push(`Unbekannter Status: ${row.status || "leer"}.`);
    else if (row.status !== "geprüft") warnings.push(`Quellstatus: ${row.status}. Entscheidung erforderlich.`);
    const issues = [...errors, ...warnings];
    const missing = row.decision === "missing";
    return { student, achieved, maximum, errors, warnings, issues, missing, valid: errors.length === 0, ready: missing || (row.decision === "accept" && errors.length === 0) };
  });
}

export function validatePointsReview(rows, students) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error("Keine gültige Importprüfung vorhanden.");
  if (rows.some((row) => !row || !["accept", "missing", "pending"].includes(row.decision))) throw new Error("Ungültige Importentscheidung.");
  const checks = inspectPointsImport(rows, students);
  if (checks.some((check) => !check.ready)) throw new Error("Offene oder fehlerhafte Zeilen müssen bestätigt, korrigiert oder als fehlend markiert werden.");
  const covered = new Set(rows.map((row) => row.student_id));
  if (students.some((student) => !student.inactive && !covered.has(student.id))) throw new Error("Die Klassenliste hat sich geändert. Bitte die CSV neu laden und alle aktiven Lernenden prüfen.");
  return rows.flatMap((row, index) => checks[index].missing ? [] : [{ student_id: row.student_id, achieved: checks[index].achieved, maximum: checks[index].maximum }]);
}
