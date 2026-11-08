const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
let nextId = 0;
global.crypto = { randomUUID: () => `new-${++nextId}` };
let mockState;
jest.mock("./cryptoStore", () => ({
  getState: () => mockState,
  mutateState: async (mutator) => { const draft = JSON.parse(JSON.stringify(mockState)); const result = mutator(draft); mockState = draft; return result; },
}));
const api = require("./localApi").default;
const { deleteInactiveStudentInState } = require("./localApi");
const { parsePointsImport } = require("./pointsImport");
const { evaluatePercent, normalizePointScale } = require("./gradeScales");
const { __backupTest } = require("./backup");

beforeEach(() => {
  mockState = {
    classes: [{ id: "class", name: "Test", grade_system: "grades_1_6", grade_scale_id: "TEST" }],
    students: [{ id: "a", class_id: "class", email: "a@test.de" }, { id: "b", class_id: "class", email: "b@test.de" }],
    sessions: [], grades: [], point_sessions: [],
    grade_scales: [{ id: "TEST", name: "TEST", rows: [{ grade: "1+", points: "15", minPercent: 95 }, { grade: "2+", points: "12", minPercent: 80 }, { grade: "6", points: "0", minPercent: 0 }] }],
  };
});

const review = () => parsePointsImport("Mail;erreichte Punkte;maximale Punkte;Status\na@test.de;8;10;geprüft\nb@test.de;;10;fehlt", mockState.students).map((row) => ({ ...row, decision: row.student_id === "b" ? "missing" : "accept" }));
const payload = () => ({ class_id: "class", title: "Import", category: "klausur", grade_scale_id: "TEST", review: review() });

test.each([["grades_1_6", "klausur", "2"], ["grades_1_6", "sonstige", "2+"], ["points_0_15", "klausur", "12"], ["points_0_15", "sonstige", "12"]])("calculates %s / %s with existing grading rules", async (system, category, expected) => {
  mockState.classes[0].grade_system = system;
  const result = await api.post("/sessions/import-points", { ...payload(), category, sl_type: "written" });
  expect(mockState.grades).toHaveLength(1);
  expect(mockState.grades[0].value).toBe(expected);
  const loaded = (await api.get(`/sessions/${result.data.id}/points`)).data;
  expect(loaded.students[0].point_summary).toMatchObject({ achieved: 8, max: 10, percent: 80 });
  expect(loaded.students[1].point_summary.calculated_value).toBe("");
  expect(loaded.import_review).toEqual(payload().review);
});

test("missing stays empty, zero is a real grade, different maxima use each row's denominator", async () => {
  const draft = review().map((row) => ({ ...row, achieved: row.student_id === "a" ? "0" : "8", maximum: row.student_id === "a" ? "10" : "20", decision: "accept" }));
  await api.post("/sessions/import-points", { ...payload(), review: draft });
  expect(mockState.grades[0].value).toBe("6");
  const expected = evaluatePercent(40, normalizePointScale(mockState.grade_scales[0]), "grades_1_6", { category: "klausur" }).value;
  expect(mockState.grades[1].value).toBe(expected);
});

test("rejects unresolved or oral imports without creating a session", async () => {
  const invalid = payload(); invalid.review[0].decision = "pending";
  await expect(api.post("/sessions/import-points", invalid)).rejects.toThrow();
  await expect(api.post("/sessions/import-points", { ...payload(), category: "sonstige", sl_type: "oral" })).rejects.toBeTruthy();
  expect(mockState.sessions).toEqual([]);
  expect(mockState.grades).toEqual([]);
});

test("reopens, recalculates, backs up and deletes imported totals with their owner", async () => {
  const result = await api.post("/sessions/import-points", payload());
  const draft = review(); draft[0].achieved = "10";
  await api.post("/sessions/import-points", { ...payload(), session_id: result.data.id, review: draft });
  expect(mockState.sessions).toHaveLength(1);
  expect(mockState.grades[0].value).toBe("1");
  expect(__backupTest.buildFilesFromState(mockState).find((file) => file.name === "data/state.csv").data).toContain("import_totals");
  mockState.students[0].inactive = true;
  deleteInactiveStudentInState(mockState, "a");
  expect(mockState.point_sessions[0].import_totals).toEqual([]);
  expect(mockState.point_sessions[0].import_review.some((row) => row.student_id === "a")).toBe(false);
  await api.delete(`/sessions/${result.data.id}`);
  expect(mockState.point_sessions).toEqual([]);
});

test("keeps an existing import editable after reclassifying its SL column", async () => {
  const result = await api.post("/sessions/import-points", { ...payload(), category: "sonstige", sl_type: "written" });
  mockState.sessions[0].sl_type = "oral";
  const draft = review(); draft[0].achieved = "10";
  await api.post("/sessions/import-points", { session_id: result.data.id, grade_scale_id: "TEST", review: draft });
  expect(mockState.sessions).toHaveLength(1);
  expect(mockState.grades[0].value).toBe("1+");
});

test("adds a new learner and their grade atomically using a fresh stable ID", async () => {
  const body = payload();
  body.review.push({ key: "extra", line: 4, mail: "new@test.de", student_id: "draft-1", achieved: "9", maximum: "10", status: "geprüft", decision: "accept", source_issues: [] });
  body.new_students = [{ temporary_id: "draft-1", first_name: "Neue", last_name: "Person", email: "NEW@test.de" }];
  await api.post("/sessions/import-points", body);
  const student = mockState.students.find((item) => item.email === "new@test.de");
  expect(student.id).not.toBe("draft-1");
  expect(student).toMatchObject({ first_name: "Neue", last_name: "Person", class_id: "class", inactive: false });
  expect(mockState.grades.some((grade) => grade.student_id === student.id)).toBe(true);
  expect(mockState.point_sessions[0].import_review[2].student_id).toBe(student.id);
});

test("does not add learners if another row fails validation or their mail already exists", async () => {
  const body = payload();
  body.new_students = [{ temporary_id: "draft-1", first_name: "Neue", last_name: "Person", email: "new@test.de" }];
  await expect(api.post("/sessions/import-points", body)).rejects.toThrow();
  expect(mockState.students).toHaveLength(2);
  expect(mockState.sessions).toHaveLength(0);
  body.new_students[0].email = "a@test.de";
  await expect(api.post("/sessions/import-points", body)).rejects.toBeTruthy();
  expect(mockState.students).toHaveLength(2);
});
