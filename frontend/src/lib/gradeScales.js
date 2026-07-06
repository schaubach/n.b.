export const DEFAULT_GRADE_SCALES = [
  {
    id: "MEDA",
    name: "MEDA",
    built_in: true,
    rows: [
      { grade: "1", points: "14", minPercent: 92 },
      { grade: "2", points: "11", minPercent: 81 },
      { grade: "3", points: "8", minPercent: 67 },
      { grade: "4", points: "5", minPercent: 50 },
      { grade: "5+", points: "3", minPercent: 40 },
      { grade: "5", points: "2", minPercent: 30 },
      { grade: "5-", points: "1", minPercent: 15 },
      { grade: "6", points: "0", minPercent: 0 },
    ],
  },
  {
    id: "GYM",
    name: "GYM",
    built_in: true,
    rows: [
      { grade: "1", points: "14", minPercent: 95 },
      { grade: "2", points: "11", minPercent: 80 },
      { grade: "3", points: "8", minPercent: 65 },
      { grade: "4", points: "5", minPercent: 50 },
      { grade: "5+", points: "3", minPercent: 37.5 },
      { grade: "5", points: "2", minPercent: 25 },
      { grade: "5-", points: "1", minPercent: 12.5 },
      { grade: "6", points: "0", minPercent: 0 },
    ],
  },
  {
    id: "IHK",
    name: "IHK",
    built_in: true,
    rows: [
      { grade: "1", points: "14", minPercent: 92 },
      { grade: "2", points: "11", minPercent: 81 },
      { grade: "3", points: "8", minPercent: 67 },
      { grade: "4", points: "5", minPercent: 50 },
      { grade: "5+", points: "3", minPercent: 40 },
      { grade: "5", points: "2", minPercent: 30 },
      { grade: "5-", points: "1", minPercent: 15 },
      { grade: "6", points: "0", minPercent: 0 },
    ],
  },
  {
    id: "ITA",
    name: "ITA",
    built_in: true,
    rows: [
      { grade: "1", points: "14", minPercent: 90 },
      { grade: "2", points: "11", minPercent: 75 },
      { grade: "3", points: "8", minPercent: 60 },
      { grade: "4", points: "5", minPercent: 45 },
      { grade: "5+", points: "3", minPercent: 32.5 },
      { grade: "5", points: "2", minPercent: 20 },
      { grade: "5-", points: "1", minPercent: 10 },
      { grade: "6", points: "0", minPercent: 0 },
    ],
  },
];

export function normalizeScaleId(name) {
  return String(name || "")
    .trim()
    .replace(/\.csv$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "Skala";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/\s+/g, " ");
}

function delimiter(line) {
  return (line.match(/;/g) || []).length >= (line.match(/,/g) || []).length ? ";" : ",";
}

function parseRows(text) {
  let input = String(text || "").replace(/^\uFEFF/, "");
  if (!input.includes("\n") && input.includes("\\n")) input = input.replace(/\\n/g, "\n");
  input = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const d = delimiter(input.split("\n").find((line) => line.trim()) || "");
  return input.split("\n")
    .map((line) => line.split(d).map((cell) => cell.trim().replace(/^"|"$/g, "")))
    .filter((row) => row.some(Boolean));
}

export function parseGradeScaleCsv(text, fallbackName = "Skala") {
  const rows = parseRows(text);
  if (rows.length < 2) throw new Error("Notenskala braucht eine Kopfzeile und mindestens eine Zeile.");
  const headers = rows[0].map(normalizeHeader);
  const gradeIndex = headers.findIndex((h) => ["note", "notenwert", "grade"].includes(h));
  const pointsIndex = headers.findIndex((h) => ["punkte", "punktwert", "points"].includes(h));
  const percentIndex = headers.findIndex((h) => ["prozent_ab", "prozent ab", "mindestens %", "mindestens", "percent", "min_percent"].includes(h));
  if (gradeIndex < 0 || percentIndex < 0) throw new Error("CSV braucht die Spalten Note und Prozent_ab.");
  const parsedRows = rows.slice(1).map((row) => ({
    grade: String(row[gradeIndex] || "").trim(),
    points: pointsIndex >= 0 ? String(row[pointsIndex] || "").trim() : "",
    minPercent: Number(String(row[percentIndex] || "0").replace(",", ".")),
  })).filter((row) => row.grade && Number.isFinite(row.minPercent));
  if (parsedRows.length === 0) throw new Error("Notenskala enthält keine gültigen Werte.");
  parsedRows.sort((a, b) => b.minPercent - a.minPercent);
  const id = normalizeScaleId(fallbackName);
  return { id, name: id, built_in: false, rows: parsedRows };
}

