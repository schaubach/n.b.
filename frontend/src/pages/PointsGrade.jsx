import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import api from "../lib/api";
import { gradeColorClasses, gradeTier } from "../lib/grades";
import { cloneScale, evaluatePercent, findGradeScale, normalizeExamGradeValue, pointsNeededForBetter, scaleValueForSystem, shouldUseWholeExamGrades } from "../lib/gradeScales";

function numberValue(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const rounded = Number(value.toFixed(digits));
  return String(rounded).replace(".", ",");
}

function entryKey(studentId, columnId) {
  return studentId + "::" + columnId;
}

function makeColumn(index) {
  return { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), title: "Aufgabe " + index, max_points: 0 };
}

function normalizeScale(scale) {
  const copy = cloneScale(scale || {});
  copy.rows = (copy.rows || []).map((row) => ({
    grade: row.grade || "",
    points: row.points || "",
    minPercent: row.minPercent ?? 0,
  }));
  return copy;
}

function scaleSignature(scale) {
  return JSON.stringify((scale?.rows || []).map((row) => [row.grade || "", row.points || "", Number(row.minPercent) || 0]));
}

function maxPointsFromColumns(columns) {
  return columns.reduce((sum, column) => sum + numberValue(column.max_points), 0);
}

function thresholdPoints(row, maxPoints) {
  if (!(maxPoints > 0)) return 0;
  return Math.ceil(((Number(row.minPercent) || 0) / 100) * maxPoints * 10) / 10;
}

function shouldHighlightBetter(row, gradeSystem) {
  if (!row.better || !(row.better.points > 0) || row.better.points > 1) return false;
  if (gradeSystem === "points_0_15") return true;
  return gradeTier(row.grade, gradeSystem) !== gradeTier(row.better.target, gradeSystem);
}

