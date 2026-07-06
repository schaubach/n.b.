import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, FilePlus2, Loader2, Percent, Save, X } from "lucide-react";
import api from "../lib/api";
import { gradeScaleCsv } from "../lib/gradeScales";
import { triggerDownload } from "../lib/exportClass";

export default function GradeScaleManager({ open, onClose, onChanged }) {
  const [scales, setScales] = useState([]);
  const [selected, setSelected] = useState(null);
  const [csvText, setCsvText] = useState("");
  const [saving, setSaving] = useState(false);
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
  useEffect(() => { setCsvText(selected ? gradeScaleCsv(selected) : ""); }, [selected]);

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

  const importFile = async (files) => {
    const file = files?.[0];
    if (!file) return;
    setCsvText(await file.text());
    setSelected({ id: file.name.replace(/\.csv$/i, ""), name: file.name.replace(/\.csv$/i, ""), rows: [] });
  };

  const download = () => {
    if (!selected) return;
    triggerDownload(new File(["\ufeff", csvText], selected.name + ".csv", { type: "text/csv;charset=utf-8" }));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[130] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="grade-scale-manager">
          <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ scale: 0.92, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative flex max-h-[92dvh] w-full max-w-4xl flex-col rounded-3xl border-2 border-stone-900 bg-white shadow-brutal">
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
                <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-900 bg-white px-3 py-3 font-heading font-extrabold text-stone-900">
                  <FilePlus2 className="h-4 w-4" /> CSV importieren
                </button>
              </div>
              <div className="min-w-0">
                <label className="block">
                  <span className="text-sm font-bold text-stone-700">CSV-Inhalt</span>
                  <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} className="mt-1 h-80 w-full rounded-2xl border-2 border-stone-300 p-4 font-mono text-sm outline-none focus:border-stone-900" spellCheck={false} />
                </label>
                <p className="mt-2 text-sm font-bold text-stone-500">Format: <code>Note;Punkte;Prozent_ab</code>. Beispiel: <code>2;11;81</code>.</p>
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
