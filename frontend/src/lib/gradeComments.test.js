const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.crypto = { randomUUID: () => "grade-1", getRandomValues: (bytes) => bytes.fill(1) };

let mockState;
jest.mock("./cryptoStore", () => ({
  getState: () => mockState,
  mutateState: async (update) => update(mockState),
}));
const api = require("./localApi").default;
const { buildGradebookRows } = require("./gradebookExport");

beforeEach(() => {
  mockState = {
    classes: [{ id: "class", name: "Test", grade_system: "grades_1_6" }],
    students: [{ id: "student", class_id: "class", first_name: "Ada", last_name: "Alpha" }],
    sessions: [{ id: "session", class_id: "class", category: "sonstige", sl_type: "oral" }],
    grades: [],
  };
});

test("stores grade comments and exposes them in the session and gradebook", async () => {
  const comment = 'Gute Begründung; "Beispiel" <b>bleibt Text</b>';
  await api.post("/sessions/session/grades", { student_id: "student", value: "2+", comment });
  expect((await api.get("/sessions/session")).data.students[0].grade_comment).toBe(comment);
  const data = (await api.get("/classes/class/gradebook")).data;
  expect(data.grades[0].comment).toBe(comment);
  expect(buildGradebookRows(data)[0].sessionCells[0].comment).toBe(comment);
});

test("later grade corrections preserve comments unless explicitly cleared", async () => {
  await api.post("/sessions/session/grades", { student_id: "student", value: "2", comment: "Beitrag" });
  await api.post("/sessions/session/grades", { student_id: "student", value: "3" });
  expect(mockState.grades[0].comment).toBe("Beitrag");
  await api.post("/sessions/session/grades", { student_id: "student", value: "3", comment: "" });
  expect(mockState.grades[0].comment).toBe("");
});

test("enforces 150 characters without modifying a saved grade on rejection", async () => {
  await api.post("/sessions/session/grades", { student_id: "student", value: "2", comment: "a".repeat(150) });
  await expect(api.post("/sessions/session/grades", { student_id: "student", value: "4", comment: "a".repeat(151) })).rejects.toBeTruthy();
  await expect(api.post("/sessions/session/grades", { student_id: "student", value: "4", comment: {} })).rejects.toBeTruthy();
  expect(mockState.grades[0].value).toBe("2");
  expect(mockState.grades[0].comment).toHaveLength(150);
});

test("deleting a grade removes its comment and does not leak it into a new grade", async () => {
  await api.post("/sessions/session/grades", { student_id: "student", value: "2", comment: "Beitrag" });
  await api.delete("/sessions/session/grades/student");
  expect(mockState.grades).toHaveLength(0);
  await api.post("/sessions/session/grades", { student_id: "student", value: "1" });
  expect(mockState.grades[0].comment).toBe("");
});
