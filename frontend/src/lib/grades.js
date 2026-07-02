// Grade systems and the large-zone grading layout.
//
// Layout (four big edge zones + two flank cells next to the card):
//   Top    = 1er:  1+ 1 1-   (points 15 14 13)
//   Right  = 2er:  2+ 2 2-   (points 12 11 10)
//   Bottom = 3er:  3+ 3 3-   (points  9  8  7)
//   Left   = 4er:  4+ 4 4-   (points  6  5  4)
//   flankLeft  (directly left of the card)  = 6  (0 points)
//   flankRight (directly right of the card) = 5  (2 points)
// Grades 5 and 6 have no tendencies. There is NO grading by tapping the card.

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
    flankRight: "5",
    flankLeft: "6",
  },
  points_0_15: {
    top: ["15", "14", "13"],
    right: ["12", "11", "10"],
    bottom: ["9", "8", "7"],
    left: ["6", "5", "4"],
    flankRight: "2",
    flankLeft: "0",
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
  top: { idle: "bg-emerald-100 text-emerald-900", active: "bg-emerald-400 text-stone-900 ring-4 ring-stone-900 z-30" },
  right: { idle: "bg-amber-100 text-amber-900", active: "bg-amber-400 text-stone-900 ring-4 ring-stone-900 z-30" },
  bottom: { idle: "bg-sky-100 text-sky-900", active: "bg-sky-400 text-stone-900 ring-4 ring-stone-900 z-30" },
  left: { idle: "bg-rose-100 text-rose-900", active: "bg-rose-400 text-stone-900 ring-4 ring-stone-900 z-30" },
  flankRight: { idle: "bg-red-200 text-red-900", active: "bg-red-400 text-stone-900 ring-4 ring-stone-900 z-30" },
  flankLeft: { idle: "bg-red-300 text-red-950", active: "bg-red-600 text-white ring-4 ring-stone-900 z-30" },
};

export const ZONE_ACCENT = {
  top: "#10b981", right: "#f59e0b", bottom: "#0ea5e9", left: "#fb7185",
  flankRight: "#f87171", flankLeft: "#dc2626",
};

// Flat list of all target cells with global index, zone, primary + alt value.
export function buildCells(systemId) {
  const layout = getLayout(systemId);
  const alt = getLayout(altSystemId(systemId));
  const cells = [];
  let idx = 0;
  ["top", "right", "bottom", "left"].forEach((zone) => {
    layout[zone].forEach((value, i) => {
      cells.push({ index: idx++, zone, value, alt: alt[zone][i] });
    });
  });
  cells.push({ index: idx++, zone: "flankLeft", value: layout.flankLeft, alt: alt.flankLeft });
  cells.push({ index: idx++, zone: "flankRight", value: layout.flankRight, alt: alt.flankRight });
  return cells;
}

// Ordered best -> worst list of all grades for a system (for the correction picker).
export function allGrades(systemId) {
  const l = getLayout(systemId);
  const a = getLayout(altSystemId(systemId));
  const out = [];
  ["top", "right", "bottom", "left"].forEach((z) =>
    l[z].forEach((v, i) => out.push({ value: v, alt: a[z][i] }))
  );
  out.push({ value: l.flankRight, alt: a.flankRight }); // 5
  out.push({ value: l.flankLeft, alt: a.flankLeft }); // 6
  return out;
}

// Color coding by grade tier: 1 = dark green ... 6 = dark red.
export const TIER_COLORS = {
  1: "bg-emerald-500 text-white border-emerald-700",
  2: "bg-lime-400 text-stone-900 border-lime-600",
  3: "bg-amber-400 text-stone-900 border-amber-600",
  4: "bg-orange-400 text-white border-orange-600",
  5: "bg-red-500 text-white border-red-700",
  6: "bg-red-800 text-white border-red-950",
};

export function gradeTier(value, systemId) {
  if (value === null || value === undefined || value === "") return null;
  if (systemId === "points_0_15") {
    const p = parseInt(value, 10);
    if (isNaN(p)) return null;
    return p >= 13 ? 1 : p >= 10 ? 2 : p >= 7 ? 3 : p >= 4 ? 4 : p >= 2 ? 5 : 6;
  }
  const m = String(value).match(/\d/);
  return m ? parseInt(m[0], 10) : null;
}

export function gradeColorClasses(value, systemId) {
  const t = gradeTier(value, systemId);
  return TIER_COLORS[t] || "bg-stone-100 text-stone-300 border-stone-200";
}

export function initials(first, last) {
  const a = (first || "").trim()[0] || "";
  const b = (last || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}
