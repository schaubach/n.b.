const { TextDecoder, TextEncoder } = require("util");

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.crypto = { randomUUID: () => "grade-1", getRandomValues: (bytes) => bytes.fill(1) };

const { recalculatePointGrades } = require("./localApi");
const { normalizePointScale } = require("./gradeScales");

function baseState() {
  const pointScale = normalizePointScale({ rows: [
    { grade: "1", points: "14", minPercent: 90 },
    { grade: "2", points: "11", minPercent: 75 },
    { grade: "3", points: "8", minPercent: 60 },
    { grade: "4", points: "5", minPercent: 45 },
    { grade: "5", points: "2", minPercent: 30 },
    { grade: "6", points: "0", minPercent: 0 },
  ] }, "points_0_15");

  return {
    classes: [{ id: "class-1", name: "BK A", grade_system: "points_0_15", grade_scale_id: "MEDA" }],
    students: [{ id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Lovelace" }],
    sessions: [{ id: "session-1", class_id: "class-1", title: "KL 1", date: "01.07.2026", weight: 1, category: "klausur", grade_scale_id: "MEDA", points_mode: true, point_scale_override: pointScale }],
    grades: [],
    point_sessions: [{
      session_id: "session-1",
      columns: [{ id: "task-1", title: "Aufgabe 1", max_points: 10 }],
      entries: [{ student_id: "student-1", column_id: "task-1", points: 10 }],
    }],
    grade_scales: [],
    hidden_grade_scales: [],
  };
}

test("point recalculation uses class grade system for 0-15 KL main value", () => {
  const state = baseState();
  const session = state.sessions[0];

  recalculatePointGrades(state, session);

  expect(state.grades).toHaveLength(1);
  expect(state.grades[0].value).toBe("15");
  expect(state.grades[0].calculated_value).toBe("15");
});
