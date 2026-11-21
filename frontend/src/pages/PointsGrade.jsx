import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import api from "../lib/api";
import { gradeColorClasses, gradeTier } from "../lib/grades";
import GradeDistribution, { formatNumber, GradePill } from "../components/GradeDistribution";
import { evaluatePercent, findGradeScale, normalizePointScale, pointsNeededForBetter, scaleValueForSystem } from "../lib/gradeScales";

function numberValue(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}


function entryKey(studentId, columnId) {
  return studentId + "::" + columnId;
}

function makeColumn(index) {
  return { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), title: "Aufgabe " + index, max_points: 0 };
}

function normalizeScale(scale, gradeSystem = "grades_1_6") {
  return normalizePointScale(scale || {}, gradeSystem);
}

function scaleSignature(scale) {
  return JSON.stringify((scale?.rows || []).map((row) => [row.grade || "", row.points || "", Number(row.minPercent) || 0]));
}

function maxPointsFromColumns(columns) {
  return columns.reduce((sum, column) => sum + numberValue(column.max_points), 0);
}


function shouldHighlightBetter(row, gradeSystem) {
  if (!row.better || !(row.better.points > 0) || row.better.points > 1) return false;
  if (gradeSystem === "points_0_15") return true;
  return gradeTier(row.grade, gradeSystem) !== gradeTier(row.better.target, gradeSystem);
}


