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

function compactColumns(data, sessions, columns) {
  const counters = { exam: 0, oral: 0, written: 0 };
  const sessionColumns = sessions.map((session) => {
    const isExam = session.category === "klausur";
    const type = isExam ? "exam" : (slType(session) === "written" ? "written" : "oral");
    counters[type] += 1;
    const prefix = isExam
      ? examTerms(data.grade_system).short
      : (type === "written" ? "S" : "M");
    const reference = `${prefix}${counters[type]}`;
    const kind = isExam
      ? examTerms(data.grade_system).long
      : (type === "written" ? "SL schriftlich" : "SL mündlich");
    return {
      reference,
      tone: isExam ? "ka" : "sl",
      legend: `${reference} = ${kind}: ${session.title} (${session.date}, x${session.weight ?? 1})`,
    };
  });
  const averageColumns = columns.map((column, index) => {
    const reference = `Ø${index + 1}`;
    return {
      reference,
      tone: column.tone,
      legend: `${reference} = ${column.label} (${column.hint})`,
    };
  });
  return { sessionColumns, averageColumns };
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
  const compact = compactColumns(data, sessions, columns);
  const head = [
    headerCell("Lernende*r", "name"),
    ...compact.sessionColumns.map((column) => headerCell(column.reference, column.tone)),
    ...compact.averageColumns.map((column) => headerCell(column.reference, column.tone)),
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
  return {
    head,
    body,
    legend: [...compact.sessionColumns, ...compact.averageColumns].map((column) => column.legend),
  };
}

export function pdfPageLabel(page, totalPages) {
  return `Seite ${page}/${totalPages}`;
}

function drawCell(doc, cell, x, y, width, height, alternate = false) {
  const styles = cell.styles || {};
  const fillColor = styles.fillColor || (alternate ? [250, 250, 249] : [255, 255, 255]);
  const textColor = styles.textColor || [68, 64, 60];
  const lines = String(cell.content ?? "").split("\n");
  const isLeft = styles.halign === "left";

  doc.setFillColor(...fillColor);
  doc.setDrawColor(168, 162, 158);
  doc.setLineWidth(0.2);
  doc.rect(x, y, width, height, "FD");
  doc.setTextColor(...textColor);
  doc.setFont("helvetica", styles.fontStyle === "bold" ? "bold" : "normal");

  if (isLeft) {
    doc.setFontSize(6.2);
    const wrapped = doc.splitTextToSize(lines.join(" "), width - 3).slice(0, 2);
    const lineHeight = 2.6;
    const firstY = y + (height - wrapped.length * lineHeight) / 2 + 2;
    doc.text(wrapped, x + 1.5, firstY);
    return;
  }

  const centerX = x + width / 2;
  if (lines.length > 1) {
    doc.setFontSize(7);
    doc.text(lines[0], centerX, y + height / 2 - 0.4, { align: "center" });
    doc.setFontSize(5.3);
    doc.text(lines.slice(1).join(" "), centerX, y + height / 2 + 2.5, { align: "center" });
  } else {
    doc.setFontSize(7);
    doc.text(lines[0], centerX, y + height / 2 + 1.1, { align: "center" });
  }
}

function drawPageHeading(doc, title, subtitle, legendLines, legendTop, legendHeight, pageWidth) {
  doc.setTextColor(28, 25, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, 8, 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120, 113, 108);
  doc.text(subtitle, 8, 14);
  doc.text("n.b.", pageWidth - 8, 9, { align: "right" });
  doc.setFillColor(245, 245, 244);
  doc.setDrawColor(214, 211, 209);
  doc.roundedRect(8, legendTop, pageWidth - 16, legendHeight, 1.5, 1.5, "FD");
  doc.setFontSize(6.5);
  doc.setTextColor(68, 64, 60);
  doc.text(legendLines, 10, legendTop + 3.5);
}

export async function createGradebookPdfFile(data, rows, columns) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const table = buildGradebookPdfTable(data, rows, columns);
  const title = `${data.class_name || "Klasse"} - Notenstand`;
  const created = new Date().toLocaleDateString("de-DE");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const nameWidth = 38;
  const gradeWidth = 12.5;
  const headerHeight = 7;
  const rowHeight = 9;
  const maxGradeColumns = Math.max(1, Math.floor((pageWidth - 24 - nameWidth) / gradeWidth));
  const gradeIndexes = table.head.slice(1).map((_cell, index) => index + 1);
  const columnGroups = [];
  for (let index = 0; index < gradeIndexes.length; index += maxGradeColumns) {
    columnGroups.push(gradeIndexes.slice(index, index + maxGradeColumns));
  }
  if (columnGroups.length === 0) columnGroups.push([]);

  doc.setProperties({ title, subject: "Notenstand", author: "n.b.", creator: "n.b." });
  let pageStarted = false;
  columnGroups.forEach((group) => {
    const groupHead = [table.head[0], ...group.map((index) => table.head[index])];
    const groupBody = table.body.map((row) => [row[0], ...group.map((index) => row[index])]);
    const groupLegend = group.map((index) => table.legend[index - 1]);
    const legendText = groupLegend.length > 0 ? `Spalten: ${groupLegend.join("  |  ")}` : "Keine Bewertungen vorhanden";

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    const legendLines = doc.splitTextToSize(legendText, pageWidth - 20);
    const legendTop = 17;
    const legendHeight = Math.max(8, legendLines.length * 3 + 4);
    const tableTop = legendTop + legendHeight + 3;
    const rowsPerPage = Math.max(1, Math.floor((pageHeight - 13 - tableTop - headerHeight) / rowHeight));
    const rowGroups = [];
    for (let index = 0; index < groupBody.length; index += rowsPerPage) {
      rowGroups.push(groupBody.slice(index, index + rowsPerPage));
    }
    if (rowGroups.length === 0) rowGroups.push([]);

    rowGroups.forEach((pageRows, rowGroupIndex) => {
      if (pageStarted) doc.addPage();
      pageStarted = true;
      drawPageHeading(doc, title, `${rows.length} Lernende - ${created}`, legendLines, legendTop, legendHeight, pageWidth);

      let x = 8;
      groupHead.forEach((cell, index) => {
        const width = index === 0 ? nameWidth : gradeWidth;
        drawCell(doc, cell, x, tableTop, width, headerHeight);
        x += width;
      });

      pageRows.forEach((row, rowIndex) => {
        const absoluteRowIndex = rowGroupIndex * rowsPerPage + rowIndex;
        const y = tableTop + headerHeight + rowIndex * rowHeight;
        let cellX = 8;
        row.forEach((cell, index) => {
          const width = index === 0 ? nameWidth : gradeWidth;
          drawCell(doc, cell, cellX, y, width, rowHeight, absoluteRowIndex % 2 === 1);
          cellX += width;
        });
      });
    });
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 113, 108);
    doc.text(pdfPageLabel(page, totalPages), pageWidth - 8, pageHeight - 5, { align: "right" });
  }

  return new File([doc.output("blob")], gradebookPdfFilename(data), { type: "application/pdf" });
}