export default function PointsGrade() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [columns, setColumns] = useState([]);
  const [entries, setEntries] = useState({});
  const [scaleId, setScaleId] = useState("MEDA");
  const [localScale, setLocalScale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirtyRef = useRef(false);

  const markDirty = () => { dirtyRef.current = true; };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get("/sessions/" + sessionId + "/points");
        setData(res.data);
        const loadedColumns = res.data.columns?.length ? res.data.columns : [makeColumn(1)];
        setColumns(loadedColumns);
        setScaleId(res.data.session.grade_scale_id || res.data.grade_scale?.id || "MEDA");
        setLocalScale(normalizeScale(res.data.grade_scale));
        const map = {};
        (res.data.entries || []).forEach((entry) => { map[entryKey(entry.student_id, entry.column_id)] = String(entry.points ?? ""); });
        setEntries(map);
        dirtyRef.current = !res.data.columns?.length;
      } catch (err) {
        setError("Punkteansicht konnte nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const selectedScale = useMemo(() => findGradeScale(data?.grade_scales || [], scaleId), [data?.grade_scales, scaleId]);
  const activeScale = useMemo(() => localScale || normalizeScale(selectedScale), [localScale, selectedScale]);
  const maxPoints = useMemo(() => maxPointsFromColumns(columns), [columns]);

  const rows = useMemo(() => {
    return (data?.students || []).map((student) => {
      const hasEntries = columns.some((column) => String(entries[entryKey(student.id, column.id)] ?? "").trim() !== "");
      const achieved = hasEntries ? columns.reduce((sum, column) => sum + numberValue(entries[entryKey(student.id, column.id)]), 0) : null;
      const percent = hasEntries && maxPoints > 0 ? achieved / maxPoints * 100 : null;
      const evaluated = evaluatePercent(percent, activeScale, data?.session?.grade_system, data?.session);
      const better = hasEntries ? pointsNeededForBetter(achieved, maxPoints, activeScale, evaluated.rowIndex, data?.session?.grade_system, data?.session) : null;
      return { student, achieved, max: maxPoints, percent, grade: evaluated.rawValue || evaluated.value, summaryValue: evaluated.value, better, hasEntries };
    });
  }, [columns, entries, data?.students, data?.session?.grade_system, activeScale, maxPoints]);

  const scaleSummary = useMemo(() => {
    const counts = new Map();
    rows.forEach((row) => {
      const countValue = row.summaryValue || row.grade;
      if (countValue) counts.set(String(countValue), (counts.get(String(countValue)) || 0) + 1);
    });
    const items = (activeScale?.rows || [])
      .slice()
      .sort((a, b) => Number(b.minPercent) - Number(a.minPercent))
      .map((row) => {
        const value = normalizeExamGradeValue(scaleValueForSystem(row, data?.session?.grade_system), data?.session, data?.session?.grade_system);
        return { ...row, value, minPoints: thresholdPoints(row, maxPoints), count: counts.get(String(value)) || 0 };
      });
    if (!shouldUseWholeExamGrades(data?.session, data?.session?.grade_system)) return items;
    const grouped = new Map();
    items.forEach((item) => {
      const current = grouped.get(item.value);
      if (!current) grouped.set(item.value, { ...item });
      else grouped.set(item.value, { ...current, minPercent: Math.max(Number(current.minPercent) || 0, Number(item.minPercent) || 0), minPoints: Math.max(current.minPoints, item.minPoints) });
    });
    return Array.from(grouped.values()).sort((a, b) => Number(b.minPercent) - Number(a.minPercent));
  }, [activeScale, data?.session, data?.session?.grade_system, maxPoints, rows]);

  const scaleChanged = useMemo(() => scaleSignature(activeScale) !== scaleSignature(selectedScale), [activeScale, selectedScale]);
  const showScalePoints = data?.session?.grade_system === "points_0_15";
  const saveStatusLabel = saving ? "speichere" : "gespeichert";

  const save = async () => {
    if (!data || !dirtyRef.current) return;
    setSaving(true);
    setError("");
    try {
      const payloadEntries = [];
      Object.entries(entries).forEach(([key, value]) => {
        const [student_id, column_id] = key.split("::");
        if (value !== "") payloadEntries.push({ student_id, column_id, points: numberValue(value) });
      });
      await api.put("/sessions/" + sessionId + "/points", {
        grade_scale_id: scaleId,
        scale_override: normalizeScale({ ...activeScale, id: scaleId, name: selectedScale?.name || activeScale?.name || "Bewertungsskala" }),
        columns,
        entries: payloadEntries,
      });
      dirtyRef.current = false;
    } catch (err) {
      setError("Punkte konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!data || !dirtyRef.current) return undefined;
    const timer = setTimeout(save, 500);
    return () => clearTimeout(timer);
  }, [columns, entries, scaleId, activeScale]);

  const selectScale = (nextId) => {
    const next = findGradeScale(data?.grade_scales || [], nextId);
    setScaleId(nextId);
    setLocalScale(normalizeScale(next));
    markDirty();
  };

  const addColumn = () => {
    setColumns((current) => [...current, makeColumn(current.length + 1)]);
    markDirty();
  };

  const removeColumn = (columnId) => {
    setColumns((current) => {
      const next = current.filter((column) => column.id !== columnId);
      return next.length ? next : [makeColumn(1)];
    });
    setEntries((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.endsWith("::" + columnId))));
    markDirty();
  };

  const updateColumn = (columnId, patch) => {
    setColumns((current) => current.map((column) => column.id === columnId ? { ...column, ...patch } : column));
    markDirty();
  };

  const updateEntry = (studentId, columnId, value) => {
    setEntries((current) => ({ ...current, [entryKey(studentId, columnId)]: value }));
    markDirty();
  };

  const updateScaleRow = (index, patch) => {
    setLocalScale((current) => {
      const base = normalizeScale(current || selectedScale);
      base.rows = base.rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
      return base;
    });
    markDirty();
  };

  const removeScaleRow = (index) => {
    setLocalScale((current) => {
      const base = normalizeScale(current || selectedScale);
      base.rows = base.rows.filter((_, rowIndex) => rowIndex !== index);
      if (!base.rows.length) base.rows = [{ grade: "", points: "", minPercent: 0 }];
      return base;
    });
    markDirty();
  };

  const openGradebook = async () => {
    if (dirtyRef.current) await save();
    navigate("/gradebook/" + data.session.class_id);
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-stone-50"><Loader2 className="h-8 w-8 animate-spin text-stone-400" /></div>;
  }

  if (!data) {
    return <div className="flex h-screen items-center justify-center bg-stone-50 font-bold text-rose-700">{error || "Nicht gefunden"}</div>;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-stone-50 bg-dots">
      <header className="flex shrink-0 items-center gap-3 border-b-2 border-stone-900 bg-white px-4 py-3 sm:px-6">
        <button onClick={openGradebook} className="flex items-center gap-2 rounded-full border-2 border-stone-900 bg-white px-3 py-2 font-bold text-stone-900 shadow-brutal-sm">
          <ArrowLeft className="h-5 w-5" /> Notenstand
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Punkte -> Noten</p>
          <h1 className="truncate font-heading text-xl font-black text-stone-900">{data.session.class_name} · {data.session.title}</h1>
        </div>
        <div aria-live="polite" className={"flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 font-heading font-extrabold shadow-brutal-sm " + (saving ? "border-amber-400 bg-amber-100 text-amber-900" : "border-emerald-500 bg-emerald-100 text-emerald-900")}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{saveStatusLabel}</span>
        </div>
      </header>

      <div className="flex shrink-0 flex-col gap-3 border-b-2 border-stone-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:px-6">
        <label className="flex items-center gap-2 font-bold text-stone-700">
          Skala
          <select value={scaleId} onChange={(event) => selectScale(event.target.value)} className="rounded-xl border-2 border-stone-300 bg-white px-3 py-2 font-bold text-stone-900">
            {(data.grade_scales || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <button onClick={addColumn} className="flex items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-amber-300 px-4 py-2.5 font-heading font-extrabold text-stone-900 shadow-brutal-sm">
          <Plus className="h-4 w-4" /> Spalte hinzufügen
        </button>
        <div className="text-sm font-bold text-stone-500">
          {saveStatusLabel}
          {scaleChanged && <span className="ml-2 font-black text-rose-700">Notenskala lokal angepasst</span>}
        </div>
      </div>

      {error && <div className="mx-4 mt-3 rounded-2xl border-2 border-rose-300 bg-rose-100 px-4 py-3 font-bold text-rose-900">{error}</div>}

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="min-w-max overflow-hidden rounded-2xl border-2 border-stone-900 bg-white shadow-brutal-sm">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-40 min-w-56 border-b-2 border-stone-900 bg-stone-900 px-4 py-3 text-left font-heading font-black text-white">Lernende*r</th>
                {columns.map((column, index) => (
                  <th key={column.id} className="sticky top-0 z-30 min-w-36 border-b-2 border-l border-stone-900 bg-amber-300 p-2 text-stone-900">
                    <input value={column.title} onChange={(event) => updateColumn(column.id, { title: event.target.value })} className="w-full rounded-lg border-2 border-stone-900/20 bg-white/80 px-2 py-1 text-center font-bold" />
                    <div className="mt-1 flex items-center gap-1">
                      <input type="number" min="0" step="0.5" value={column.max_points} onChange={(event) => updateColumn(column.id, { max_points: event.target.value })} className="w-24 rounded-lg border-2 border-stone-900/20 bg-white/80 px-2 py-1 text-center font-mono font-black" />
                      <button onClick={() => removeColumn(column.id)} className="rounded-lg border-2 border-rose-300 bg-white p-1 text-rose-700" aria-label={"Spalte " + (index + 1) + " löschen"} disabled={columns.length <= 1}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </th>
                ))}
                <th className="sticky top-0 z-30 min-w-56 border-b-2 border-l-2 border-stone-900 bg-stone-800 px-4 py-3 text-center font-heading font-black text-white">Auswertung</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const bg = rowIndex % 2 === 0 ? "bg-white" : "bg-stone-50";
                const near = shouldHighlightBetter(row, data.session.grade_system);
                const inactiveTone = row.student.inactive ? "opacity-60 grayscale" : "";
                return (
                  <tr key={row.student.id} className={`${bg} ${inactiveTone}`}>
                    <td className={"sticky left-0 z-20 border-t-2 border-stone-200 px-4 py-3 font-bold text-stone-900 " + bg}>{row.student.first_name} <span className="font-black">{row.student.last_name}</span>{row.student.inactive ? <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-black uppercase text-stone-600">nicht im Import</span> : null}</td>
                    {columns.map((column) => (
                      <td key={column.id} className="border-l border-t-2 border-stone-200 px-2 py-2 text-center">
                        <input type="number" min="0" step="0.5" value={entries[entryKey(row.student.id, column.id)] || ""} onChange={(event) => updateEntry(row.student.id, column.id, event.target.value)} className="w-24 rounded-xl border-2 border-stone-200 px-2 py-2 text-center font-mono font-black outline-none focus:border-stone-900" />
                      </td>
                    ))}
                    <td className="border-l-2 border-t-2 border-stone-200 px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {row.grade ? <span className={"rounded-xl border-2 px-3 py-1 font-mono text-xl font-black " + gradeColorClasses(row.grade, data.session.grade_system)}>{row.grade}</span> : <span className="font-bold text-stone-300">-</span>}
                        <span className="font-mono text-sm font-bold text-stone-600">{row.hasEntries ? `${formatNumber(row.achieved)} / ${formatNumber(row.max)} · ${formatNumber(row.percent)}%` : "keine Punkte"}</span>
                      </div>
                      {row.better && <div className={"mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-black " + (near ? "bg-amber-300 text-stone-900 ring-2 ring-stone-900" : "bg-stone-100 text-stone-600")}>{formatNumber(row.better.points)} P. bis besser</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-hidden rounded-2xl border-2 border-stone-900 bg-white shadow-brutal-sm">
            <div className="border-b-2 border-stone-900 bg-stone-900 px-4 py-3">
              <h2 className="font-heading text-lg font-black text-white">Notenschwellen</h2>
            </div>
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">Note</th>
                  <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">ab Punktzahl</th>
                  <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">Prozent</th>
                  <th className="bg-stone-100 px-3 py-2 text-left font-heading font-black text-stone-900">vergeben</th>
                </tr>
              </thead>
              <tbody>
                {scaleSummary.map((item, index) => (
                  <tr key={index}>
                    <td className="border-t-2 border-stone-200 p-2"><span className={"inline-flex min-w-14 justify-center rounded-xl border-2 px-3 py-1 font-mono font-black " + gradeColorClasses(item.value, data.session.grade_system)}>{item.value || "-"}</span></td>
                    <td className="border-t-2 border-stone-200 px-3 py-2 font-mono font-black text-stone-900">ab {formatNumber(item.minPoints)} P.</td>
                    <td className="border-t-2 border-stone-200 px-3 py-2 font-mono font-bold text-stone-700">{formatNumber(Number(item.minPercent) || 0)}%</td>
                    <td className="border-t-2 border-stone-200 px-3 py-2 font-heading text-lg font-black text-stone-900">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-2xl border-2 border-stone-900 bg-white shadow-brutal-sm">
            <div className="border-b-2 border-stone-900 bg-amber-300 px-4 py-3">
              <h2 className="font-heading text-lg font-black text-stone-900">Skala für diese Bewertung</h2>
              <p className="text-xs font-bold text-stone-700">Änderungen gelten nur lokal für diese Spalte.</p>
            </div>
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="bg-stone-100 px-2 py-2 text-left font-heading font-black text-stone-900">Note</th>
                  {showScalePoints && <th className="bg-stone-100 px-2 py-2 text-left font-heading font-black text-stone-900">Punkte</th>}
                  <th className="bg-stone-100 px-2 py-2 text-left font-heading font-black text-stone-900">%</th>
                  <th className="bg-stone-100 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(activeScale?.rows || []).map((row, index) => {
                  const value = scaleValueForSystem(row, data.session.grade_system);
                  return (
                    <tr key={index}>
                      <td className="border-t-2 border-stone-200 p-2"><input value={row.grade} onChange={(event) => updateScaleRow(index, { grade: event.target.value })} className={"w-20 rounded-xl border-2 px-2 py-2 text-center font-mono font-black " + gradeColorClasses(value, data.session.grade_system)} /></td>
                      {showScalePoints && <td className="border-t-2 border-stone-200 p-2"><input value={row.points} onChange={(event) => updateScaleRow(index, { points: event.target.value })} className="w-20 rounded-xl border-2 border-stone-200 px-2 py-2 text-center font-mono font-black" /></td>}
                      <td className="border-t-2 border-stone-200 p-2"><input type="number" step="0.1" value={row.minPercent} onChange={(event) => updateScaleRow(index, { minPercent: event.target.value })} className="w-24 rounded-xl border-2 border-stone-200 px-2 py-2 text-center font-mono font-black" /></td>
                      <td className="border-t-2 border-stone-200 p-2"><button type="button" onClick={() => removeScaleRow(index)} className="rounded-xl border-2 border-rose-300 bg-white p-2 text-rose-700"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
