export const GRADE_NUMBER = {
  "1+": 0.7, "1": 1.0, "1-": 1.3,
  "2+": 1.7, "2": 2.0, "2-": 2.3,
  "3+": 2.7, "3": 3.0, "3-": 3.3,
  "4+": 3.7, "4": 4.0, "4-": 4.3,
  "5+": 4.7, "5": 5.0, "5-": 5.3,
  "6": 6.0,
};

export const POINT_NUMBER = {
  "15": 0.7, "14": 1.0, "13": 1.3,
  "12": 1.7, "11": 2.0, "10": 2.3,
  "9": 2.7, "8": 3.0, "7": 3.3,
  "6": 3.7, "5": 4.0, "4": 4.3,
  "3": 4.7, "2": 5.0, "1": 5.3, "0": 6.0,
};

export const POINT_GRADE_LABEL = {
  "15": "1+", "14": "1", "13": "1-",
  "12": "2+", "11": "2", "10": "2-",
  "9": "3+", "8": "3", "7": "3-",
  "6": "4+", "5": "4", "4": "4-",
  "3": "5+", "2": "5", "1": "5-", "0": "6",
};

export function pointGradeLabel(value) {
  return POINT_GRADE_LABEL[String(value ?? "").trim()] || "";
}

export function gradeToNumber(value, systemId) {
  if (value === null || value === undefined || value === "") return null;
  if (systemId === "points_0_15") {
    const numeric = Number(String(value).replace(",", "."));
    return Number.isFinite(numeric) ? numeric : null;
  }
  const numeric = GRADE_NUMBER[String(value)];
  return typeof numeric === "number" ? numeric : null;
}

export function weightedAverage(items) {
  let sum = 0;
  let weightSum = 0;
  items.forEach((item) => {
    if (typeof item.value !== "number") return;
    const weight = Number(item.weight) || 1;
    sum += item.value * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? sum / weightSum : null;
}

export function formatAverage(value) {
  return typeof value === "number" ? value.toFixed(1).replace(".", ",") : "";
}

export function wholeGradeFromAverage(value) {
  if (typeof value !== "number") return null;
  if (value <= 1.5) return 1;
  if (value <= 2.5) return 2;
  if (value <= 3.5) return 3;
  if (value <= 4.5) return 4;
  if (value <= 5.5) return 5;
  return 6;
}

export function finalGradeFromAverages(slAverage, kaAverage, systemId = "grades_1_6") {
  if (systemId === "points_0_15") {
    if (typeof slAverage !== "number" && typeof kaAverage !== "number") return null;
    if (typeof slAverage !== "number") return kaAverage;
    if (typeof kaAverage !== "number") return slAverage;
    return (slAverage + kaAverage) / 2;
  }
  const sl = wholeGradeFromAverage(slAverage);
  const ka = wholeGradeFromAverage(kaAverage);
  if (sl === null && ka === null) return null;
  if (sl === null) return ka;
  if (ka === null) return sl;
  return (sl + ka) / 2;
}

export function formatFinalGrade(value) {
  if (typeof value !== "number") return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

export function gradeOptions(systemId) {
  if (systemId === "points_0_15") {
    return ["15", "14", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"];
  }
  return ["1+", "1", "1-", "2+", "2", "2-", "3+", "3", "3-", "4+", "4", "4-", "5+", "5", "5-", "6"];
}

export function overrideOptions(systemId) {
  if (systemId === "points_0_15") {
    return ["15", "14", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0"];
  }
  return ["1", "2", "3", "4", "5", "6"];
}

export function displayValueFromAverage(value, systemId) {
  if (typeof value !== "number") return "";
  if (systemId !== "points_0_15") return String(wholeGradeFromAverage(value));
  return String(Math.max(0, Math.min(15, Math.round(value))));
}

export function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
