import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Download, FilePlus2, Loader2, Percent, Plus, Trash2, X } from "lucide-react";
import api from "../lib/api";
import { gradeColorClasses } from "../lib/grades";
import { gradeOptions } from "../lib/gradebook";
import { gradeScaleCsv, parseGradeScaleCsv } from "../lib/gradeScales";
import { triggerDownload } from "../lib/exportClass";

const FIXED_GRADES = gradeOptions("grades_1_6");
const FIXED_POINTS = gradeOptions("points_0_15");

function defaultPercent(index, total) {
  return Math.max(0, Math.round((100 - (index * (100 / Math.max(1, total - 1)))) * 10) / 10);
}

function fixedRowsFrom(scale) {
  const byGrade = new Map();
  const byPoint = new Map();
  (scale?.rows || []).forEach((row) => {
    const clean = { grade: String(row.grade || "").trim(), points: String(row.points || "").trim(), minPercent: row.minPercent ?? 0 };
    if (clean.grade) byGrade.set(clean.grade, clean);
    if (clean.points) byPoint.set(clean.points, clean);
  });
  return FIXED_GRADES.map((grade, index) => {
    const points = FIXED_POINTS[index] || "";
    const source = byGrade.get(grade) || byPoint.get(points);
    return {
      grade,
      points,
      minPercent: source?.minPercent ?? defaultPercent(index, FIXED_GRADES.length),
    };
  });
}

