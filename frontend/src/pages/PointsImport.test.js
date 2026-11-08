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

async function renderImport(system, category, achieved = "8,2", maximum = "10") {
  const scale = { id: "TEST", name: "Test", rows: [
    { grade: "1", points: "14", minPercent: 90 },
    { grade: "2", points: "11", minPercent: 75 },
    { grade: "3", points: "8", minPercent: 60 },
  ] };
  api.get.mockResolvedValue({ data: {
    session: { entry_mode: "csv_points", grade_scale_id: "TEST", grade_system: system, category, sl_type: "written" },
    grade_scale: scale, grade_scales: [scale],
    students: [{ id: "a", email: "a@example.com", first_name: "A", last_name: "Test" }],
    import_review: [{ key: "a", line: 2, mail: "a@example.com", status: "geprüft", student_id: "a", achieved, maximum, decision: "accept", source_issues: [] }],
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
