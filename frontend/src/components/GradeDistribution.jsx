import React from "react";
import { gradeColorClasses } from "../lib/grades";
import { pointGradeLabel } from "../lib/gradebook";
import { normalizeExamGradeValue, scaleValueForSystem, shouldUseWholeExamGrades } from "../lib/gradeScales";

export function formatNumber(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const rounded = Number(value.toFixed(digits));
  return String(rounded).replace(".", ",");
}

function thresholdPoints(row, maxPoints) {
  if (!(maxPoints > 0)) return 0;
  return Math.ceil(((Number(row.minPercent) || 0) / 100) * maxPoints * 10) / 10;
}

function pointInfo(value, gradeSystem) {
  return gradeSystem === "points_0_15" ? pointGradeLabel(value) : "";
}

export function GradePill({ value, gradeSystem, size = "normal" }) {
  if (!value) return <span className="font-bold text-stone-300">-</span>;
  const info = pointInfo(value, gradeSystem);
  const sizeClass = size === "large" ? "px-3 py-1 text-xl" : "px-3 py-1";
  return (
    <span className={"inline-flex min-w-14 flex-col items-center justify-center rounded-xl border-2 font-mono font-black leading-none " + sizeClass + " " + gradeColorClasses(value, gradeSystem)}>
      <span>{value}</span>
      {info && <span className="mt-0.5 text-[10px] font-black opacity-85">{info}</span>}
    </span>
  );
}

export default function GradeDistribution({ scale, session, maxPoints, values, title = "Notenschwellen", note, countLabel = "vergeben" }) {
  const showScalePoints = session.grade_system === "points_0_15";
  const counts = new Map();
  for (const value of values) if (value != null && value !== "") counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  const items = (scale?.rows || [])
    .slice()
    .sort((a, b) => Number(b.minPercent) - Number(a.minPercent))
    .map((row) => {
      const value = normalizeExamGradeValue(scaleValueForSystem(row, session.grade_system), session, session.grade_system);
      return { ...row, value, minPoints: thresholdPoints(row, maxPoints), count: counts.get(String(value)) || 0 };
    });
  let scaleSummary = items;
  if (shouldUseWholeExamGrades(session, session.grade_system)) {
    const grouped = new Map();
    items.forEach((item) => {
      const current = grouped.get(item.value);
      if (!current) grouped.set(item.value, { ...item });
      else grouped.set(item.value, { ...current, minPercent: Math.min(Number(current.minPercent) || 0, Number(item.minPercent) || 0), minPoints: Math.min(current.minPoints, item.minPoints) });
    });
    scaleSummary = Array.from(grouped.values()).sort((a, b) => Number(b.minPercent) - Number(a.minPercent));
  }
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-stone-900 bg-white shadow-brutal-sm">
      <div className="border-b-2 border-stone-900 bg-stone-900 px-4 py-3">
        <h2 className="font-heading text-lg font-black text-white">{title}</h2>
        {note && <p className="text-sm text-stone-200">{note}</p>}
      </div>
      <table aria-label={title} className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">{showScalePoints ? "Notenpunkte" : "Note"}</th>
            {maxPoints != null && <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">ab Punktzahl</th>}
            <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">Prozent</th>
            <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">{countLabel}</th>
          </tr>
        </thead>
        <tbody>
          {scaleSummary.map((item, index) => (
            <tr key={index}>
              <td className="border-t-2 border-stone-200 p-2"><GradePill value={item.value} gradeSystem={session.grade_system} /></td>
              {maxPoints != null && <td className="border-t-2 border-stone-200 px-3 py-2 font-mono font-black text-stone-900">ab {formatNumber(item.minPoints)} P.</td>}
              <td className="border-t-2 border-stone-200 px-3 py-2 font-mono font-bold text-stone-700">{formatNumber(Number(item.minPercent) || 0)}%</td>
              <td className="border-t-2 border-stone-200 px-3 py-2 font-heading text-lg font-black text-stone-900">{item.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
