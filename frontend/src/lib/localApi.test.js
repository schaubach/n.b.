const { TextDecoder, TextEncoder } = require("util");

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.crypto = { randomUUID: () => "grade-1", getRandomValues: (bytes) => bytes.fill(1) };

const localApi = require("./localApi");
const { applyBundledGradeScales, duplicateClassInState, recalculatePointGrades, oralGradeStatsForClass, normalizeSeatingPlan } = localApi;
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

test("oral assessment stats count only oral SL grades", () => {
  const state = {
    classes: [{ id: "class-1", name: "BK A", grade_system: "grades_1_6" }],
    students: [
      { id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Lovelace" },
      { id: "student-2", class_id: "class-1", first_name: "Grace", last_name: "Hopper" },
    ],
    sessions: [
      { id: "session-1", class_id: "class-1", title: "Mündlich 1", date: "01.07.2026", category: "sonstige", sl_type: "oral" },
      { id: "session-2", class_id: "class-1", title: "Mündlich 2", date: "02.07.2026", category: "sonstige", sl_type: "oral" },
      { id: "session-3", class_id: "class-1", title: "Schriftlich", date: "03.07.2026", category: "sonstige", sl_type: "written" },
    ],
    grades: [
      { session_id: "session-1", student_id: "student-1", value: "2" },
      { session_id: "session-2", student_id: "student-1", value: "3" },
      { session_id: "session-3", student_id: "student-2", value: "1" },
    ],
  };

  const stats = oralGradeStatsForClass(state, "class-1");

  expect(stats.counts.get("student-1")).toBe(2);
  expect(stats.counts.get("student-2")).toBe(0);
  expect(stats.average).toBe(1);
});

test("normalizes saved seating plans and appends newly imported students without closing gaps", () => {
  const state = {
    students: [
      { id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Alpha" },
      { id: "student-2", class_id: "class-1", first_name: "Berta", last_name: "Beta" },
      { id: "student-3", class_id: "class-1", first_name: "Clara", last_name: "Gamma" },
    ],
    seating_plans: [],
  };
  const plan = normalizeSeatingPlan(state, "class-1", {
    rows: 2,
    columns: 4,
    seats: [
      { row: 0, column: 0, student_id: "student-1" },
      { row: 0, column: 3, student_id: "student-3" },
      { row: 1, column: 0, student_id: "student-outside-class" },
    ],
  });

  expect(plan.rows).toBe(2);
  expect(plan.columns).toBe(4);
  expect(plan.seats).toEqual(expect.arrayContaining([
    { row: 0, column: 0, student_id: "student-1" },
    { row: 0, column: 1, student_id: "student-2" },
    { row: 0, column: 3, student_id: "student-3" },
  ]));
  expect(plan.seats).toHaveLength(3);
});

test("removes inactive students from the active seating grid", () => {
  const state = {
    students: [
      { id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Alpha" },
      { id: "student-2", class_id: "class-1", first_name: "Berta", last_name: "Beta", inactive: true },
      { id: "student-3", class_id: "class-1", first_name: "Clara", last_name: "Gamma" },
    ],
    seating_plans: [],
  };
  const plan = normalizeSeatingPlan(state, "class-1", {
    rows: 1,
    columns: 4,
    seats: [
      { row: 0, column: 0, student_id: "student-1" },
      { row: 0, column: 1, student_id: "student-2" },
    ],
  });

  expect(plan.seats).toEqual(expect.arrayContaining([
    { row: 0, column: 0, student_id: "student-1" },
    { row: 0, column: 1, student_id: "student-3" },
  ]));
  expect(plan.seats.some((seat) => seat.student_id === "student-2")).toBe(false);
});

test("keeps CSV-only students outside PDF layouts", () => {
  const state = {
    students: [
      { id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Alpha" },
      { id: "student-2", class_id: "class-1", first_name: "Berta", last_name: "Beta" },
    ],
    seating_plans: [],
  };
  const plan = normalizeSeatingPlan(state, "class-1", {
    rows: 1,
    columns: 4,
    preserve_unplaced: true,
    pdf_only_entries: [{ name: "Unbekannt Person", row: 0, column: 2 }],
    seats: [{ row: 0, column: 0, student_id: "student-1" }],
  });

  expect(plan.seats).toEqual([{ row: 0, column: 0, student_id: "student-1" }]);
  expect(plan.pdf_only_entries).toEqual([{ name: "Unbekannt Person", row: 0, column: 2 }]);
});

test("places a newly imported learner into a matching PDF-only seat", () => {
  const state = {
    students: [{ id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Alpha" }],
    seating_plans: [],
  };
  const plan = normalizeSeatingPlan(state, "class-1", {
    rows: 1,
    columns: 4,
    preserve_unplaced: true,
    pdf_only_entries: [{ name: "Alpha Ada", row: 0, column: 2 }],
    seats: [],
  });

  expect(plan.seats).toEqual([{ row: 0, column: 2, student_id: "student-1" }]);
  expect(plan.pdf_only_entries).toEqual([]);
});

test("duplicates class data, photos and seating plan without assessments", () => {
  const state = {
    classes: [{ id: "class-1", source_id: "csv:bk-a", name: "BK A", grade_system: "grades_1_6", grade_scale_id: "MEDA", created_at: "old" }],
    students: [
      { id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Alpha", photo: "data:image/jpeg;base64,PHOTO", inactive: false },
      { id: "student-2", class_id: "class-1", first_name: "Berta", last_name: "Beta", photo: null, inactive: true },
    ],
    seating_plans: [{ class_id: "class-1", rows: 1, columns: 2, seats: [{ row: 0, column: 0, student_id: "student-1" }], pdf_only_entries: [{ name: "Nur PDF", row: 0, column: 1 }] }],
    sessions: [{ id: "session-1", class_id: "class-1" }],
    grades: [{ id: "grade-1", session_id: "session-1", student_id: "student-1", value: "2" }],
    gradebook_overrides: [{ class_id: "class-1", student_id: "student-1", column: "final", value: "2" }],
    gradebook_weights: [{ class_id: "class-1", column: "oral", weight: 2 }],
    point_sessions: [{ session_id: "session-1", columns: [], entries: [] }],
    grade_scales: [],
    hidden_grade_scales: [],
  };
  const ids = ["class-copy", "student-copy-1", "student-copy-2"];

  const result = duplicateClassInState(state, "class-1", "", () => ids.shift());

  expect(result).toMatchObject({ id: "class-copy", name: "BK A (Kopie)", student_count: 2, photo_count: 1, session_count: 0 });
  const copiedStudents = state.students.filter((student) => student.class_id === "class-copy");
  expect(copiedStudents).toHaveLength(2);
  expect(copiedStudents[0]).toMatchObject({ id: "student-copy-1", photo: "data:image/jpeg;base64,PHOTO", inactive: false });
  expect(copiedStudents[1]).toMatchObject({ id: "student-copy-2", inactive: true });
  expect(state.seating_plans.find((plan) => plan.class_id === "class-copy")).toMatchObject({
    seats: [{ row: 0, column: 0, student_id: "student-copy-1" }],
    pdf_only_entries: [{ name: "Nur PDF", row: 0, column: 1 }],
  });
  expect(state.sessions.filter((session) => session.class_id === "class-copy")).toEqual([]);
  expect(state.grades).toHaveLength(1);
  expect(state.gradebook_overrides.filter((item) => item.class_id === "class-copy")).toEqual([]);
  expect(state.gradebook_weights.filter((item) => item.class_id === "class-copy")).toEqual([]);
});

test("bundled grade scales replace same-name local scales and keep custom scales", () => {
  const state = {
    classes: [{ id: "class-1", grade_scale_id: "legacy-meda" }],
    sessions: [{ id: "session-1", grade_scale_id: "legacy-meda" }],
    grade_scales: [
      { id: "legacy-meda", name: "MEDA", rows: [{ grade: "1", points: "15", minPercent: 77 }] },
      { id: "Eigene", name: "Eigene", rows: [{ grade: "1", points: "15", minPercent: 88 }] },
    ],
    hidden_grade_scales: ["MEDA"],
    app_meta: {},
  };

  const scales = applyBundledGradeScales(state, [{
    id: "MEDA",
    name: "MEDA",
    rows: [{ grade: "1+", points: "15", minPercent: 95 }],
  }], "1.6.1");

  expect(scales.find((scale) => scale.id === "MEDA")).toMatchObject({ built_in: true, rows: [{ grade: "1+", points: "15", minPercent: 95 }] });
  expect(scales.find((scale) => scale.id === "Eigene")).toBeTruthy();
  expect(state.grade_scales.some((scale) => scale.id === "legacy-meda")).toBe(false);
  expect(state.classes[0].grade_scale_id).toBe("MEDA");
  expect(state.sessions[0].grade_scale_id).toBe("MEDA");
  expect(state.hidden_grade_scales).not.toContain("MEDA");
  expect(state.app_meta.bundled_grade_scales_version).toBe("1.6.1");
});