export function gradeScaleCsv(scale) {
  const lines = ["Note;Punkte;Prozent_ab"];
  (scale.rows || []).forEach((row) => {
    lines.push([row.grade || "", row.points || "", String(row.minPercent ?? 0).replace(".", ",")].join(";"));
  });
  return lines.join("\n");
}

export function allGradeScales(customScales = []) {
  const map = new Map(DEFAULT_GRADE_SCALES.map((scale) => [scale.id, scale]));
  (customScales || []).forEach((scale) => map.set(scale.id, { ...scale, built_in: false }));
  return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), "de", { sensitivity: "base" }));
}

export function findGradeScale(scales, scaleId) {
  return (scales || []).find((scale) => scale.id === scaleId) || (scales || [])[0] || DEFAULT_GRADE_SCALES[0];
}

export function cloneScale(scale) {
  return { ...scale, rows: (scale?.rows || []).map((row) => ({ ...row })) };
}

export function scaleValueForSystem(row, gradeSystem) {
  if (!row) return "";
  if (gradeSystem === "points_0_15") {
    if (row.points !== undefined && row.points !== "") return String(row.points);
    const gradeToPoints = { "1": "14", "2": "11", "3": "8", "4": "5", "5+": "3", "5": "2", "5-": "1", "6": "0" };
    return gradeToPoints[String(row.grade)] || String(row.grade || "");
  }
  return String(row.grade || "");
}

export function shouldUseWholeExamGrades(session, gradeSystem) {
  return gradeSystem !== "points_0_15" && session?.category === "klausur";
}

export function normalizeExamGradeValue(value, session, gradeSystem) {
  const text = String(value || "");
  if (!shouldUseWholeExamGrades(session, gradeSystem)) return text;
  const match = text.match(/\d/);
  return match ? match[0] : text;
}

export function evaluatePercent(percent, scale, gradeSystem = "grades_1_6", session = null) {
  const rows = (scale?.rows || []).slice().sort((a, b) => b.minPercent - a.minPercent);
  if (typeof percent !== "number" || !Number.isFinite(percent) || rows.length === 0) {
    return { value: "", row: null, rowIndex: -1, percent: null };
  }
  const rowIndex = rows.findIndex((row) => percent >= Number(row.minPercent));
  const index = rowIndex >= 0 ? rowIndex : rows.length - 1;
  const row = rows[index];
  return { value: normalizeExamGradeValue(scaleValueForSystem(row, gradeSystem), session, gradeSystem), row, rowIndex: index, percent };
}

export function pointsNeededForBetter(achieved, maxPoints, scale, rowIndex, gradeSystem = "grades_1_6", session = null) {
  const rows = (scale?.rows || []).slice().sort((a, b) => b.minPercent - a.minPercent);
  if (!(maxPoints > 0) || rowIndex <= 0 || rowIndex >= rows.length) return null;
  const currentValue = normalizeExamGradeValue(scaleValueForSystem(rows[rowIndex], gradeSystem), session, gradeSystem);
  const better = rows.slice(0, rowIndex).reverse().find((row) => normalizeExamGradeValue(scaleValueForSystem(row, gradeSystem), session, gradeSystem) !== currentValue);
  if (!better) return null;
  const neededTotal = (Number(better.minPercent) / 100) * maxPoints;
  const missing = neededTotal - Number(achieved || 0);
  if (!(missing > 0)) return null;
  return {
    points: Math.ceil(missing * 10) / 10,
    target: normalizeExamGradeValue(scaleValueForSystem(better, gradeSystem), session, gradeSystem),
    minPercent: better.minPercent,
  };
}
