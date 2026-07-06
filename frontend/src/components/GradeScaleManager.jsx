import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, FilePlus2, Loader2, Percent, RefreshCw, Save, Trash2, X } from "lucide-react";
import api from "../lib/api";
import { gradeColorClasses } from "../lib/grades";
import { gradeScaleCsv, parseGradeScaleCsv } from "../lib/gradeScales";
import { triggerDownload } from "../lib/exportClass";

function emptyRow() {
  return { grade: "", points: "", minPercent: 0 };
}

function scaleToRows(scale) {
  return (scale?.rows || []).map((row) => ({ grade: row.grade || "", points: row.points || "", minPercent: row.minPercent ?? 0 }));
}

export default function GradeScaleManager({ open, onClose, onChanged }) {
  const [scales, setScales] = useState([]);
  const [selected, setSelected] = useState(null);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef(null);

  const load = async () => {
    const res = await api.get("/grade-scales");
    setScales(res.data);
    const first = res.data[0] || null;
    setSelected((current) => current ? res.data.find((s) => s.id === current.id) || first : first);
  };

  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => { setRows(scaleToRows(selected)); }, [selected]);

  const csvText = gradeScaleCsv({ rows });

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post("/grade-scales", { name: selected?.name || "Skala", csv: csvText });
      setMessage("Notenskala gespeichert.");
      await load();
      if (onChanged) onChanged(res.data.scale);
    } catch (err) {
      setError(err?.response?.data?.detail || "Notenskala konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const updateFromFolder = async () => {
    setUpdating(true);
    setError("");
    setMessage("");
    try {
      const manifest = await fetch(process.env.PUBLIC_URL + "/notenskala/index.json", { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error("manifest");
        return res.json();
      });
      let count = 0;
      for (const fileName of manifest) {
        if (!String(fileName).toLowerCase().endsWith(".csv")) continue;
        const text = await fetch(process.env.PUBLIC_URL + "/notenskala/" + encodeURIComponent(fileName), { cache: "no-store" }).then((res) => res.text());
        await api.post("/grade-scales", { name: fileName.replace(/\.csv$/i, ""), csv: text });
        count += 1;
      }
      setMessage(count + " CSV-Datei" + (count === 1 ? "" : "en") + " aus /notenskala eingelesen.");
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setError("Update fehlgeschlagen. Prüfe /notenskala/index.json und die CSV-Dateien.");
    } finally {
      setUpdating(false);
    }
  };

  const importFile = async (files) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const parsed = parseGradeScaleCsv(await file.text(), file.name);
      setSelected(parsed);
      setRows(scaleToRows(parsed));
    } catch (err) {
      setError(err.message || "CSV konnte nicht gelesen werden.");
    }
  };

  const download = () => {
    if (!selected) return;
    triggerDownload(new File(["\ufeff", csvText], selected.name + ".csv", { type: "text/csv;charset=utf-8" }));
  };

  const updateRow = (index, patch) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));

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
                <button type="button" onClick={updateFromFolder} disabled={updating} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-amber-300 px-3 py-3 font-heading font-extrabold text-stone-900 disabled:opacity-50">
                  {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Update
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-white px-3 py-3 font-heading font-extrabold text-stone-900">
                  <FilePlus2 className="h-4 w-4" /> CSV importieren
                </button>
              </div>
              <div className="min-w-0">
                <div className="overflow-hidden rounded-2xl border-2 border-stone-900">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="bg-stone-900 px-3 py-2 text-left font-heading font-black text-white">Note</th>
                        <th className="bg-stone-900 px-3 py-2 text-left font-heading font-black text-white">Punkte</th>
                        <th className="bg-stone-900 px-3 py-2 text-left font-heading font-black text-white">Prozent ab</th>
                        <th className="bg-stone-900 px-3 py-2 text-white"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index} className={index % 2 === 0 ? "bg-white" : "bg-stone-50"}>
                          <td className="border-t-2 border-stone-200 p-2">
                            <input value={row.grade} onChange={(e) => updateRow(index, { grade: e.target.value })} className={"w-24 rounded-xl border-2 px-3 py-2 text-center font-mono font-black " + gradeColorClasses(row.grade, "grades_1_6")} />
                          </td>
                          <td className="border-t-2 border-stone-200 p-2"><input value={row.points} onChange={(e) => updateRow(index, { points: e.target.value })} className="w-24 rounded-xl border-2 border-stone-200 px-3 py-2 text-center font-mono font-black" /></td>
                          <td className="border-t-2 border-stone-200 p-2"><input type="number" step="0.1" value={row.minPercent} onChange={(e) => updateRow(index, { minPercent: e.target.value })} className="w-28 rounded-xl border-2 border-stone-200 px-3 py-2 text-center font-mono font-black" /></td>
                          <td className="border-t-2 border-stone-200 p-2 text-right"><button type="button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="rounded-xl border-2 border-rose-300 bg-white p-2 text-rose-700"><Trash2 className="h-4 w-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={() => setRows((current) => [...current, emptyRow()])} className="mt-3 rounded-xl border-2 border-stone-900 bg-white px-4 py-2 font-bold">Zeile hinzufügen</button>
                <p className="mt-2 text-sm font-bold text-stone-500">Format beim Export: <code>Note;Punkte;Prozent_ab</code>.</p>
                {message && <p className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-100 px-4 py-3 font-bold text-emerald-900">{message}</p>}
                {error && <p className="mt-3 rounded-xl border-2 border-rose-300 bg-rose-100 px-4 py-3 font-bold text-rose-900">{error}</p>}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={download} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-white px-4 py-3 font-heading font-extrabold text-stone-900"><Download className="h-4 w-4" /> CSV exportieren</button>
                  <button type="button" onClick={save} disabled={saving} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-stone-900 px-4 py-3 font-heading font-extrabold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Speichern</button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
