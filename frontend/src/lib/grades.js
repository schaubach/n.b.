// Grade systems and the large-zone grading layout.
//
// Layout: four big edge zones (each with 3 grades) + center (tap the card).
//   Top    = 1er:  1+ 1 1-   (points 15 14 13)
//   Right  = 2er:  2+ 2 2-   (points 12 11 10)
//   Bottom = 3er:  3+ 3 3-   (points  9  8  7)
//   Left   = 4er:  4+ 4 4-   (points  6  5  4)
//   Center = 5 (points 3)  -> tap the student card

export const GRADE_SYSTEMS = {
  grades_1_6: { id: "grades_1_6", label: "Noten 1–6", short: "1–6 Noten" },
  points_0_15: { id: "points_0_15", label: "Punkte 0–15", short: "0–15 Punkte" },
};

export const GRADE_LAYOUTS = {
  grades_1_6: {
    top: ["1+", "1", "1-"],
    right: ["2+", "2", "2-"],
    bottom: ["3+", "3", "3-"],
    left: ["4+", "4", "4-"],
    center: "5",
  },
  points_0_15: {
    top: ["15", "14", "13"],
    right: ["12", "11", "10"],
    bottom: ["9", "8", "7"],
    left: ["6", "5", "4"],
    center: "3",
  },
};

export function getLayout(systemId) {
  return GRADE_LAYOUTS[systemId] || GRADE_LAYOUTS.grades_1_6;
}

export function altSystemId(systemId) {
  return systemId === "points_0_15" ? "grades_1_6" : "points_0_15";
}

// Visual identity per zone.
export const ZONE_STYLES = {
  top: {
    idle: "bg-emerald-100 text-emerald-900",
    active: "bg-emerald-400 text-stone-900 ring-4 ring-stone-900 z-20",
  },
  right: {
    idle: "bg-amber-100 text-amber-900",
    active: "bg-amber-400 text-stone-900 ring-4 ring-stone-900 z-20",
  },
  bottom: {
    idle: "bg-sky-100 text-sky-900",
    active: "bg-sky-400 text-stone-900 ring-4 ring-stone-900 z-20",
  },
  left: {
    idle: "bg-rose-100 text-rose-900",
    active: "bg-rose-400 text-stone-900 ring-4 ring-stone-900 z-20",
  },
  center: {
    idle: "bg-violet-200 text-violet-900",
    active: "bg-violet-400 text-stone-900",
  },
};

// Flat list of the 12 edge cells with global index, zone, primary + alt value.
export function buildEdgeCells(systemId) {
  const layout = getLayout(systemId);
  const alt = getLayout(altSystemId(systemId));
  const zones = ["top", "right", "bottom", "left"];
  const cells = [];
  let idx = 0;
  zones.forEach((zone) => {
    layout[zone].forEach((value, i) => {
      cells.push({ index: idx++, zone, value, alt: alt[zone][i] });
    });
  });
  return cells;
}

export function centerCell(systemId) {
  const layout = getLayout(systemId);
  const alt = getLayout(altSystemId(systemId));
  return { value: layout.center, alt: alt.center };
}

export function initials(first, last) {
  const a = (first || "").trim()[0] || "";
  const b = (last || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}
