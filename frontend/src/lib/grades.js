// Grade systems and the 4-edge / 16-cell mapping used by the swipe screen.

export const GRADE_SYSTEMS = {
  grades_1_6: {
    id: "grades_1_6",
    label: "Noten 1–6",
    short: "1–6 Noten",
    values: ["1+", "1", "1-", "2+", "2", "2-", "3+", "3",
             "3-", "4+", "4", "4-", "5+", "5", "5-", "6"],
  },
  points_0_15: {
    id: "points_0_15",
    label: "Punkte 0–15",
    short: "0–15 Punkte",
    values: ["15", "14", "13", "12", "11", "10", "9", "8",
             "7", "6", "5", "4", "3", "2", "1", "0"],
  },
};

// Edge zones: each holds 4 cells. order = top, right, bottom, left.
export const ZONES = [
  {
    key: "top",
    idle: "bg-emerald-100 text-emerald-900",
    active: "bg-emerald-400 text-stone-900 border-stone-900 shadow-brutal-sm scale-110",
    accent: "#34d399",
  },
  {
    key: "right",
    idle: "bg-amber-100 text-amber-900",
    active: "bg-amber-400 text-stone-900 border-stone-900 shadow-brutal-sm scale-110",
    accent: "#fbbf24",
  },
  {
    key: "bottom",
    idle: "bg-indigo-100 text-indigo-900",
    active: "bg-indigo-400 text-stone-900 border-stone-900 shadow-brutal-sm scale-110",
    accent: "#818cf8",
  },
  {
    key: "left",
    idle: "bg-rose-100 text-rose-900",
    active: "bg-rose-400 text-stone-900 border-stone-900 shadow-brutal-sm scale-110",
    accent: "#fb7185",
  },
];

// Build a flat list of 16 cells with global index, zone and value.
export function buildCells(systemId) {
  const sys = GRADE_SYSTEMS[systemId] || GRADE_SYSTEMS.grades_1_6;
  const groups = [
    sys.values.slice(0, 4),
    sys.values.slice(4, 8),
    sys.values.slice(8, 12),
    sys.values.slice(12, 16),
  ];
  const cells = [];
  groups.forEach((group, zi) => {
    group.forEach((value, ii) => {
      cells.push({ index: zi * 4 + ii, zone: ZONES[zi], value });
    });
  });
  return cells;
}

export function initials(first, last) {
  const a = (first || "").trim()[0] || "";
  const b = (last || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}
