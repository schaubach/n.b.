import { importMail, importNumber, inspectPointsImport, parsePointsImport, validatePointsReview } from "./pointsImport";

const header = "\ufeffMail;erreichte Punkte;maximale Punkte;Status\r\n";
const students = [{ id: "a", email: "A@school.test", first_name: "Anna", last_name: "A" }, { id: "b", email: "b@school.test", first_name: "Ben", last_name: "B" }];

test("reads the supplied MeinWerk example without losing statuses or zero", () => {
  const fs = require("fs");
  const path = require("path");
  const text = fs.readFileSync(path.resolve(__dirname, "../../scripts/fixtures/meinwerk-points.csv"), "utf8");
  const people = ["anna.berg", "ben.cramer", "cem.demir", "dora.engel", "emil.fuchs", "gus.hahn", "ina.jung", "kai.lang", "lea.maier", "mo.nowak"].map((name) => ({ id: name, email: `${name}@schule.example` }));
  const rows = parsePointsImport(text, people);
  expect(rows).toHaveLength(10);
  expect(rows.filter((row) => row.decision === "accept")).toHaveLength(2);
  expect(rows.find((row) => row.student_id === "mo.nowak").achieved).toBe("0");
});

test("reads BOM, decimal comma, zero and missing values without conflating them", () => {
  const rows = parsePointsImport(header + "a@school.test;0;10;geprüft\r\nb@school.test;;10;fehlt\r\n", students);
  expect(rows[0]).toMatchObject({ student_id: "a", achieved: "0", decision: "accept" });
  expect(rows[1]).toMatchObject({ student_id: "b", achieved: "", decision: "pending" });
  expect(importNumber("7,5")).toBe(7.5);
  expect(importNumber("")).toBeNull();
  expect(importNumber("1foo")).toBeNaN();
});

test("uses headers rather than column positions and preserves quoted fields", () => {
  const rows = parsePointsImport('Status;maximale Punkte;Mail;erreichte Punkte;Extra\r\n"ungeprüft";10;A@SCHOOL.TEST;7,5;"Text; mit ""Zitat""\nund Umbruch"', students.slice(0, 1));
  expect(rows[0]).toMatchObject({ student_id: "a", maximum: "10", achieved: "7,5", status: "ungeprüft", decision: "pending" });
  expect(importMail("'+name@school.test")).toBe("+name@school.test");
});

test.each(["ungeprüft", "veraltet", "unveröffentlicht, geprüft", "unveröffentlicht, ungeprüft", "unveröffentlicht, veraltet", "neuer Status"])("requires a decision for %s", (status) => {
  const rows = parsePointsImport(header + `a@school.test;7;10;${status}`, students.slice(0, 1));
  expect(rows[0].decision).toBe("pending");
  expect(() => validatePointsReview(rows, students.slice(0, 1))).toThrow();
  rows[0].decision = "accept";
  expect(validatePointsReview(rows, students.slice(0, 1))[0].achieved).toBe(7);
});

test("does not silently pick one duplicate and allows skipping extras", () => {
  const rows = parsePointsImport(header + "a@school.test;5;10;geprüft\na@school.test;8;10;geprüft", students.slice(0, 1));
  expect(inspectPointsImport(rows, students)[0].errors.join()).toMatch(/Mehrere Zeilen/);
  rows[1].decision = "missing";
  rows[0].decision = "accept";
  expect(validatePointsReview(rows, students.slice(0, 1))).toEqual([{ student_id: "a", achieved: 5, maximum: 10 }]);
});

test("flags ambiguous class mail, absent mail, unknown people and absent class members", () => {
  const cls = [...students, { id: "c", email: "a@school.test" }];
  const rows = parsePointsImport(header + "a@school.test;5;10;geprüft\n;3;10;geprüft\nunknown@school.test;2;10;geprüft", cls);
  expect(rows[0].student_id).toBe("");
  expect(rows[0].source_issues.join()).toMatch(/mehreren Lernenden/);
  expect(rows.filter((row) => !row.line)).toHaveLength(3);
  expect(inspectPointsImport(rows, cls).every((check) => !check.ready)).toBe(true);
  expect(validatePointsReview(rows.map((row) => ({ ...row, decision: "missing" })), cls)).toEqual([]);
});

test("flags differing maxima and inactive students", () => {
  const cls = students.map((student) => ({ ...student, inactive: student.id === "b" }));
  const rows = parsePointsImport(header + "a@school.test;5;10;geprüft\nb@school.test;5;20;geprüft", cls);
  const checks = inspectPointsImport(rows, cls);
  expect(checks[0].warnings.join()).toMatch(/Höchstpunktzahlen/);
  expect(checks[1].warnings.join()).toMatch(/inaktiv/);
});

test.each(["-1;10", "12;10", "1;0", "1;", "abc;10", "1;Infinity", "1;1000000001"])("rejects invalid totals %s", (values) => {
  const rows = parsePointsImport(header + `a@school.test;${values};geprüft`, students.slice(0, 1)).map((row) => ({ ...row, decision: "accept" }));
  expect(() => validatePointsReview(rows, students.slice(0, 1))).toThrow();
});

test("rejects malformed headers and broken quoting; flags extra fields", () => {
  expect(() => parsePointsImport("Mail;Status\na;geprüft", students)).toThrow(/Spalte/);
  expect(() => parsePointsImport(header + 'a@school.test;"7;10;geprüft', students)).toThrow(/Anführungszeichen/);
  expect(() => parsePointsImport(header + 'a@school.test;"7"oops;10;geprüft', students)).toThrow(/Zeichen/);
  expect(parsePointsImport(header + "a@school.test;7;10;geprüft;extra", students)[0].source_issues.join()).toMatch(/Felder/);
});

test("requires reviewing newly added active class members", () => {
  const rows = parsePointsImport(header + "a@school.test;5;10;geprüft", students.slice(0, 1));
  expect(() => validatePointsReview(rows, students)).toThrow(/Klassenliste/);
});