export default function GradeScaleManager({ open, onClose, onChanged }) {
  const [scales, setScales] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rows, setRows] = useState([]);
  const [scaleName, setScaleName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirtyRef = useRef(false);
  const loadedRef = useRef(false);
  const fileRef = useRef(null);

  const load = async () => {
    const res = await api.get("/grade-scales");
    setScales(res.data);
    const first = res.data[0] || null;
    setSelected((current) => current ? res.data.find((s) => s.id === current.id) || first : first);
  };

  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => {
    loadedRef.current = false;
    dirtyRef.current = false;
    setRows(fixedRowsFrom(selected));
    setScaleName(selected?.name || "");
    setTimeout(() => { loadedRef.current = true; }, 0);
  }, [selected]);

  const csvText = gradeScaleCsv({ rows });
  const statusBusy = saving || renaming;
  const saveStatusLabel = statusBusy ? "speichere" : "gespeichert";

  const saveRows = async (nextRows = rows) => {
    if (!selected) return null;
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/grade-scales", { name: selected.name || "Skala", csv: gradeScaleCsv({ rows: fixedRowsFrom({ rows: nextRows }) }) });
      setScales(res.data.scales || []);
      setSelected(res.data.scale);
      dirtyRef.current = false;
      if (onChanged) onChanged(res.data.scale);
      return res.data.scale;
    } catch (err) {
      setError(err?.response?.data?.detail || "Notenskala konnte nicht gespeichert werden.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open || !selected || !loadedRef.current || !dirtyRef.current) return undefined;
    const timer = setTimeout(() => { saveRows(rows); }, 500);
    return () => clearTimeout(timer);
  }, [rows, open, selected]);

  const importFile = async (files) => {
    const file = files?.[0];
    if (!file) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const parsed = parseGradeScaleCsv(await file.text(), file.name);
      const res = await api.post("/grade-scales", { name: parsed.name, csv: gradeScaleCsv({ rows: fixedRowsFrom(parsed) }) });
      setScales(res.data.scales || []);
      setSelected(res.data.scale);
      setRows(fixedRowsFrom(res.data.scale));
      dirtyRef.current = false;
      setMessage("CSV importiert und Notenskala gespeichert.");
      if (onChanged) onChanged(res.data.scale);
    } catch (err) {
      setError(err.message || err?.response?.data?.detail || "CSV konnte nicht gelesen werden.");
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = () => {
    if (!selected) return;
    triggerDownload(new File(["\ufeff", csvText], selected.name + ".csv", { type: "text/csv;charset=utf-8" }));
  };

  const updatePercent = (index, minPercent) => {
    dirtyRef.current = true;
    setRows((current) => current.map((row, i) => i === index ? { ...row, minPercent } : row));
  };

  const renameScale = async () => {
    if (!selected) return;
    const name = String(scaleName || "").trim();
    if (!name || name === selected.name) return;
    setRenaming(true);
    setError("");
    setMessage("");
    try {
      const res = await api.put("/grade-scales/" + encodeURIComponent(selected.id), { name });
      setScales(res.data.scales || []);
      setSelected(res.data.scale);
      setMessage("Notenskala umbenannt.");
      if (onChanged) onChanged(res.data.scale);
    } catch (err) {
      setError(err?.response?.data?.detail || "Notenskala konnte nicht umbenannt werden.");
      setScaleName(selected.name || "");
    } finally {
      setRenaming(false);
    }
  };

  const deleteScale = async () => {
    if (!selected) return;
    if (scales.length <= 1) {
      setError("Die letzte Notenskala kann nicht gelöscht werden.");
      return;
    }
    const ok = window.confirm("Notenskala '" + selected.name + "' wirklich löschen?");
    if (!ok) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await api.delete("/grade-scales/" + encodeURIComponent(selected.id));
      setScales(res.data.scales || []);
      setSelected(res.data.selected || (res.data.scales || [])[0] || null);
      setMessage("Notenskala gelöscht.");
      if (onChanged) onChanged(res.data.selected);
    } catch (err) {
      setError(err?.response?.data?.detail || "Notenskala konnte nicht gelöscht werden.");
    } finally {
      setSaving(false);
    }
  };

  const createScale = async () => {
    const suffix = new Date().toLocaleString("de-DE").replace(/\D+/g, "").slice(0, 12);
    const name = "Neue Skala " + suffix;
    const rowsForSystem = fixedRowsFrom({ rows: [] });
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post("/grade-scales", { name, csv: gradeScaleCsv({ rows: rowsForSystem }) });
      setScales(res.data.scales || []);
      setSelected(res.data.scale);
      setRows(fixedRowsFrom(res.data.scale));
      dirtyRef.current = false;
      setMessage("Neue Skala angelegt.");
      if (onChanged) onChanged(res.data.scale);
    } catch (err) {
      setError(err?.response?.data?.detail || "Neue Skala konnte nicht angelegt werden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[130] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="grade-scale-manager">
          <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ scale: 0.92, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative flex max-h-[92dvh] w-full max-w-5xl flex-col rounded-3xl border-2 border-stone-900 bg-white shadow-brutal">
            <header className="flex items-start gap-3 border-b-2 border-stone-900 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-stone-900 bg-amber-300 text-stone-900"><Percent className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">Punkte -> Noten</p>
                <h2 className="font-heading text-2xl font-black text-stone-900">Notenskalen</h2>
              </div>
              <div aria-live="polite" className={"flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 font-heading font-extrabold shadow-brutal-sm " + (statusBusy ? "border-amber-400 bg-amber-100 text-amber-900" : "border-emerald-500 bg-emerald-100 text-emerald-900")}>
                {statusBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span>{saveStatusLabel}</span>
              </div>
              <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-900" aria-label="Schließen"><X className="h-5 w-5" /></button>
            </header>
            <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 md:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                {scales.map((scale) => (
                  <button key={scale.id} type="button" onClick={() => setSelected(scale)} className={"w-full rounded-xl border-2 px-3 py-2 text-left font-bold " + (selected?.id === scale.id ? "border-stone-900 bg-amber-200" : "border-stone-200 bg-white")}>
                    {scale.name}{scale.built_in ? <span className="ml-2 text-xs text-stone-400">CSV</span> : null}
                  </button>
                ))}
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importFile(e.target.files)} />
                <button type="button" onClick={createScale} disabled={saving} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-amber-200 px-3 py-3 font-heading font-extrabold text-stone-900 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> Neue Skala
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-white px-3 py-3 font-heading font-extrabold text-stone-900 disabled:opacity-50">
                  <FilePlus2 className="h-4 w-4" /> CSV importieren
                </button>
              </div>
              <div className="min-w-0">
                <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="text-sm font-bold text-stone-700">Name der Skala</span>
                    <input value={scaleName} onChange={(e) => setScaleName(e.target.value)} onBlur={renameScale} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} disabled={!selected || renaming} className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900 disabled:opacity-50" />
                  </label>
                  <button type="button" onClick={deleteScale} disabled={!selected || saving || renaming || scales.length <= 1} className="self-end rounded-xl border-2 border-rose-300 bg-white px-4 py-3 font-heading font-extrabold text-rose-700 disabled:opacity-40" title="Skala löschen">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
                <div className="overflow-hidden rounded-2xl border-2 border-stone-900">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="bg-stone-900 px-3 py-2 text-left font-heading font-black text-white">Note</th>
                        <th className="bg-stone-900 px-3 py-2 text-left font-heading font-black text-white">Punkte</th>
                        <th className="bg-stone-900 px-3 py-2 text-left font-heading font-black text-white">Prozent ab</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index} className={index % 2 === 0 ? "bg-white" : "bg-stone-50"}>
                          <td className="border-t-2 border-stone-200 p-2">
                            <span className={"inline-flex w-24 justify-center rounded-xl border-2 px-3 py-2 text-center font-mono font-black " + gradeColorClasses(row.grade, "grades_1_6")}>{row.grade}</span>
                          </td>
                          <td className="border-t-2 border-stone-200 p-2"><span className="inline-flex w-24 justify-center rounded-xl border-2 border-stone-200 bg-stone-50 px-3 py-2 text-center font-mono font-black text-stone-900">{row.points}</span></td>
                          <td className="border-t-2 border-stone-200 p-2"><input type="number" step="0.1" value={row.minPercent} onChange={(e) => updatePercent(index, e.target.value)} className="w-28 rounded-xl border-2 border-stone-200 px-3 py-2 text-center font-mono font-black" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 rounded-2xl border-2 border-amber-300 bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950">Bestehende Bewertungen übernehmen Änderungen nicht automatisch.</p>
                {message && <p className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-100 px-4 py-3 font-bold text-emerald-900">{message}</p>}
                {error && <p className="mt-3 rounded-xl border-2 border-rose-300 bg-rose-100 px-4 py-3 font-bold text-rose-900">{error}</p>}
                <div className="mt-4">
                  <button type="button" onClick={download} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-white px-4 py-3 font-heading font-extrabold text-stone-900"><Download className="h-4 w-4" /> CSV exportieren</button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
