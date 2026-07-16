import { allGradeScales, evaluatePercent, normalizeExamGradeValue, normalizePointScale, parseGradeScaleCsv, pointsNeededForBetter } from "./gradeScales";

test("imports tendency grades from comma separated scale csv", () => {
  const scale = parseGradeScaleCsv("Note,Punkte,Prozent_ab\n2+,12,80\n2,11,75\n2-,10,70\n5+,3,33\n5,2,27\n5-,1,20\n", "MEDA.csv");
  expect(scale.id).toBe("MEDA");
  expect(scale.rows.map((row) => row.grade)).toEqual(["2+", "2", "2-", "5+", "5", "5-"]);
  expect(scale.rows.find((row) => row.grade === "2+")?.points).toBe("12");
});

test("imports decimal comma in the last column of comma separated scale csv", () => {
  const scale = parseGradeScaleCsv("Note,Punkte,Prozent_ab\n5+;3;37,5\n".replace(/;/g, ","), "GYM.csv");
  expect(scale.rows[0].grade).toBe("5+");
  expect(scale.rows[0].minPercent).toBe(37.5);
});


test("can hide built-in grade scales from merged scale list", () => {
  const scales = allGradeScales([], ["MEDA"]);
  expect(scales.some((scale) => scale.id === "MEDA")).toBe(false);
  expect(scales.some((scale) => scale.id === "GYM")).toBe(true);
});


test("evaluatePercent keeps raw tendency value while normalizing whole exam grades", () => {
  const session = { category: "klausur" };
  const scale = { rows: [{ grade: "2+", points: "12", minPercent: 80 }] };
  const evaluated = evaluatePercent(85, scale, "grades_1_6", session);

  expect(evaluated.rawValue).toBe("2+");
  expect(evaluated.value).toBe("2");
  expect(normalizeExamGradeValue(evaluated.rawValue, session, "grades_1_6")).toBe("2");
});


test("fills missing tendency thresholds for 1-6 point scales", () => {
  const scale = normalizePointScale({ rows: [
    { grade: "1", points: "14", minPercent: 92 },
    { grade: "2", points: "11", minPercent: 81 },
    { grade: "3", points: "8", minPercent: 67 },
    { grade: "4", points: "5", minPercent: 50 },
    { grade: "5", points: "2", minPercent: 30 },
    { grade: "6", points: "0", minPercent: 0 },
  ] }, "grades_1_6");

  expect(scale.rows.map((row) => row.grade)).toEqual(["1+", "1", "1-", "2+", "2", "2-", "3+", "3", "3-", "4+", "4", "4-", "5+", "5", "5-", "6"]);
  expect(scale.rows.find((row) => row.grade === "1")?.minPercent).toBe(92);
  expect(scale.rows.find((row) => row.grade === "2")?.minPercent).toBe(81);
  expect(scale.rows.find((row) => row.grade === "1-")?.minPercent).toBeGreaterThan(81);
  expect(scale.rows.find((row) => row.grade === "2+")?.minPercent).toBeGreaterThan(81);
});

test("written SL points grades keep tendencies while exams keep whole grades", () => {
  const scale = { rows: [
    { grade: "1", points: "14", minPercent: 90 },
    { grade: "2", points: "11", minPercent: 75 },
    { grade: "3", points: "8", minPercent: 60 },
  ] };

  const writtenSl = evaluatePercent(82, scale, "grades_1_6", { category: "sonstige", sl_type: "written" });
  const exam = evaluatePercent(82, scale, "grades_1_6", { category: "klausur" });

  expect(writtenSl.value).toBe("2+");
  expect(writtenSl.rawValue).toBe("2+");
  expect(exam.value).toBe("2");
  expect(exam.rawValue).toBe("2+");
});


test("0-15 point scales fill and evaluate every point grade", () => {
  const scale = { rows: [
    { grade: "1", points: "14", minPercent: 90 },
    { grade: "2", points: "11", minPercent: 75 },
    { grade: "3", points: "8", minPercent: 60 },
    { grade: "4", points: "5", minPercent: 45 },
    { grade: "5", points: "2", minPercent: 30 },
    { grade: "6", points: "0", minPercent: 0 },
  ] };
  const normalized = normalizePointScale(scale, "points_0_15");

  expect(normalized.rows.map((row) => row.points)).toEqual(["15", "14", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"]);
  expect(evaluatePercent(100, scale, "points_0_15", { category: "klausur" }).value).toBe("15");
  expect(evaluatePercent(82, scale, "points_0_15", { category: "klausur" }).value).toBe("12");
  const better = pointsNeededForBetter(82, 100, scale, 3, "points_0_15", { category: "klausur" });
  expect(better.target).toBe("13");
  expect(better.points).toBe(3);
});

test("written 1-6 SL distance targets the next better grade tier", () => {
  const scale = { rows: [
    { grade: "1", points: "14", minPercent: 90 },
    { grade: "2", points: "11", minPercent: 75 },
    { grade: "3", points: "8", minPercent: 60 },
  ] };

  const writtenSl = evaluatePercent(82, scale, "grades_1_6", { category: "sonstige", sl_type: "written" });
  const better = pointsNeededForBetter(82, 100, scale, writtenSl.rowIndex, "grades_1_6", { category: "sonstige", sl_type: "written" });

  expect(writtenSl.value).toBe("2+");
  expect(better.target).toBe("1-");
  expect(better.points).toBe(3);
});
