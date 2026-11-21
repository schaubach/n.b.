import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PointsGrade from "./PointsGrade";
import api from "../lib/api";

jest.mock("../lib/api", () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn() } }));
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useParams: () => ({ sessionId: "test" }), useNavigate: () => mockNavigate,
}));

let root;
let container;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test.each([
  ["grades_1_6", "sonstige", "2+"],
  ["grades_1_6", "klausur", "2"],
  ["points_0_15", "klausur", "12"],
])("toggles distribution without losing entered scores: %s / %s", async (system, category, expected) => {
  const scale = { id: "TEST", name: "Test", rows: [
    { grade: "1", points: "14", minPercent: 90 },
    { grade: "2", points: "11", minPercent: 75 },
    { grade: "3", points: "8", minPercent: 60 },
  ] };
  api.get.mockResolvedValue({ data: {
    session: { class_id: "c", title: "Test", grade_system: system, category, sl_type: "written", grade_scale_id: "TEST" },
    grade_scale: scale, grade_scales: [scale],
    columns: [{ id: "task", title: "Aufgabe 1", max_points: 10 }],
    students: [{ id: "a", first_name: "Test", last_name: "Person" }],
    entries: [{ student_id: "a", column_id: "task", points: 8.2 }],
  } });
  await act(async () => { root.render(<PointsGrade />); });
  const toggle = container.querySelector("button[aria-pressed]");
  expect(toggle.textContent).toContain("Notenspiegel");
  expect(container.querySelector('table[aria-label="Notenspiegel"]')).toBeNull();
  expect(container.querySelector("input[data-points-row]").value).toBe("8.2");
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  const table = container.querySelector('table[aria-label="Notenspiegel"]');
  const counted = Array.from(table.tBodies[0].rows).filter((row) => row.cells[3].textContent === "1");
  expect(counted).toHaveLength(1);
  expect(counted[0].cells[0].querySelector("span span").textContent).toBe(expected);
  act(() => toggle.click());
  expect(container.querySelector("input[data-points-row]").value).toBe("8.2");
  expect(api.put).not.toHaveBeenCalled();
});
