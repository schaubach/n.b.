import { gradeTier } from "./grades";
import { gradeToNumber } from "./gradebook";
import {
  displayFor,
  exactFor,
  examTerms,
  slType,
  sortedSessions,
} from "./gradebookExport";
import { shouldUseWholeExamGrades } from "./gradeScales";

const GRADE_COLORS = {
  1: { fillColor: [16, 185, 129], textColor: [255, 255, 255] },
  2: { fillColor: [163, 230, 53], textColor: [28, 25, 23] },
  3: { fillColor: [234, 179, 8], textColor: [28, 25, 23] },
  4: { fillColor: [251, 146, 60], textColor: [255, 255, 255] },
  5: { fillColor: [239, 68, 68], textColor: [255, 255, 255] },
  6: { fillColor: [153, 27, 27], textColor: [255, 255, 255] },
};

const HEADER_COLORS = {
  name: { fillColor: [41, 37, 36], textColor: [255, 255, 255] },
  ka: { fillColor: [2, 132, 199], textColor: [255, 255, 255] },
  sl: { fillColor: [5, 150, 105], textColor: [255, 255, 255] },
  final: { fillColor: [41, 37, 36], textColor: [255, 255, 255] },
};

function calculatedDetail(cell, systemId) {
  if (systemId === "points_0_15" && cell.session.points_mode) return "";
  if (!cell.calculated_value) return "";
  if (shouldUseWholeExamGrades(cell.session, systemId) && cell.session.points_mode) {
    const numeric = gradeToNumber(cell.calculated_value, systemId);
    if (typeof numeric === "number") return numeric.toFixed(1).replace(".", ",");
  }
  if (cell.calculated_value === cell.value) return "";
  if (shouldUseWholeExamGrades(cell.session, systemId)) {
    const numeric = gradeToNumber(cell.calculated_value, systemId);
    if (typeof numeric === "number") return numeric.toFixed(1).replace(".", ",");
  }
  return cell.calculated_value;
}

function gradeCell(value, detail, systemId) {
  if (!value) return { content: "-", styles: { textColor: [168, 162, 158] } };
  const color = GRADE_COLORS[gradeTier(value, systemId)] || { fillColor: [245, 245, 244], textColor: [120, 113, 108] };
  return {
    content: detail ? `${value}\n${detail}` : String(value),
    styles: {
      ...color,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
    },
  };
}

function headerCell(content, tone) {
  return {
    content,
    styles: {
      ...(HEADER_COLORS[tone] || HEADER_COLORS.name),
      fontStyle: "bold",
      halign: tone === "name" ? "left" : "center",
      valign: "middle",
    },
  };
}

export function gradebookPdfFilename(data) {
  const className = String(data?.class_name || "Klasse")
    .trim()
    .replace(/[^a-zA-Z0-9äöüÄÖÜß._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "Klasse";
  return `${className}_Notenstand.pdf`;
}

export function buildGradebookPdfTable(data, rows, columns) {
  const sessions = sortedSessions(data);
  const head = [
    headerCell("Lernende*r", "name"),
    ...sessions.map((session) => {
      const isExam = session.category === "klausur";
      const kind = isExam ? examTerms(data.grade_system).short : (slType(session) === "written" ? "SL schrftl." : "SL mündl.");
      return headerCell(`${kind}\n${session.title}\n${session.date} · x${session.weight ?? 1}`, isExam ? "ka" : "sl");
    }),
    ...columns.map((column) => headerCell(`${column.label}\n${column.hint}`, column.tone)),
  ];
  const body = rows.map((row) => [
    {
      content: `${row.student.last_name}, ${row.student.first_name}${row.student.inactive ? "\n(nicht im Import)" : ""}`,
      styles: { fontStyle: "bold", halign: "left", valign: "middle" },
    },
    ...row.sessionCells.map((cell) => gradeCell(cell.value, calculatedDetail(cell, data.grade_system), data.grade_system)),
    ...columns.map((column) => gradeCell(
      displayFor(row, column.key, data.grade_system),
      exactFor(row, column.key, data.grade_system),
      data.grade_system
    )),
  ]);
  return { head, body };
}

export async function createGradebookPdfFile(data, rows, columns) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const table = buildGradebookPdfTable(data, rows, columns);
  const title = `${data.class_name || "Klasse"} - Notenstand`;
  const created = new Date().toLocaleDateString("de-DE");

  doc.setProperties({ title, subject: "Notenstand", author: "n.b.", creator: "n.b." });
  autoTable(doc, {
    head: [table.head],
    body: table.body,
    startY: 20,
    margin: { top: 20, right: 8, bottom: 12, left: 8 },
    theme: "grid",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: 0,
    horizontalPageBreakBehaviour: "immediately",
    styles: {
      font: "helvetica",
      fontSize: 6.5,
      cellPadding: 1.6,
      lineColor: [168, 162, 158],
      lineWidth: 0.2,
      overflow: "linebreak",
      halign: "center",
      valign: "middle",
      minCellWidth: 18,
    },
    headStyles: { fontSize: 6, minCellHeight: 14 },
    bodyStyles: { minCellHeight: 9 },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: { 0: { cellWidth: 42, minCellWidth: 42, halign: "left" } },
    willDrawPage: () => {
      doc.setTextColor(28, 25, 23);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(title, 8, 9);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 113, 108);
      doc.text(`${rows.length} Lernende · ${created}`, 8, 14);
      doc.text("n.b.", doc.internal.pageSize.getWidth() - 8, 9, { align: "right" });
    },
    didDrawPage: () => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 113, 108);
      doc.text(
        `Seite ${doc.internal.getNumberOfPages()}`,
        doc.internal.pageSize.getWidth() - 8,
        doc.internal.pageSize.getHeight() - 5,
        { align: "right" }
      );
    },
  });

  return new File([doc.output("blob")], gradebookPdfFilename(data), { type: "application/pdf" });
}
