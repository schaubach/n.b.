import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import PointsImport from "./PointsImport";
import api from "../lib/api";

jest.mock("../lib/api", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("react-router-dom", () => ({
  useParams: () => ({ sessionId: "test" }),
  useLocation: () => ({ state: undefined }),
  useNavigate: () => jest.fn(),
}));

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderImport(system, category, achieved = "8,2", maximum = "10", extra = []) {
  const scale = { id: "TEST", name: "Test", rows: [
    { grade: "1", points: "14", minPercent: 90 },
    { grade: "2", points: "11", minPercent: 75 },
    { grade: "3", points: "8", minPercent: 60 },
  ] };
  api.get.mockResolvedValue({ data: {
    session: { entry_mode: "csv_points", grade_scale_id: "TEST", grade_system: system, category, sl_type: "written" },
    grade_scale: scale, grade_scales: [scale],
    students: ["a", ...extra.map((row) => row.id)].map((id) => ({ id, email: id + "@example.com", first_name: id, last_name: "Test" })),
    import_review: [{ id: "a", achieved, maximum }, ...extra].map((row, i) => ({ key: row.id, line: i + 2, mail: row.id + "@example.com", status: "geprüft", student_id: row.id, achieved: row.achieved, maximum: row.maximum, decision: row.decision || "accept", source_issues: [] })),
  } });
  await act(async () => { root.render(<PointsImport />); });
}

function edit(label, value) {
  const input = container.querySelector(`[aria-label="${label}"]`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test.each([
  ["grades_1_6", "sonstige", { "2+": 1, "2": 1, "2-": 1 }, 16],
  ["grades_1_6", "klausur", { "2": 3 }, 6],
  ["points_0_15", "klausur", { "12": 1, "11": 1, "10": 1 }, 16],
  ["points_0_15", "sonstige", { "12": 1, "11": 1, "10": 1 }, 16],
])("distribution preserves grading granularity for %s / %s", async (system, category, expected, bins) => {
  await renderImport(system, category, "8,2", "10", [
    { id: "b", achieved: "15", maximum: "20", decision: "pending" },
    { id: "c", achieved: "7", maximum: "10" },
    { id: "d", achieved: "8", maximum: "10", decision: "missing" },
    { id: "e", achieved: "", maximum: "10" },
  ]);
  const toggle = container.querySelector("button[aria-pressed]");
  act(() => toggle.click());
  const table = container.querySelector('table[aria-label="Notenspiegel"]');
  expect(table.tHead.textContent).not.toContain("ab Punktzahl");
  const rows = Array.from(table.tBodies[0].rows);
  expect(rows).toHaveLength(bins);
  const counts = Object.fromEntries(rows.map((row) => [row.cells[0].querySelector("span span").textContent, Number(row.cells[row.cells.length - 1].textContent)]));
  expect(counts).toMatchObject(expected);
  expect(Object.values(counts).reduce((sum, count) => sum + count, 0)).toBe(3);
  act(() => toggle.click());
  edit("Maximale Punkte Zeile 2", "10");
  act(() => toggle.click());
  expect(container.querySelector('table[aria-label="Notenspiegel"] thead').textContent).toContain("ab Punktzahl");
});

test.each([
  ["grades_1_6", "klausur", "1"],
  ["grades_1_6", "sonstige", "1-"],
  ["points_0_15", "klausur", "13"],
  ["points_0_15", "sonstige", "13"],
])("shows the next grade distance for %s / %s", async (system, category, target) => {
  await renderImport(system, category);
  const hint = container.querySelector('[data-testid="points-import-better-0"]');
  expect(hint.textContent).toBe(`0,3 P. bis ${target}`);
  expect(hint.className).toContain("bg-amber-300");
});

test("updates with achieved and maximum points; hides hint for missing, invalid and top grades", async () => {
  await renderImport("points_0_15", "klausur", "82", "100");
  const hint = () => container.querySelector('[data-testid="points-import-better-0"]');
  expect(hint().textContent).toBe("3 P. bis 13");
  expect(hint().className).not.toContain("bg-amber-300");
  edit("Erreichte Punkte Zeile 1", "84,5");
  expect(hint().textContent).toBe("0,5 P. bis 13");
  expect(hint().className).toContain("bg-amber-300");
  edit("Maximale Punkte Zeile 1", "200");
  expect(hint().textContent).not.toBe("0,5 P. bis 13");
  edit("Erreichte Punkte Zeile 1", "");
  expect(hint()).toBeNull();
  edit("Erreichte Punkte Zeile 1", "201");
  expect(hint()).toBeNull();
  edit("Erreichte Punkte Zeile 1", "200");
  expect(hint()).toBeNull();
  edit("Erreichte Punkte Zeile 1", "0");
  expect(hint()).not.toBeNull();
  act(() => {
    const select = container.querySelector('[aria-label="Entscheidung Zeile 1"]');
    select.value = "missing";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(hint()).toBeNull();
});
