import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, Mail, Percent, Printer, Send, X } from "lucide-react";
import api from "../lib/api";
import { gradeColorClasses, gradeTier } from "../lib/grades";
import {
  csvEscape,
  displayValueFromAverage,
  finalGradeFromAverages,
  formatAverage,
  formatFinalGrade,
  gradeOptions,
  gradeToNumber,
  overrideOptions,
  weightedAverage,
} from "../lib/gradebook";
import { normalizeExamGradeValue, shouldUseWholeExamGrades } from "../lib/gradeScales";
import { triggerDownload } from "../lib/exportClass";

function examTerms(systemId) {
  return systemId === "points_0_15"
    ? { short: "KL", long: "Klausur", total: "KL gesamt" }
    : { short: "KA", long: "Klassenarbeit", total: "KA gesamt" };
}

function slType(session) {
  return session.category === "klausur" ? null : (session.sl_type === "written" ? "written" : "oral");
}

function dateValue(date) {
  const match = String(date || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const [, day, month, year] = match;
  return Number(`${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`);
}

function deToIso(date) {
  const match = String(date || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isoToDe(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return String(date || "");
  const [, year, month, day] = match;
  return `${day.padStart(2, "0")}.${month.padStart(2, "0")}.${year}`;
}

function sortedSessions(data) {
  return (data.sessions || []).slice().sort((a, b) => {
    const group = (session) => session.category === "klausur" ? 0 : (slType(session) === "oral" ? 1 : 2);
    return group(a) - group(b)
      || dateValue(a.date) - dateValue(b.date)
      || String(a.created_at || "").localeCompare(String(b.created_at || ""))
      || String(a.title || "").localeCompare(String(b.title || ""), "de", { sensitivity: "base" });
  });
}

function averageWeights(data) {
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

function buildRows(data) {
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
    const slAverage = weightedPair(slOralAverage, slWrittenAverage, weights.sl_oral, weights.sl_written);
    const overridesForStudent = {
      sl_oral: overrideMap.get(`${student.id}:sl_oral`) || "",
      sl_written: overrideMap.get(`${student.id}:sl_written`) || "",
      sl: overrideMap.get(`${student.id}:sl`) || "",
      ka: overrideMap.get(`${student.id}:ka`) || "",
      final: overrideMap.get(`${student.id}:final`) || "",
    };
    const effectiveSlOral = overridesForStudent.sl_oral ? gradeToNumber(overridesForStudent.sl_oral, data.grade_system) : slOralAverage;
    const effectiveSlWritten = overridesForStudent.sl_written ? gradeToNumber(overridesForStudent.sl_written, data.grade_system) : slWrittenAverage;
    const computedEffectiveSl = weightedPair(effectiveSlOral, effectiveSlWritten, weights.sl_oral, weights.sl_written);
    const effectiveSl = overridesForStudent.sl ? gradeToNumber(overridesForStudent.sl, data.grade_system) : computedEffectiveSl;
    const effectiveKa = overridesForStudent.ka ? gradeToNumber(overridesForStudent.ka, data.grade_system) : kaAverage;
    const finalGrade = finalGradeFromAverages(effectiveSl, effectiveKa);

    return {
      student,
      sessionCells,
      slOralAverage,
      slWrittenAverage,
      slAverage,
      kaAverage,
      finalGrade,
      overrides: overridesForStudent,
    };
  });
}

function averageColumns(sessions, weights, systemId) {
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

function displayFor(row, column, systemId) {
  const override = row.overrides[column];
  if (override) return override;
  return displayValueFromAverage(averageValue(row, column), systemId);
}

function exactFor(row, column) {
  if (column === "final") return formatFinalGrade(row.finalGrade);
  return formatAverage(averageValue(row, column));
}

function gradebookCsv(data, rows, columns) {
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

  return new File(["\ufeff", lines.join("\n")], `${(data.class_name || "Klasse").replace(/\s+/g, "_")}_Notenstand.csv`, { type: "text/csv;charset=utf-8" });
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PRINT_COLORS = {
  1: { bg: "#10b981", fg: "#ffffff", border: "#047857" },
  2: { bg: "#a3e635", fg: "#1c1917", border: "#65a30d" },
  3: { bg: "#eab308", fg: "#1c1917", border: "#a16207" },
  4: { bg: "#fb923c", fg: "#ffffff", border: "#ea580c" },
  5: { bg: "#ef4444", fg: "#ffffff", border: "#b91c1c" },
  6: { bg: "#991b1b", fg: "#ffffff", border: "#450a0a" },
};

function printGrade(value, systemId, detail = "") {
  if (!value) return '<span class="empty">-</span>';
  const color = PRINT_COLORS[gradeTier(value, systemId)] || { bg: "#f5f5f4", fg: "#78716c", border: "#d6d3d1" };
  const sub = detail ? '<span class="grade-detail">' + htmlEscape(detail) + '</span>' : "";
  return '<span class="grade-pill" style="background:' + color.bg + ';color:' + color.fg + ';border-color:' + color.border + '"><span>' + htmlEscape(value) + '</span>' + sub + '</span>';
}

function gradebookPrintHtml(data, rows, columns) {
  const sessions = sortedSessions(data);
  const title = (data.class_name || "Klasse") + " - Notenstand";
  const now = new Date().toLocaleDateString("de-DE");
  const sessionHeaders = sessions.map((session) => {
    const label = session.category === "klausur" ? examTerms(data.grade_system).long : (slType(session) === "written" ? "SL schriftl." : "SL mündl.");
    return '<th><div class="kind">' + htmlEscape(label) + '</div><div>' + htmlEscape(session.title) + '</div><small>' + htmlEscape(session.date) + ' · x' + htmlEscape(session.weight ?? 1) + '</small></th>';
  }).join("");
  const averageHeaders = columns.map((column) => '<th class="avg"><div>' + htmlEscape(column.label) + '</div><small>' + htmlEscape(column.hint) + '</small></th>').join("");
  const body = rows.map((row) => {
    const sessionCells = row.sessionCells.map((cell) => '<td>' + printGrade(cell.value, data.grade_system) + '</td>').join("");
    const averageCells = columns.map((column) => {
      const shown = displayFor(row, column.key, data.grade_system);
      return '<td>' + printGrade(shown, data.grade_system, exactFor(row, column.key)) + '</td>';
    }).join("");
    return '<tr><th class="name">' + htmlEscape(row.student.last_name) + ', ' + htmlEscape(row.student.first_name) + '</th>' + sessionCells + averageCells + '</tr>';
  }).join("");

  return '<!doctype html><html lang="de"><head><meta charset="utf-8" /><title>' + htmlEscape(title) + '</title><style>'
    + '@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1c1917;margin:0}'
    + 'header{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:12px}h1{font-size:20px;margin:0}.meta{color:#78716c;font-size:11px;font-weight:700}'
    + 'table{width:100%;border-collapse:collapse;table-layout:auto;font-size:10px}th,td{border:1px solid #a8a29e;padding:4px;text-align:center;vertical-align:middle;break-inside:avoid}'
    + 'thead th{background:#292524;color:#fff;font-weight:800}thead th.avg{background:#44403c}th.name{text-align:left;white-space:nowrap;background:#f5f5f4;font-weight:800}'
    + '.kind{font-size:9px;text-transform:uppercase;letter-spacing:.04em;opacity:.88}small{display:block;font-size:8px;line-height:1.2;opacity:.82;margin-top:2px}'
    + '.grade-pill{display:inline-flex;min-width:28px;min-height:20px;padding:2px 5px;border:1.5px solid;border-radius:7px;align-items:center;justify-content:center;flex-direction:column;font-weight:900;line-height:1}'
    + '.grade-detail{font-size:7px;margin-top:2px;opacity:.85;font-weight:800}.empty{color:#a8a29e;font-weight:800}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}'
    + '</style></head><body><header><div><h1>' + htmlEscape(title) + '</h1><div class="meta">' + htmlEscape(rows.length) + ' Lernende · ' + htmlEscape(now) + '</div></div><div class="meta">n.b.</div></header>'
    + '<table><thead><tr><th>Lernende*r</th>' + sessionHeaders + averageHeaders + '</tr></thead><tbody>' + body + '</tbody></table>'
    + '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},150);});</script></body></html>';
}
function studentName(student) {
  return String((student?.first_name || "") + " " + (student?.last_name || "")).trim();
}

function mailGrade(value, systemId, detail = "") {
  if (!value) return '<span style="color:#a8a29e;font-weight:800">-</span>';
  const color = PRINT_COLORS[gradeTier(value, systemId)] || { bg: "#f5f5f4", fg: "#78716c", border: "#d6d3d1" };
  const label = detail ? String(value) + " (" + String(detail) + ")" : String(value);
  return '<span style="display:inline-block;min-width:36px;padding:3px 7px;border:1.5px solid ' + color.border + ';border-radius:7px;background:' + color.bg + ';color:' + color.fg + ';font-weight:900;line-height:1.15">' + htmlEscape(label) + '</span>';
}

function gradebookMailTableHtml(data, row, columns) {
  const examCells = (row.sessionCells || []).filter((cell) => cell.session.category === "klausur");
  const examHeaders = examCells.map((cell) => '<th style="border:1px solid #a8a29e;background:#0369a1;color:#fff;padding:6px;text-align:center"><div>' + htmlEscape(examTerms(data.grade_system).short) + '</div><small>' + htmlEscape(cell.session.title) + '<br>' + htmlEscape(cell.session.date) + ' · x' + htmlEscape(cell.session.weight ?? 1) + '</small></th>').join("");
  const examValues = examCells.map((cell) => '<td style="border:1px solid #d6d3d1;padding:6px;text-align:center">' + mailGrade(cell.value, data.grade_system) + '</td>').join("");
  const averageHeaders = columns.map((column) => '<th style="border:1px solid #a8a29e;background:#44403c;color:#fff;padding:6px;text-align:center"><div>' + htmlEscape(column.label) + '</div><small>' + htmlEscape(column.hint) + '</small></th>').join("");
  const averageCells = columns.map((column) => {
    const shown = displayFor(row, column.key, data.grade_system);
    return '<td style="border:1px solid #d6d3d1;padding:6px;text-align:center">' + mailGrade(shown, data.grade_system, exactFor(row, column.key)) + '</td>';
  }).join("");
  return '<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:12px;max-width:100%"><thead><tr><th style="border:1px solid #a8a29e;background:#292524;color:#fff;padding:6px;text-align:left">Lernende*r</th>' + examHeaders + averageHeaders + '</tr></thead><tbody><tr><th style="border:1px solid #d6d3d1;background:#f5f5f4;padding:6px;text-align:left;white-space:nowrap">' + htmlEscape(row.student.last_name) + ', ' + htmlEscape(row.student.first_name) + '</th>' + examValues + averageCells + '</tr></tbody></table>';
}

function gradebookMailHtml(data, row, columns, teacherConfig) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.45"><p>Hallo ' + htmlEscape(studentName(row.student)) + ',</p><p>dies ist Ihr aktueller Notenstand.</p>' + gradebookMailTableHtml(data, row, columns) + '<p>Mit freundlichen Grüßen<br>' + htmlEscape(teacherConfig.name || "") + '</p></div>';
}

function gradebookMailText(row, teacherConfig) {
  return "Hallo " + studentName(row.student) + ",\n\ndies ist Ihr aktueller Notenstand.\n\nMit freundlichen Grüßen\n" + (teacherConfig.name || "");
}

function buildMailMessage(data, row, columns, teacherConfig) {
  return {
    student_id: row.student.id,
    to: row.student.email || "",
    subject: "Aktueller Notenstand " + (data.class_name || ""),
    html: gradebookMailHtml(data, row, columns, teacherConfig),
    text: gradebookMailText(row, teacherConfig),
    student_name: studentName(row.student),
  };
}

function teacherConfigMissing(config) {
  return !String(config?.name || "").trim() || !String(config?.email || "").trim() || !String(config?.password || "").trim();
}

function MailConfirmModal({ request, sending, result, onSend, onClose }) {
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [request]);
  if (!request) return null;

  const messages = request.messages || [];
  const current = messages[index] || null;
  const missingConfig = teacherConfigMissing(request.teacherConfig);
  const canSend = messages.length > 0 && !missingConfig && !sending;

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[150] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="mail-confirm-modal">
        <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.92, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-3xl border-2 border-stone-900 bg-white shadow-brutal">
          <div className="flex shrink-0 items-start gap-3 border-b-2 border-stone-900 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-stone-900 bg-stone-900 text-white"><Mail className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">Notenstandsmail bestätigen</p>
              <h3 className="font-heading text-2xl font-black text-stone-900">{messages.length === 1 ? "Eine Mail" : messages.length + " Mails"}</h3>
              {request.missingRecipients > 0 && <p className="mt-1 text-sm font-bold text-amber-800">{request.missingRecipients} Lernende ohne Mailadresse werden übersprungen.</p>}
            </div>
            <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-900" aria-label="Schließen"><X className="h-5 w-5" /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-5">
            <div className="mb-4 flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-100 px-4 py-3 font-bold text-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>Mailversand funktioniert nur aus dem Schulnetz. In der reinen Browser/iPad-Version ist zusätzlich ein SMTP-fähiger Mail-Transport nötig.</span>
            </div>
            {missingConfig && (
              <div className="mb-4 rounded-2xl border-2 border-rose-300 bg-rose-100 px-4 py-3 font-bold text-rose-900">
                Lehrendenkonfiguration fehlt oder ist unvollständig. Bitte Name, Mailadresse und IServPasswort eintragen.
              </div>
            )}
            {messages.length === 0 ? (
              <div className="rounded-2xl border-2 border-stone-200 bg-stone-50 px-4 py-6 text-center font-bold text-stone-500">Für diese Auswahl gibt es keine importierten Mailadressen.</div>
            ) : current ? (
              <>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm font-bold text-stone-600">
                    <div className="truncate">An: <span className="text-stone-900">{current.student_name}</span> · {current.to}</div>
                    <div className="truncate">Betreff: {current.subject}</div>
                  </div>
                  {messages.length > 1 && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} className="rounded-xl border-2 border-stone-300 bg-white p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                      <span className="min-w-16 text-center font-mono text-sm font-black">{index + 1} / {messages.length}</span>
                      <button type="button" onClick={() => setIndex((value) => Math.min(messages.length - 1, value + 1))} disabled={index >= messages.length - 1} className="rounded-xl border-2 border-stone-300 bg-white p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
                <div className="overflow-auto rounded-2xl border-2 border-stone-200 bg-white p-4" dangerouslySetInnerHTML={{ __html: current.html }} />
              </>
            ) : null}
            {result && (
              <div className={"mt-4 flex items-start gap-3 rounded-2xl border-2 px-4 py-3 font-bold " + (result.ok ? "border-emerald-300 bg-emerald-100 text-emerald-900" : "border-rose-300 bg-rose-100 text-rose-900")}>
                {result.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
                <span>{result.message}</span>
              </div>
            )}
          </div>

          <div className="grid shrink-0 gap-2 border-t-2 border-stone-200 p-5 sm:grid-cols-2">
            <button type="button" onClick={onClose} className="rounded-2xl border-2 border-stone-300 bg-white px-5 py-3 font-heading font-extrabold text-stone-700">Abbrechen</button>
            <button type="button" onClick={() => onSend(messages)} disabled={!canSend} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-stone-900 px-5 py-3 font-heading font-extrabold text-white shadow-brutal-sm disabled:opacity-40">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              {messages.length === 1 ? "Mail senden" : "Alle Mails senden"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function AverageCell({ row, column, tone, systemId, onEdit }) {
  const shown = displayFor(row, column, systemId);
  const exact = exactFor(row, column);
  const overridden = !!row.overrides[column];
  const toneBg = tone === "sl" ? "bg-emerald-50" : tone === "ka" ? "bg-sky-50" : "bg-stone-50";

  return (
    <td className={`border-l-2 border-t-2 border-stone-200 px-3 py-2 text-center align-middle ${toneBg}`}>
      {shown ? (
        <button
          type="button"
          onClick={() => onEdit(row, column)}
          className={`inline-flex min-w-16 flex-col items-center rounded-xl border-2 px-3 py-1 shadow-brutal-sm transition-transform active:scale-95 ${gradeColorClasses(shown, systemId)}`}
          title="Durchschnittsnote überschreiben"
        >
          <span className="font-mono text-2xl font-black leading-none">{shown}</span>
          <span className="mt-0.5 text-[11px] font-black leading-none opacity-85">{exact || "-"}</span>
          {overridden && <span className="mt-1 rounded-full bg-white/25 px-1.5 py-0.5 text-[9px] font-black uppercase leading-none">manuell</span>}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onEdit(row, column)}
          className="rounded-xl border-2 border-dashed border-stone-300 px-3 py-2 font-bold text-stone-300"
          title="Durchschnittsnote überschreiben"
        >
          -
        </button>
      )}
    </td>
  );
}

function SessionGradeCell({ row, cell, systemId, onEdit }) {
  const toneBg = cell.session.category === "klausur" ? "bg-sky-50" : "bg-emerald-50";
  const showCalculated = cell.calculated_value && (cell.manual_override || cell.calculated_value !== cell.value);

  return (
    <td className={`border-l border-t-2 border-stone-200 px-2 py-2 text-center align-middle ${toneBg}`}>
      {cell.value ? (
        <button
          type="button"
          onClick={() => onEdit(row, cell)}
          className={`inline-flex min-w-12 flex-col items-center justify-center rounded-xl border-2 px-2.5 py-1 font-mono text-base font-black shadow-brutal-sm transition-transform active:scale-95 ${gradeColorClasses(cell.value, systemId)}`}
          title="Note anpassen"
        >
          <span>{cell.value}</span>
          {showCalculated && <span className="mt-0.5 text-[10px] font-black opacity-80">ber. {cell.calculated_value}</span>}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onEdit(row, cell)}
          className="rounded-xl border-2 border-dashed border-stone-300 px-3 py-1.5 font-bold text-stone-300 hover:border-stone-900 hover:text-stone-900"
          title="Note eintragen"
        >
          -
        </button>
      )}
    </td>
  );
}

function PickerModal({ picker, systemId, onPick, onClear, onClose }) {
  const isAverage = picker?.kind === "average";
  const wholeExamGrades = shouldUseWholeExamGrades(picker?.session, systemId);
  const options = wholeExamGrades ? overrideOptions(systemId) : (isAverage ? overrideOptions(systemId) : gradeOptions(systemId));
  const title = isAverage ? "Durchschnitt überschreiben" : "Note anpassen";
  const clearLabel = isAverage ? "Automatisch berechnen" : "Note entfernen";
  const gridCols = systemId === "points_0_15" ? "grid-cols-4" : isAverage ? "grid-cols-3" : wholeExamGrades ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4";

  return (
    <AnimatePresence>
      {picker && (
        <motion.div className="fixed inset-0 z-[140] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="gradebook-picker">
          <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ scale: 0.92, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-md rounded-3xl border-2 border-stone-900 bg-white p-6 shadow-brutal">
            <button onClick={onClose} className="absolute right-4 top-4 text-stone-400 hover:text-stone-900" aria-label="Schließen"><X className="h-5 w-5" /></button>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">{title}</p>
            <h3 className="mt-1 font-heading text-2xl font-black text-stone-900">{picker.student.first_name} {picker.student.last_name}</h3>
            <p className="mt-1 text-sm font-bold text-stone-500">{picker.label}</p>
            <div className={`mt-5 grid gap-2 ${gridCols}`}>
              {options.map((option) => (
                <button key={option} onClick={() => onPick(option)} className={`rounded-xl border-2 px-3 py-3 font-mono text-xl font-black transition-all active:scale-95 ${gradeColorClasses(option, systemId)} ${picker.currentValue === option ? "ring-4 ring-stone-900" : ""}`}>{option}</button>
              ))}
            </div>
            <button onClick={onClear} className="mt-4 w-full rounded-xl border-2 border-stone-300 bg-white px-4 py-3 font-bold text-stone-600 hover:border-stone-900">{clearLabel}</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HeaderEditor({ editor, onSaveSession, onDeleteSession, onSaveAverageWeight, onClose }) {
  const isSession = editor?.kind === "sessionHeader";
  const isAverage = editor?.kind === "averageHeader";
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [weight, setWeight] = useState("1");
  const [sessionSlType, setSessionSlType] = useState("oral");

  useEffect(() => {
    if (!editor) return;
    if (isSession) {
      setTitle(editor.session.title || "");
      setDate(deToIso(editor.session.date));
      setWeight(String(editor.session.weight ?? 1).replace(".", ","));
      setSessionSlType(slType(editor.session) || "oral");
    } else if (isAverage) {
      setTitle(editor.column.label || "");
      setDate("");
      setWeight(String(editor.column.weight ?? editor.column.fixedWeight ?? 1).replace(".", ","));
      setSessionSlType("oral");
    }
  }, [editor, isSession, isAverage]);

  if (!editor) return null;
  const fixed = isAverage && !!editor.column.fixedWeight;
  const canChangeSlType = isSession && editor.session.category !== "klausur";

  const submit = (event) => {
    event.preventDefault();
    if (isSession) {
      onSaveSession(editor.session.id, {
        title,
        date: isoToDe(date),
        weight: parseFloat(String(weight).replace(",", ".")) || 1,
        sl_type: canChangeSlType ? sessionSlType : undefined,
      });
    } else if (isAverage && !fixed) {
      onSaveAverageWeight(editor.column.key, parseFloat(String(weight).replace(",", ".")) || 1);
    } else {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[145] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="header-editor">
        <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onClose} />
        <motion.form initial={{ scale: 0.92, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} onSubmit={submit} className="relative w-full max-w-md rounded-3xl border-2 border-stone-900 bg-white p-6 shadow-brutal">
          <button type="button" onClick={onClose} className="absolute right-4 top-4 text-stone-400 hover:text-stone-900" aria-label="Schließen"><X className="h-5 w-5" /></button>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">Spalte bearbeiten</p>
          <h3 className="mt-1 font-heading text-2xl font-black text-stone-900">{isSession ? "Bewertung" : editor.column.label}</h3>

          <div className="mt-5 space-y-4">
            {isSession && (
              <label className="block">
                <span className="text-sm font-bold text-stone-700">Name</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900" />
              </label>
            )}
            {isSession && (
              <label className="block">
                <span className="text-sm font-bold text-stone-700">Datum</span>
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900" />
              </label>
            )}
            {canChangeSlType && (
              <div>
                <span className="text-sm font-bold text-stone-700">Art</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setSessionSlType("oral")} className={"rounded-xl border-2 px-4 py-3 font-heading font-extrabold " + (sessionSlType === "oral" ? "border-stone-900 bg-emerald-400 text-stone-900 shadow-brutal-sm" : "border-stone-300 bg-white text-stone-500")}>mündl.</button>
                  <button type="button" onClick={() => setSessionSlType("written")} className={"rounded-xl border-2 px-4 py-3 font-heading font-extrabold " + (sessionSlType === "written" ? "border-stone-900 bg-emerald-400 text-stone-900 shadow-brutal-sm" : "border-stone-300 bg-white text-stone-500")}>schrftl.</button>
                </div>
              </div>
            )}
            <label className="block">
              <span className="text-sm font-bold text-stone-700">Gewichtung</span>
              <input type="number" min="0.1" step="0.1" value={fixed ? "1" : weight} onChange={(event) => setWeight(event.target.value)} disabled={fixed} className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-mono font-black text-stone-900 outline-none focus:border-stone-900 disabled:bg-stone-100 disabled:text-stone-400" />
            </label>
            {fixed && <p className="rounded-xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-600">Diese Spalte ist für die Endnote fest mit Gewichtung 1 gesetzt.</p>}
          </div>

          <div className="mt-6 space-y-2">
            <button type="submit" className="w-full rounded-xl border-2 border-stone-900 bg-emerald-400 px-4 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none">{fixed ? "Schließen" : "Speichern"}</button>
            {isSession && (
              <button type="button" onClick={() => onDeleteSession(editor.session)} className="w-full rounded-xl border-2 border-rose-300 bg-white px-4 py-3 font-heading font-extrabold text-rose-700 hover:border-rose-500">
                Spalte löschen
              </button>
            )}
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
}

export default function GradebookModal({ classId, className, open, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(null);
  const [headerEditor, setHeaderEditor] = useState(null);
  const [mailRequest, setMailRequest] = useState(null);
  const [mailSending, setMailSending] = useState(false);
  const [mailResult, setMailResult] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open || !classId) return;
    setLoading(true);
    setError(null);
    setPicker(null);
    setHeaderEditor(null);
    setMailRequest(null);
    setMailResult(null);
    api.get(`/classes/${classId}/gradebook`)
      .then((res) => setData(res.data))
      .catch(() => setError("Notenstand konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [open, classId]);

  const weights = useMemo(() => (data ? averageWeights(data) : { sl_oral: 1, sl_written: 1, sl: 1, ka: 1 }), [data]);
  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const sessions = useMemo(() => (data ? sortedSessions(data) : []), [data]);
  const columns = useMemo(() => averageColumns(sessions, weights, data?.grade_system), [sessions, weights, data?.grade_system]);

  const exportCsv = () => {
    if (!data) return;
    triggerDownload(gradebookCsv(data, rows, columns));
  };

  const printGradebook = () => {
    if (!data) return;
    const popup = window.open("", "_blank");
    if (!popup) {
      setError("Druckfenster konnte nicht geöffnet werden.");
      return;
    }
    popup.document.open();
    popup.document.write(gradebookPrintHtml(data, rows, columns));
    popup.document.close();
    popup.focus();
  };

  const prepareMail = async (targetRows) => {
    if (!data) return;
    setError(null);
    setMailResult(null);
    try {
      const configRes = await api.get("/teacher-config");
      const teacherConfig = configRes.data || {};
      const selectedRows = (targetRows || []).filter(Boolean);
      const rowsWithMail = selectedRows.filter((row) => row.student.email);
      const messages = rowsWithMail.map((row) => buildMailMessage(data, row, columns, teacherConfig));
      setMailRequest({
        teacherConfig,
        messages,
        missingRecipients: selectedRows.length - rowsWithMail.length,
      });
    } catch (err) {
      setError("Lehrendenkonfiguration konnte nicht geladen werden.");
    }
  };

  const sendMails = async (messages) => {
    if (!mailRequest) return;
    setMailSending(true);
    setMailResult(null);
    try {
      const payload = { teacher: mailRequest.teacherConfig, messages };
      if (window.nbMailBridge?.sendGradebookMails) {
        await window.nbMailBridge.sendGradebookMails(payload);
      } else {
        await api.post("/mail/gradebook", payload);
      }
      setMailResult({ ok: true, message: messages.length === 1 ? "Mail wurde versendet." : messages.length + " Mails wurden versendet." });
    } catch (err) {
      setMailResult({ ok: false, message: err?.response?.data?.detail || "Mailversand fehlgeschlagen." });
    } finally {
      setMailSending(false);
    }
  };

  const editAverage = (row, column) => {
    const columnInfo = columns.find((item) => item.key === column);
    setPicker({ kind: "average", student: row.student, column, label: columnInfo?.label || "Durchschnitt", currentValue: row.overrides[column] || "" });
  };

  const editGrade = (row, cell) => {
    const prefix = cell.session.category === "klausur" ? examTerms(data.grade_system).short : (slType(cell.session) === "written" ? "SL schrftl." : "SL mündl.");
    setPicker({ kind: "grade", student: row.student, session: cell.session, label: `${prefix}: ${cell.session.title} ${cell.session.date}`, currentValue: cell.value || "", currentCalculated: cell.calculated_value || "" });
  };

  const saveAverageOverride = async (value) => {
    await api.put(`/classes/${data.class_id}/gradebook-overrides`, { student_id: picker.student.id, column: picker.column, value });
    setData((current) => {
      const rest = (current.average_overrides || []).filter((override) => !(override.student_id === picker.student.id && override.column === picker.column));
      return { ...current, average_overrides: value ? [...rest, { student_id: picker.student.id, column: picker.column, value }] : rest };
    });
  };

  const saveSessionGrade = async (value) => {
    const isPoints = !!picker.session.points_mode;
    const calculated = normalizeExamGradeValue(picker.currentCalculated || "", picker.session, data.grade_system);
    const normalizedValue = normalizeExamGradeValue(value, picker.session, data.grade_system);
    if (normalizedValue) {
      await api.post(`/sessions/${picker.session.id}/grades`, { student_id: picker.student.id, value: normalizedValue, calculated_value: calculated, manual_override: isPoints });
    } else if (isPoints && calculated) {
      await api.post(`/sessions/${picker.session.id}/grades`, { student_id: picker.student.id, value: calculated, calculated_value: calculated, manual_override: false });
    } else {
      await api.delete(`/sessions/${picker.session.id}/grades/${picker.student.id}`);
    }
    setData((current) => {
      const rest = (current.grades || []).filter((grade) => !(grade.session_id === picker.session.id && grade.student_id === picker.student.id));
      const nextValue = normalizedValue || (isPoints ? calculated : "");
      return { ...current, grades: nextValue ? [...rest, { session_id: picker.session.id, student_id: picker.student.id, value: nextValue, calculated_value: calculated, manual_override: !!(isPoints && normalizedValue) }] : rest };
    });
  };

  const savePickerValue = async (value) => {
    if (!data || !picker) return;
    setError(null);
    try {
      if (picker.kind === "average") await saveAverageOverride(value);
      else await saveSessionGrade(value);
      setPicker(null);
    } catch (err) {
      setError("Änderung konnte nicht gespeichert werden.");
    }
  };

  const saveSessionHeader = async (sessionId, values) => {
    setError(null);
    try {
      const res = await api.put(`/sessions/${sessionId}`, values);
      setData((current) => ({ ...current, sessions: current.sessions.map((session) => (session.id === sessionId ? { ...session, ...res.data } : session)) }));
      setHeaderEditor(null);
    } catch (err) {
      setError("Spalte konnte nicht gespeichert werden.");
    }
  };

  const deleteSessionColumn = async (session) => {
    setError(null);
    try {
      await api.delete(`/sessions/${session.id}`);
      setData((current) => ({
        ...current,
        sessions: current.sessions.filter((item) => item.id !== session.id),
        grades: (current.grades || []).filter((grade) => grade.session_id !== session.id),
      }));
      setHeaderEditor(null);
    } catch (err) {
      setError("Spalte konnte nicht gelöscht werden.");
    }
  };

  const saveAverageWeight = async (column, weight) => {
    setError(null);
    try {
      await api.put(`/classes/${data.class_id}/gradebook-weights`, { column, weight });
      setData((current) => {
        const rest = (current.average_weights || []).filter((item) => item.column !== column);
        return { ...current, average_weights: [...rest, { column, weight }] };
      });
      setHeaderEditor(null);
    } catch (err) {
      setError("Gewichtung konnte nicht gespeichert werden.");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="gradebook-modal">
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} className="relative flex h-[100dvh] w-full max-w-7xl flex-col overflow-hidden border-2 border-stone-900 bg-stone-50 shadow-brutal sm:h-[94dvh] sm:rounded-3xl">
            <header className="flex shrink-0 items-center gap-3 border-b-2 border-stone-900 bg-white px-5 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-stone-900 text-white"><FileSpreadsheet className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Notenstand</p><h2 className="truncate font-heading text-xl font-black text-stone-900 sm:text-2xl">{className}</h2></div>
              <button onClick={printGradebook} disabled={!data || loading} className="hidden rounded-xl border-2 border-stone-900 bg-white px-4 py-2.5 font-heading font-extrabold text-stone-900 shadow-brutal-sm transition-all active:translate-y-0.5 active:shadow-none disabled:opacity-40 sm:flex sm:items-center sm:gap-2"><Printer className="h-4 w-4" /> Drucken</button>
              <button onClick={exportCsv} disabled={!data || loading} className="hidden rounded-xl border-2 border-stone-900 bg-emerald-400 px-4 py-2.5 font-heading font-extrabold text-stone-900 shadow-brutal-sm transition-all active:translate-y-0.5 active:shadow-none disabled:opacity-40 sm:flex sm:items-center sm:gap-2"><Download className="h-4 w-4" /> CSV</button>
              <button onClick={onClose} className="text-stone-400 hover:text-stone-900" aria-label="Schliessen"><X className="h-6 w-6" /></button>
            </header>

            {error && <p className="mx-5 mt-4 rounded-2xl border-2 border-rose-300 bg-rose-100 px-4 py-3 font-bold text-rose-900">{error}</p>}

            <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-5">
              {loading ? (
                <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-stone-400" /></div>
              ) : data ? (
                <div className="h-full min-w-full overflow-hidden rounded-2xl border-2 border-stone-900 bg-white shadow-brutal-sm">
                  <div className="h-full overflow-auto overscroll-contain">
                    <table className="min-w-max border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr>
                          <th className="sticky left-0 top-0 z-50 min-w-64 border-b-2 border-stone-900 bg-stone-900 text-left font-heading text-sm font-black text-white">
                            <button type="button" onClick={() => prepareMail(rows)} className="flex h-full w-full items-center justify-between gap-3 px-4 py-3 text-left text-white hover:bg-white/10" title="Notenstandsmails an alle Lernenden vorbereiten">
                              <span>Lernende*r</span>
                              <Mail className="h-4 w-4 shrink-0" />
                            </button>
                          </th>
                          {sessions.map((session) => {
                            const isKa = session.category === "klausur";
                            const kind = isKa ? examTerms(data.grade_system).short : (slType(session) === "written" ? "SL schrftl." : "SL mündl.");
                            return (
                              <th key={session.id} className={`sticky top-0 z-40 min-w-32 border-b-2 border-l border-stone-900 text-center align-bottom text-stone-900 ${isKa ? "bg-sky-400" : "bg-emerald-400"}`}>
                                <div className="relative h-full">
                                  <button type="button" onClick={() => setHeaderEditor({ kind: "sessionHeader", session })} className="block h-full w-full px-3 py-2 text-stone-900 hover:bg-white/25" title="Spalte bearbeiten">
                                    <span className="inline-flex rounded-full border border-stone-900/20 bg-white/70 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-stone-900">{kind}{session.points_mode ? " · P→N" : ""}</span>
                                    <div className="mt-1 font-bold leading-tight">{session.title}</div>
                                    <div className="mt-0.5 text-xs font-bold text-stone-700">{session.date} · x{session.weight ?? 1}</div>
                                  </button>
                                  {session.points_mode && (
                                    <button type="button" onClick={(event) => { event.stopPropagation(); navigate(`/points/${session.id}`); }} className="absolute right-1.5 top-1.5 rounded-lg border-2 border-stone-900 bg-white p-1 text-stone-900 shadow-brutal-sm hover:bg-amber-100" title="Punkte -> Noten öffnen" aria-label="Punkte -> Noten öffnen">
                                      <Percent className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                          {columns.map((column, index) => (
                            <th key={column.key} className={`sticky top-0 z-40 min-w-40 border-b-2 ${index === 0 ? "border-l-2" : "border-l"} border-stone-900 text-center align-bottom ${column.tone === "final" ? "bg-stone-800 text-white" : column.tone === "ka" ? "bg-sky-600 text-white" : "bg-emerald-600 text-white"}`}>
                              <button type="button" onClick={() => column.tone !== "final" && setHeaderEditor({ kind: "averageHeader", column })} disabled={column.tone === "final"} className="block h-full w-full px-3 py-2 disabled:cursor-default disabled:hover:bg-transparent hover:bg-white/25" title={column.tone === "final" ? "Endnote" : "Gewichtung bearbeiten"}>
                                <div className="font-heading font-black">{column.label}</div>
                                <div className={`mt-1 text-[10px] leading-snug ${column.tone === "final" ? "font-medium text-stone-300" : "font-bold text-white/85"}`}>{column.hint}</div>
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, index) => {
                          const rowBg = index % 2 === 0 ? "bg-white" : "bg-stone-50";
                          return (
                            <tr key={row.student.id} className={rowBg}>
                              <td className={`sticky left-0 z-30 border-t-2 border-stone-200 px-3 py-2 font-bold text-stone-900 ${rowBg}`}>
                                <button type="button" onClick={() => prepareMail([row])} disabled={!row.student.email} className="flex max-w-60 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35" title={row.student.email ? "Notenstandsmail vorbereiten" : "Keine Mailadresse importiert"}>
                                  <Mail className="h-4 w-4 shrink-0 text-stone-500" />
                                  <span className="truncate">{row.student.first_name} <span className="font-black">{row.student.last_name}</span></span>
                                </button>
                              </td>
                              {row.sessionCells.map((cell) => <SessionGradeCell key={cell.session.id} row={row} cell={cell} systemId={data.grade_system} onEdit={editGrade} />)}
                              {columns.map((column) => <AverageCell key={column.key} row={row} column={column.key} tone={column.tone} systemId={data.grade_system} onEdit={editAverage} />)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 border-t-2 border-stone-200 bg-white p-4 sm:hidden"><button onClick={printGradebook} disabled={!data || loading} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-white px-4 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm disabled:opacity-40"><Printer className="h-4 w-4" /> Drucken</button><button onClick={exportCsv} disabled={!data || loading} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-emerald-400 px-4 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm disabled:opacity-40"><Download className="h-4 w-4" /> CSV</button></div>
          </motion.div>

          <PickerModal picker={picker} systemId={data?.grade_system} onPick={savePickerValue} onClear={() => savePickerValue("")} onClose={() => setPicker(null)} />
          <HeaderEditor editor={headerEditor} onSaveSession={saveSessionHeader} onDeleteSession={deleteSessionColumn} onSaveAverageWeight={saveAverageWeight} onClose={() => setHeaderEditor(null)} />
          <MailConfirmModal request={mailRequest} sending={mailSending} result={mailResult} onSend={sendMails} onClose={() => { setMailRequest(null); setMailResult(null); }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
