function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectDelimiter(line) {
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

export function parseCsvRows(text) {
  const input = stripBom(String(text || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = input.split("\n").find((line) => line.trim()) || "";
  const delimiter = detectDelimiter(firstLine);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss");
}

function valueAt(row, index) {
  return index >= 0 ? String(row[index] || "").trim() : "";
}

function accountToEmail(account) {
  const value = String(account || "").trim();
  if (!value) return "";
  return value.includes("@") ? value.toLowerCase() : value.toLowerCase() + "@rbbk-do.de";
}

export function parseClassCsv(text, fallbackClassName = "Klasse") {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV enthaelt keine Lernenden.");

  const headers = rows[0].map(normalizeHeader);
  const groupIndex = headers.findIndex((h) => ["gruppe", "klasse", "class", "kurs"].includes(h));
  const lastIndex = headers.findIndex((h) => ["nachname", "name", "lastname", "last name"].includes(h));
  const firstIndex = headers.findIndex((h) => ["vorname", "firstname", "first name"].includes(h));
  const accountIndex = headers.findIndex((h) => ["account", "benutzer", "benutzername", "login", "username", "user name"].includes(h));
  const emailIndex = headers.findIndex((h) => ["mail", "email", "e-mail", "mailadresse", "emailadresse", "e-mail adresse"].includes(h));

  if (lastIndex < 0 || firstIndex < 0) {
    throw new Error("CSV braucht die Spalten Vorname und Nachname.");
  }

  const groups = new Map();
  const keyCounts = new Map();
  rows.slice(1).forEach((row) => {
    const firstName = valueAt(row, firstIndex);
    const lastName = valueAt(row, lastIndex);
    if (!firstName && !lastName) return;
    const group = valueAt(row, groupIndex) || fallbackClassName;
    const email = valueAt(row, emailIndex) || accountToEmail(valueAt(row, accountIndex));
    if (!groups.has(group)) groups.set(group, []);
    const baseKey = `${normalizeHeader(group)}::${normalizeHeader(lastName)}::${normalizeHeader(firstName)}`;
    const count = (keyCounts.get(baseKey) || 0) + 1;
    keyCounts.set(baseKey, count);
    groups.get(group).push({
      first_name: firstName,
      last_name: lastName,
      order: groups.get(group).length,
      email,
      source_key: count === 1 ? baseKey : `${baseKey}::${count}`,
    });
  });

  const classes = Array.from(groups.entries()).map(([name, students]) => ({ name, students }));
  if (classes.length === 0) throw new Error("CSV enthaelt keine Lernenden.");
  return { classes };
}

