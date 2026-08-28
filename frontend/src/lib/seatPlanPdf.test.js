import { buildSeatPlanFromTextPages, nameSimilarity } from "./seatPlanPdf";

const students = [
  { id: "student-1", first_name: "Anas", last_name: "Bata" },
  { id: "student-2", first_name: "Oskar", last_name: "Mikolajewski" },
  { id: "student-3", first_name: "Leon Pascal", last_name: "Löwenberg" },
  { id: "student-4", first_name: "Frederik", last_name: "Müller" },
];

test("matches reversed name parts and small spelling differences", () => {
  expect(nameSimilarity(students[1], "Mikolajewsky Oskar")).toBeGreaterThan(0.8);
  expect(nameSimilarity(students[2], "Löwenberg Leon Pascal")).toBeGreaterThan(0.95);
});

test("reconstructs columns, page rows and free seats from positioned PDF text", () => {
  const pages = [
    {
      width: 400,
      height: 300,
      items: [
        { str: "Bata Anas", x: 20, y: 90, width: 60, height: 20 },
        { str: "Mikolajewsky Oskar", x: 105, y: 90, width: 90, height: 20 },
        { str: "Löwenberg Leon Pascal", x: 305, y: 90, width: 90, height: 20 },
      ],
    },
    {
      width: 400,
      height: 300,
      items: [{ str: "Müller Frederik", x: 210, y: 90, width: 80, height: 20 }],
    },
  ];

  const plan = buildSeatPlanFromTextPages(pages, students);

  expect(plan.columns).toBe(4);
  expect(plan.rows).toBe(2);
  expect(plan.matched).toBe(4);
  expect(plan.unmatched).toEqual([]);
  expect(plan.seats).toEqual(expect.arrayContaining([
    { row: 0, column: 0, student_id: "student-1" },
    { row: 0, column: 1, student_id: "student-2" },
    { row: 0, column: 3, student_id: "student-3" },
    { row: 1, column: 2, student_id: "student-4" },
  ]));
  expect(plan.seats.some((seat) => seat.row === 0 && seat.column === 2)).toBe(false);
});

test("keeps completely empty rows from the PDF table grid", () => {
  const rowLines = (start, end) => [0, 100, 200, 300, 400].map((x) => ({ x1: x, y1: start, x2: x, y2: end }));
  const pages = [{
    width: 400,
    height: 400,
    lines: [
      ...rowLines(0, 100),
      ...rowLines(100, 200),
      ...rowLines(200, 300),
      ...rowLines(300, 400),
    ],
    items: [
      { str: "Bata Anas", x: 20, y: 35, width: 60, height: 20 },
      { str: "Mikolajewsky Oskar", x: 105, y: 235, width: 90, height: 20 },
      { str: "Löwenberg Leon Pascal", x: 205, y: 335, width: 90, height: 20 },
      { str: "Müller Frederik", x: 310, y: 335, width: 80, height: 20 },
    ],
  }];

  const plan = buildSeatPlanFromTextPages(pages, students);

  expect(plan.columns).toBe(4);
  expect(plan.rows).toBe(4);
  expect(plan.seats.some((seat) => seat.row === 1)).toBe(false);
  expect(plan.seats).toEqual(expect.arrayContaining([
    { row: 0, column: 0, student_id: "student-1" },
    { row: 2, column: 1, student_id: "student-2" },
    { row: 3, column: 2, student_id: "student-3" },
    { row: 3, column: 3, student_id: "student-4" },
  ]));
});

test("separates CSV-only, PDF-only and inactive learners", () => {
  const rowLines = [0, 100, 200, 300, 400].map((x) => ({ x1: x, y1: 0, x2: x, y2: 100 }));
  const comparedStudents = [
    students[0],
    { ...students[1], inactive: true },
    students[2],
  ];
  const pages = [{
    width: 400,
    height: 200,
    lines: rowLines,
    items: [
      { str: "Bata Anas", x: 20, y: 35, width: 60, height: 20 },
      { str: "Mikolajewski Oskar", x: 105, y: 35, width: 90, height: 20 },
      { str: "Neue Person", x: 210, y: 35, width: 70, height: 20 },
    ],
  }];

  const plan = buildSeatPlanFromTextPages(pages, comparedStudents);

  expect(plan.seats).toEqual([{ row: 0, column: 0, student_id: "student-1" }]);
  expect(plan.unmatched).toEqual(["student-3"]);
  expect(plan.pdf_only_entries).toEqual([{ name: "Neue Person", row: 0, column: 2 }]);
  expect(plan.seats.some((seat) => seat.student_id === "student-2")).toBe(false);
});
