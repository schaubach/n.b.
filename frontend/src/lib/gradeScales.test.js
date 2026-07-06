import { parseGradeScaleCsv } from "./gradeScales";

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