const SUMMARY_COL_WIDTH = 256;
const NAME_COL_WIDTH = 224;
const summaryColStyle = { width: SUMMARY_COL_WIDTH, minWidth: SUMMARY_COL_WIDTH, maxWidth: SUMMARY_COL_WIDTH };
const nameColStyle = { left: SUMMARY_COL_WIDTH, width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, maxWidth: NAME_COL_WIDTH };


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
  const [showDistribution, setShowDistribution] = useState(false);
  const dirtyRef = useRef(false);
  const tableScrollRef = useRef(null);

  const handlePointsKeyDown = (event, rowIndex, columnIndex) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const columnCount = columns.length;
    const rowCount = data?.students?.length || 0;
    let nextRow = rowIndex;
    let nextColumn = columnIndex + (event.shiftKey ? -1 : 1);
    if (nextColumn >= columnCount) { nextRow += 1; nextColumn = 0; }
    if (nextColumn < 0) { nextRow -= 1; nextColumn = columnCount - 1; }
    if (nextRow < 0 || nextRow >= rowCount) return;
    const target = tableScrollRef.current?.querySelector(`input[data-points-row="${nextRow}"][data-points-col="${nextColumn}"]`);
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.select();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const markDirty = () => { dirtyRef.current = true; };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get("/sessions/" + sessionId + "/points");
        if (res.data.session.entry_mode === "csv_points") {
          navigate(`/points-import/${sessionId}`, { replace: true });
          return;
        }
        setData(res.data);
        const loadedColumns = res.data.columns?.length ? res.data.columns : [makeColumn(1)];
        setColumns(loadedColumns);
        setScaleId(res.data.session.grade_scale_id || res.data.grade_scale?.id || "MEDA");
        setLocalScale(normalizeScale(res.data.grade_scale, res.data.session.grade_system));
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
  }, [sessionId, navigate]);

  const selectedScale = useMemo(() => findGradeScale(data?.grade_scales || [], scaleId), [data?.grade_scales, scaleId]);
  const activeScale = useMemo(() => localScale || normalizeScale(selectedScale, data?.session?.grade_system), [localScale, selectedScale, data?.session?.grade_system]);
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


  const scaleChanged = useMemo(() => scaleSignature(activeScale) !== scaleSignature(normalizeScale(selectedScale, data?.session?.grade_system)), [activeScale, selectedScale, data?.session?.grade_system]);
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
        scale_override: normalizeScale({ ...activeScale, id: scaleId, name: selectedScale?.name || activeScale?.name || "Bewertungsskala" }, data?.session?.grade_system),
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
    setLocalScale(normalizeScale(next, data?.session?.grade_system));
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
      const base = normalizeScale(current || selectedScale, data?.session?.grade_system);
      base.rows = base.rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
      return base;
    });
    markDirty();
  };

  const removeScaleRow = (index) => {
    setLocalScale((current) => {
      const base = normalizeScale(current || selectedScale, data?.session?.grade_system);
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
      <header className="grid shrink-0 grid-cols-2 items-center gap-3 border-b-2 border-stone-900 bg-white px-4 py-3 sm:flex sm:px-6">
        <button onClick={openGradebook} className="flex items-center gap-2 rounded-full border-2 border-stone-900 bg-white px-3 py-2 font-bold text-stone-900 shadow-brutal-sm">
          <ArrowLeft className="h-5 w-5" /> Notenstand
        </button>
        <div className="order-last col-span-2 min-w-0 flex-1 text-center sm:order-none">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Punkte -> Noten</p>
          <h1 className="break-words font-heading text-xl font-black text-stone-900 sm:truncate">{data.session.class_name} · {data.session.title}</h1>
        </div>
        <div aria-live="polite" className={"flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 font-heading font-extrabold shadow-brutal-sm " + (saving ? "border-amber-400 bg-amber-100 text-amber-900" : "border-emerald-500 bg-emerald-100 text-emerald-900")}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{saveStatusLabel}</span>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b-2 border-stone-200 bg-white px-4 py-3 sm:px-6">
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
        <button type="button" aria-pressed={showDistribution} onClick={() => setShowDistribution((visible) => !visible)} className="flex items-center gap-2 rounded-lg border-2 border-stone-900 bg-white px-4 py-2 font-bold aria-pressed:bg-stone-900 aria-pressed:text-white">
          <BarChart3 className="h-5 w-5" /> Notenspiegel
        </button>
      </div>

      {error && <div className="mx-4 mt-3 rounded-2xl border-2 border-rose-300 bg-rose-100 px-4 py-3 font-bold text-rose-900">{error}</div>}

      <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {showDistribution ? <GradeDistribution title="Notenspiegel" scale={activeScale} session={data.session} maxPoints={maxPoints} values={rows.map((row) => row.summaryValue || row.grade)} /> : <>
        <div ref={tableScrollRef} className="max-h-[calc(100vh-12rem)] max-w-full overflow-auto rounded-2xl border-2 border-stone-900 bg-white shadow-brutal-sm" style={{ scrollPaddingLeft: SUMMARY_COL_WIDTH + NAME_COL_WIDTH, scrollPaddingTop: 96 }}>
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-40 border-b-2 border-stone-900 bg-stone-800 px-4 py-3 text-center font-heading font-black text-white" style={summaryColStyle}>Auswertung</th>
                <th className="sticky top-0 z-40 border-b-2 border-r-2 border-stone-900 bg-stone-900 px-4 py-3 text-left font-heading font-black text-white" style={nameColStyle}>Lernende*r</th>
                {columns.map((column, index) => (
                  <th key={column.id} className="sticky top-0 z-30 min-w-36 border-b-2 border-l border-stone-900 bg-amber-300 p-2 text-stone-900">
                    <input value={column.title} onChange={(event) => updateColumn(column.id, { title: event.target.value })} className="w-full rounded-lg border-2 border-stone-900/20 bg-white/80 px-2 py-1 text-center font-bold" />
                    <div className="mt-1 flex items-center gap-1">
                      <input type="number" min="0" step="0.5" value={column.max_points} onChange={(event) => updateColumn(column.id, { max_points: event.target.value })} className="w-24 rounded-lg border-2 border-stone-900/20 bg-white/80 px-2 py-1 text-center font-mono font-black" />
                      <button onClick={() => removeColumn(column.id)} className="rounded-lg border-2 border-rose-300 bg-white p-1 text-rose-700" aria-label={"Spalte " + (index + 1) + " löschen"} disabled={columns.length <= 1}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const bg = rowIndex % 2 === 0 ? "bg-white" : "bg-stone-50";
                const near = shouldHighlightBetter(row, data.session.grade_system);
                const inactiveTone = row.student.inactive ? "opacity-60 grayscale" : "";
                return (
                  <tr key={row.student.id} className={`${bg} ${inactiveTone}`}>
                    <td className={"sticky left-0 z-20 border-t-2 border-stone-200 px-3 py-2 text-center " + bg} style={summaryColStyle}>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <GradePill value={row.grade} gradeSystem={data.session.grade_system} size="large" />
                        <span className="font-mono text-sm font-bold text-stone-600">{row.hasEntries ? `${formatNumber(row.achieved)} / ${formatNumber(row.max)} · ${formatNumber(row.percent)}%` : "keine Punkte"}</span>
                      </div>
                      {row.better && <div className={"mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-black " + (near ? "bg-amber-300 text-stone-900 ring-2 ring-stone-900" : "bg-stone-100 text-stone-600")}>{formatNumber(row.better.points)} P. bis {row.better.target || "besser"}</div>}
                    </td>
                    <td className={"sticky z-20 border-l border-r-2 border-t-2 border-l-stone-200 border-r-stone-900 border-t-stone-200 px-4 py-3 font-bold text-stone-900 " + bg} style={nameColStyle}>{row.student.first_name} <span className="font-black">{row.student.last_name}</span>{row.student.inactive ? <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-black uppercase text-stone-600">nicht im Import</span> : null}</td>
                    {columns.map((column, columnIndex) => (
                      <td key={column.id} className="border-l border-t-2 border-stone-200 px-2 py-2 text-center">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          data-points-row={rowIndex}
                          data-points-col={columnIndex}
                          value={entries[entryKey(row.student.id, column.id)] || ""}
                          onChange={(event) => updateEntry(row.student.id, column.id, event.target.value)}
                          onKeyDown={(event) => handlePointsKeyDown(event, rowIndex, columnIndex)}
                          className="w-24 rounded-xl border-2 border-stone-200 px-2 py-2 text-center font-mono font-black outline-none focus:border-stone-900"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section className="mt-5 max-w-xl">

          <div className="overflow-hidden rounded-2xl border-2 border-stone-900 bg-white shadow-brutal-sm">
            <div className="border-b-2 border-stone-900 bg-amber-300 px-4 py-3">
              <h2 className="font-heading text-lg font-black text-stone-900">Skala für diese Bewertung</h2>
              <p className="text-xs font-bold text-stone-700">Änderungen gelten nur lokal für diese Spalte.</p>
            </div>
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="bg-stone-100 px-2 py-2 text-left font-heading font-black text-stone-900">{showScalePoints ? "Notenpunkte" : "Note"}</th>
                  {showScalePoints && <th className="bg-stone-100 px-2 py-2 text-left font-heading font-black text-stone-900">Info</th>}
                  <th className="bg-stone-100 px-2 py-2 text-left font-heading font-black text-stone-900">%</th>
                  <th className="bg-stone-100 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(activeScale?.rows || []).map((row, index) => {
                  const value = scaleValueForSystem(row, data.session.grade_system);
                  return (
                    <tr key={index}>
                      <td className="border-t-2 border-stone-200 p-2">
                        <input
                          value={showScalePoints ? row.points : row.grade}
                          onChange={(event) => updateScaleRow(index, showScalePoints ? { points: event.target.value } : { grade: event.target.value })}
                          className={"w-20 rounded-xl border-2 px-2 py-2 text-center font-mono font-black " + gradeColorClasses(value, data.session.grade_system)}
                        />
                      </td>
                      {showScalePoints && <td className="border-t-2 border-stone-200 p-2"><input value={row.grade} onChange={(event) => updateScaleRow(index, { grade: event.target.value })} className="w-20 rounded-xl border-2 border-stone-200 px-2 py-2 text-center font-mono font-black" /></td>}
                      <td className="border-t-2 border-stone-200 p-2"><input type="number" step="0.1" value={row.minPercent} onChange={(event) => updateScaleRow(index, { minPercent: event.target.value })} className="w-24 rounded-xl border-2 border-stone-200 px-2 py-2 text-center font-mono font-black" /></td>
                      <td className="border-t-2 border-stone-200 p-2"><button type="button" onClick={() => removeScaleRow(index)} className="rounded-xl border-2 border-rose-300 bg-white p-2 text-rose-700"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        </>}
      </main>
    </div>
  );
}
