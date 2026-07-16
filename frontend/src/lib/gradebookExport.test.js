import { buildGradebookRows, displayFor, exactFor } from "./gradebookExport";

test("0-15 gradebook averages stay on point scale with exact detail", () => {
  const data = {
    grade_system: "points_0_15",
    students: [{ id: "student-1", first_name: "Ada", last_name: "Lovelace" }],
    sessions: [
      { id: "ka-1", category: "klausur", title: "KL 1", date: "01.07.2026", weight: 1 },
      { id: "sl-1", category: "sonstige", sl_type: "written", title: "SL 1", date: "02.07.2026", weight: 1 },
    ],
    grades: [
      { session_id: "ka-1", student_id: "student-1", value: "15" },
      { session_id: "sl-1", student_id: "student-1", value: "12" },
    ],
    average_overrides: [],
    average_weights: [],
  };

  const [row] = buildGradebookRows(data);

  expect(row.kaAverage).toBe(15);
  expect(row.slWrittenAverage).toBe(12);
  expect(row.finalGrade).toBe(13.5);
  expect(displayFor(row, "ka", "points_0_15")).toBe("15");
  expect(displayFor(row, "sl_written", "points_0_15")).toBe("12");
  expect(displayFor(row, "final", "points_0_15")).toBe("14");
  expect(exactFor(row, "final")).toBe("13,5");
});
