import {
  csvEscape,
  displayValueFromAverage,
  finalGradeFromAverages,
  formatAverage,
  formatFinalGrade,
  gradeToNumber,
  weightedAverage,
} from "./gradebook";

export function examTerms(systemId) {
  return systemId === "points_0_15"
    ? { short: "KL", long: "Klausur", total: "KL gesamt" }
    : { short: "KA", long: "Klassenarbeit", total: "KA gesamt" };
}

export function slType(session) {
  return session.category === "klausur" ? null : (session.sl_type === "written" ? "written" : "oral");
}

function dateValue(date) {
  const match = String(date || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const [, day, month, year] = match;
  return Number(`${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`);
}

export function sortedSessions(data) {
  return (data.sessions || []).slice().sort((a, b) => {
    const group = (session) => session.category === "klausur" ? 0 : (slType(session) === "oral" ? 1 : 2);
    return group(a) - group(b)
      || dateValue(a.date) - dateValue(b.date)
      || String(a.created_at || "").localeCompare(String(b.created_at || ""))
      || String(a.title || "").localeCompare(String(b.title || ""), "de", { sensitivity: "base" });
  });
}

export function averageWeights(data) {
  const weights = { sl_oral: 1, sl_written: 1, sl: 1, ka: 1 };
  (data.average_weights || []).forEach((item) => {
    const weight = Number(item.weight);
    if ((item.column === "sl_oral" || item.column === "sl_written") && weight > 0) weights[item.column] = weight;
  });
  return weights;
}

function weightLabel(weight) {
  const value = Number(weight) || 1;
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function weightedPair(first, second, firstWeight, secondWeight) {
  const hasFirst = typeof first === "number";
  const hasSecond = typeof second === "number";
  if (hasFirst && hasSecond) {
    return weightedAverage([
      { value: first, weight: firstWeight },
      { value: second, weight: secondWeight },
    ]);
  }
  if (hasFirst) return first;
  if (hasSecond) return second;
  return null;
}

function mainValueNumber(value, systemId) {
  return gradeToNumber(displayValueFromAverage(value, systemId), systemId);
}

export function buildGradebookRows(data) {
  const sessions = sortedSessions(data);
  const students = data.students || [];
  const grades = data.grades || [];
  const overrides = data.average_overrides || [];
  const weights = averageWeights(data);
  const gradeMap = new Map(grades.map((grade) => [`${grade.session_id}:${grade.student_id}`, grade]));
  const overrideMap = new Map(overrides.map((override) => [`${override.student_id}:${override.column}`, override.value]));

  return students.map((student) => {
    const sessionCells = sessions.map((session) => {
      const grade = gradeMap.get(`${session.id}:${student.id}`);
      const value = grade?.value || "";
      const numeric = gradeToNumber(value, data.grade_system);
      return { session, value, numeric, calculated_value: grade?.calculated_value || "", manual_override: !!grade?.manual_override };
    });
    const slOralAverage = weightedAverage(sessionCells
      .filter((cell) => cell.session.category !== "klausur" && slType(cell.session) === "oral")
      .map((cell) => ({ value: cell.numeric, weight: cell.session.weight })));
    const slWrittenAverage = weightedAverage(sessionCells
      .filter((cell) => cell.session.category !== "klausur" && slType(cell.session) === "written")
      .map((cell) => ({ value: cell.numeric, weight: cell.session.weight })));
    const kaAverage = weightedAverage(sessionCells
      .filter((cell) => cell.session.category === "klausur")
      .map((cell) => ({ value: cell.numeric, weight: cell.session.weight })));
    const overridesForStudent = {
      sl_oral: overrideMap.get(`${student.id}:sl_oral`) || "",
      sl_written: overrideMap.get(`${student.id}:sl_written`) || "",
      sl: overrideMap.get(`${student.id}:sl`) || "",
      ka: overrideMap.get(`${student.id}:ka`) || "",
      final: overrideMap.get(`${student.id}:final`) || "",
    };
    const effectiveSlOral = overridesForStudent.sl_oral ? gradeToNumber(overridesForStudent.sl_oral, data.grade_system) : mainValueNumber(slOralAverage, data.grade_system);
    const effectiveSlWritten = overridesForStudent.sl_written ? gradeToNumber(overridesForStudent.sl_written, data.grade_system) : mainValueNumber(slWrittenAverage, data.grade_system);
    const computedEffectiveSl = weightedPair(effectiveSlOral, effectiveSlWritten, weights.sl_oral, weights.sl_written);
    const effectiveSl = overridesForStudent.sl ? gradeToNumber(overridesForStudent.sl, data.grade_system) : computedEffectiveSl;
    const effectiveSlForFinal = overridesForStudent.sl ? effectiveSl : mainValueNumber(computedEffectiveSl, data.grade_system);
    const effectiveKa = overridesForStudent.ka ? gradeToNumber(overridesForStudent.ka, data.grade_system) : mainValueNumber(kaAverage, data.grade_system);
    const finalGrade = finalGradeFromAverages(effectiveSlForFinal, effectiveKa, data.grade_system);

    return {
      student,
      sessionCells,
      slOralAverage,
      slWrittenAverage,
      slAverage: computedEffectiveSl,
      kaAverage,
      finalGrade,
      overrides: overridesForStudent,
      gradeSystem: data.grade_system,
    };
  });
}

export function averageColumns(sessions, weights, systemId) {
  const hasOral = sessions.some((session) => session.category !== "klausur" && slType(session) === "oral");
  const hasWritten = sessions.some((session) => session.category !== "klausur" && slType(session) === "written");
  const hasSl = hasOral || hasWritten;
  const exam = examTerms(systemId);
  const ratio = hasOral && hasWritten
    ? `mündl. x${weightLabel(weights.sl_oral)} / schrftl. x${weightLabel(weights.sl_written)}`
    : "aus vorhandenen SL-Noten";
  return [
    { key: "ka", label: exam.total, hint: `gewichteter Schnitt aller ${exam.long}-Noten; Endnote x1`, tone: "ka", fixedWeight: 1 },
    ...(hasOral ? [{ key: "sl_oral", label: "SL mündl.", hint: `Gewichtung x${weightLabel(weights.sl_oral)}`, tone: "sl", weightEditable: true }] : []),
    ...(hasWritten ? [{ key: "sl_written", label: "SL schrftl.", hint: `Gewichtung x${weightLabel(weights.sl_written)}`, tone: "sl", weightEditable: true }] : []),
    ...(hasSl ? [{ key: "sl", label: "SL gesamt", hint: `${ratio}; Endnote x1`, tone: "sl", fixedWeight: 1 }] : []),
    { key: "final", label: "Endnote", hint: `${exam.total} und SL gesamt je x1`, tone: "final" },
  ];
}

function averageValue(row, column) {
  if (column === "sl_oral") return row.slOralAverage;
  if (column === "sl_written") return row.slWrittenAverage;
  if (column === "sl") return row.slAverage;
  if (column === "ka") return row.kaAverage;
  return row.finalGrade;
}

export function displayFor(row, column, systemId) {
  const override = row.overrides[column];
  if (override) return override;
  return displayValueFromAverage(averageValue(row, column), systemId);
}

export function exactFor(row, column, systemId = row.gradeSystem) {
  if (column === "final" && systemId !== "points_0_15") return formatFinalGrade(row.finalGrade);
  return formatAverage(averageValue(row, column));
}

export function gradebookCsvFilename(data) {
  return `${(data.class_name || "Klasse").replace(/\s+/g, "_")}_Notenstand.csv`;
}

export function gradebookCsvText(data, rows = buildGradebookRows(data), columns = averageColumns(sortedSessions(data), averageWeights(data), data?.grade_system)) {
  const sessions = sortedSessions(data);
  const header = [
    "Vorname",
    "Nachname",
    ...sessions.map((session) => `${session.category === "klausur" ? examTerms(data.grade_system).long : (slType(session) === "written" ? "SL schriftl." : "SL mündl.")}: ${session.title} ${session.date} (x${session.weight ?? 1})`),
    ...columns.map((column) => column.label),
  ];

  const lines = [header.map(csvEscape).join(";")];
  rows.forEach((row) => {
    lines.push([
      row.student.first_name,
      row.student.last_name,
      ...row.sessionCells.map((cell) => cell.value),
      ...columns.map((column) => displayFor(row, column.key, data.grade_system)),
    ].map(csvEscape).join(";"));
  });

  return "\ufeff" + lines.join("\n");
}

export function gradebookCsvFile(data, rows, columns) {
  return new File([gradebookCsvText(data, rows, columns)], gradebookCsvFilename(data), { type: "text/csv;charset=utf-8" });
}
