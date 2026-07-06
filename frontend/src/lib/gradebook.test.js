import {
  displayValueFromAverage,
  finalGradeFromAverages,
  gradeOptions,
  gradeToNumber,
  overrideOptions,
  weightedAverage,
  wholeGradeFromAverage,
} from "./gradebook";

test("converts tendency grades to numeric values", () => {
  expect(gradeToNumber("1+", "grades_1_6")).toBe(0.7);
  expect(gradeToNumber("1-", "grades_1_6")).toBe(1.3);
  expect(gradeToNumber("2+", "grades_1_6")).toBe(1.7);
  expect(gradeToNumber("2-", "grades_1_6")).toBe(2.3);
});

test("calculates weighted averages", () => {
  expect(weightedAverage([{ value: 1, weight: 1 }, { value: 3, weight: 3 }])).toBe(2.5);
});

test("rounds averages by grade thresholds and combines SL and KA", () => {
  expect(wholeGradeFromAverage(1.5)).toBe(1);
  expect(wholeGradeFromAverage(2.5)).toBe(2);
  expect(wholeGradeFromAverage(2.51)).toBe(3);
  expect(finalGradeFromAverages(1.7, 2.8)).toBe(2.5);
});

test("uses system-specific grade, override and display values", () => {
  expect(gradeOptions("grades_1_6")).toEqual(["1+", "1", "1-", "2+", "2", "2-", "3+", "3", "3-", "4+", "4", "4-", "5", "6"]);
  expect(gradeOptions("points_0_15")[0]).toBe("15");
  expect(gradeOptions("points_0_15").at(-1)).toBe("0");
  expect(overrideOptions("grades_1_6")).toEqual(["1", "2", "3", "4", "5", "6"]);
  expect(overrideOptions("points_0_15")[0]).toBe("15");
  expect(overrideOptions("points_0_15").at(-1)).toBe("0");
  expect(displayValueFromAverage(1.7, "grades_1_6")).toBe("2");
  expect(displayValueFromAverage(1.7, "points_0_15")).toBe("12");
});
