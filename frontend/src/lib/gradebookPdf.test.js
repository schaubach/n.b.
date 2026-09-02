import { buildGradebookRows } from "./gradebookExport";
import { TextDecoder, TextEncoder } from "util";
import { buildGradebookPdfTable, createGradebookPdfFile, gradebookPdfFilename } from "./gradebookPdf";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

test("builds a color coded PDF table with sessions and averages", () => {
  const data = {
    class_name: "BK 1 A",
    grade_system: "grades_1_6",
    students: [{ id: "student-1", first_name: "Ada", last_name: "Lovelace" }],
    sessions: [{ id: "ka-1", category: "klausur", title: "KA 1", date: "01.09.2026", weight: 1 }],
    grades: [{ session_id: "ka-1", student_id: "student-1", value: "2", calculated_value: "2+", manual_override: true }],
    average_overrides: [],
    average_weights: [],
  };
  const rows = buildGradebookRows(data);
  const columns = [{ key: "ka", label: "KA gesamt", hint: "gewichteter Schnitt", tone: "ka" }];

  const table = buildGradebookPdfTable(data, rows, columns);

  expect(table.head.map((cell) => cell.content)).toEqual([
    "Lernende*r",
    "KA\nKA 1\n01.09.2026 · x1",
    "KA gesamt\ngewichteter Schnitt",
  ]);
  expect(table.body[0][0].content).toBe("Lovelace, Ada");
  expect(table.body[0][1].content).toBe("2\n1,7");
  expect(table.body[0][1].styles.fillColor).toEqual([163, 230, 53]);
  expect(gradebookPdfFilename(data)).toBe("BK_1_A_Notenstand.pdf");
});

test("creates a downloadable PDF file", async () => {
  const data = {
    class_name: "Testklasse",
    grade_system: "grades_1_6",
    students: [{ id: "student-1", first_name: "Ada", last_name: "Lovelace" }],
    sessions: [],
    grades: [],
    average_overrides: [],
    average_weights: [],
  };

  const file = await createGradebookPdfFile(data, buildGradebookRows(data), []);

  expect(file.name).toBe("Testklasse_Notenstand.pdf");
  expect(file.type).toBe("application/pdf");
  expect(file.size).toBeGreaterThan(500);
});
