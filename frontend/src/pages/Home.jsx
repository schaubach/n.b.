import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, GraduationCap, Users, Trash2, CheckCircle2,
  Loader2, FileUp, X, Plus, FileSpreadsheet, Share2,
} from "lucide-react";
import api from "../lib/api";
import { GRADE_SYSTEMS } from "../lib/grades";
import { exportAndDelete, shareAndDelete, canShareFiles } from "../lib/exportClass";

export default function Home() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/classes");
      setClasses(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("password", "test");
        const res = await api.post("/import/idoceo", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setResult(res.data);
      }
      await load();
    } catch (e) {
      setError(e?.response?.data?.detail || "Import fehlgeschlagen.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setSystem = async (classId, system) => {
    setClasses((cs) => cs.map((c) => (c.id === classId ? { ...c, grade_system: system } : c)));
    await api.put(`/classes/${classId}/grade-system`, { grade_system: system });
  };

  const startRound = async (classId) => {
    const res = await api.post("/sessions", { class_id: classId });
    navigate(`/grade/${res.data.id}`);
  };

  const removeClass = async (classId) => {
    if (!window.confirm("Klasse wirklich löschen? Alle Bewertungen gehen verloren.")) return;
    await api.delete(`/classes/${classId}`);
    await load();
  };

  const handleExport = async (cls) => {
    if (!window.confirm(
      `Alle gesammelten Benotungen von „${cls.name}" werden als CSV exportiert und anschließend gelöscht. Fortfahren?`
    )) return;
    await exportAndDelete(cls.id, cls.name);
    await load();
  };

  const handleShare = async (cls) => {
    if (!window.confirm(
      `Alle gesammelten Benotungen von „${cls.name}" werden geteilt und anschließend gelöscht. Fortfahren?`
    )) return;
    const ok = await shareAndDelete(cls.id, cls.name);
    if (ok) await load();
  };

  return (
    <div className="min-h-screen bg-stone-50 bg-dots">
      <header className="px-6 sm:px-10 pt-10 pb-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-stone-900 text-white flex items-center justify-center shadow-brutal-sm">
            <GraduationCap className="w-7 h-7" />
          </div>
          <div>
            <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight text-stone-900">
              SwipeNoten
            </h1>
            <p className="text-stone-500 text-sm font-medium">
              Noten vergeben per Swipe · iDoceo Import & Export
            </p>
          </div>
        </div>
      </header>

      <main className="px-6 sm:px-10 max-w-6xl mx-auto pb-24">
        {/* Import zone */}
        <section
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          data-testid="import-dropzone"
          className={`cursor-pointer rounded-3xl border-4 border-dashed p-10 sm:p-14 flex flex-col items-center justify-center text-center transition-colors ${
            dragOver ? "border-emerald-500 bg-emerald-50" : "border-stone-300 bg-white/70 hover:border-stone-500 hover:bg-white"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".idoceo,.zip"
            multiple
            className="hidden"
            data-testid="import-file-input"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="w-16 h-16 rounded-2xl bg-stone-900 text-white flex items-center justify-center mb-5 shadow-brutal-sm">
            {importing ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
          </div>
          <p className="font-heading text-xl sm:text-2xl font-bold text-stone-900">
            {importing ? "Importiere …" : ".idoceo-Datei importieren"}
          </p>
          <p className="text-stone-500 mt-2">
            Datei aus iDoceo hierher ziehen oder tippen zum Auswählen
          </p>
        </section>

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              data-testid="import-result"
              className="mt-4 flex items-start gap-3 rounded-2xl border-2 border-stone-900 bg-emerald-100 p-4 shadow-brutal-sm"
            >
              <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
              <div className="text-stone-900 font-medium">
                <span className="font-bold">{result.class_name}</span>{" "}
                {result.new_class ? "neu angelegt" : "aktualisiert"} ·{" "}
                {result.added_students} neu, {result.updated_students} aktualisiert ·{" "}
                {result.total_students} Schüler*innen gesamt.
              </div>
              <button onClick={(e) => { e.stopPropagation(); setResult(null); }} className="ml-auto text-stone-500">
                <X className="w-5 h-5" />
              </button>
            </motion.div>
          )}
          {error && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              data-testid="import-error"
              className="mt-4 flex items-center gap-3 rounded-2xl border-2 border-rose-900 bg-rose-100 p-4 text-rose-900 font-medium"
            >
              <X className="w-5 h-5" /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Classes */}
        <div className="mt-12 flex items-center justify-between">
          <h2 className="font-heading text-2xl font-bold text-stone-900">Klassen</h2>
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-stone-400">
            {classes.length} Klasse{classes.length === 1 ? "" : "n"}
          </span>
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-stone-400" /></div>
        ) : classes.length === 0 ? (
          <div className="mt-6 rounded-3xl border-2 border-stone-200 bg-white p-10 text-center text-stone-500">
            <FileUp className="w-10 h-10 mx-auto mb-3 text-stone-300" />
            Noch keine Klassen. Importiere oben deine erste .idoceo-Datei.
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c) => (
              <ClassCard
                key={c.id} c={c}
                onSetSystem={setSystem}
                onStart={() => startRound(c.id)}
                onDelete={() => removeClass(c.id)}
                onExport={() => handleExport(c)}
                onShare={() => handleShare(c)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ClassCard({ c, onSetSystem, onStart, onDelete, onExport, onShare }) {
  const [busy, setBusy] = useState(false);
  const sessions = c.session_count || 0;

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      data-testid={`class-card-${c.id}`}
      className="rounded-3xl border-2 border-stone-900 bg-white p-6 shadow-brutal-sm flex flex-col"
    >
      <div className="flex items-start justify-between">
        <h3 className="font-heading text-2xl font-black text-stone-900 leading-tight">{c.name}</h3>
        <button
          onClick={onDelete}
          data-testid={`delete-class-${c.id}`}
          className="text-stone-300 hover:text-rose-600 transition-colors"
          aria-label="Klasse löschen"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-stone-500 font-medium">
        <Users className="w-4 h-4" /> {c.student_count} Schüler*innen
      </div>

      <div className="mt-3" data-testid={`session-count-${c.id}`}>
        {sessions > 0 ? (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 border-2 border-emerald-900/10 text-emerald-900 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" />
            {sessions} Bewertung{sessions === 1 ? "" : "en"} gesammelt
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-stone-100 text-stone-500 font-bold text-sm">
            Noch keine Bewertung
          </span>
        )}
      </div>

      <div className="mt-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400 mb-2">Notensystem</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(GRADE_SYSTEMS).map((sys) => (
            <button
              key={sys.id}
              onClick={() => onSetSystem(c.id, sys.id)}
              data-testid={`system-${sys.id}-${c.id}`}
              className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
                c.grade_system === sys.id
                  ? "bg-stone-900 text-white border-stone-900"
                  : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
              }`}
            >
              {sys.short}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onStart}
        data-testid={`start-round-${c.id}`}
        disabled={c.student_count === 0 || busy}
        className="mt-6 w-full px-5 py-4 bg-emerald-400 text-stone-900 font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 hover:shadow-brutal active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-brutal-sm"
      >
        <Plus className="w-5 h-5" /> Neue Bewertung
      </button>

      {sessions > 0 && (
        <div className="mt-3 pt-3 border-t-2 border-stone-100 space-y-2">
          <button
            onClick={() => run(onExport)}
            disabled={busy}
            data-testid={`export-delete-${c.id}`}
            className="w-full px-4 py-3 bg-stone-900 text-white font-bold rounded-xl border-2 border-stone-900 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Exportieren &amp; löschen
          </button>
          <button
            onClick={() => run(onShare)}
            disabled={busy}
            data-testid={`share-delete-${c.id}`}
            className="w-full px-4 py-3 bg-white text-stone-900 font-bold rounded-xl border-2 border-stone-900 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            <Share2 className="w-4 h-4" />
            {canShareFiles() ? "Teilen" : "Herunterladen"} &amp; löschen
          </button>
        </div>
      )}
    </motion.div>
  );
}
