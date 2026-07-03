import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, GraduationCap, Users, Trash2, CheckCircle2,
  Loader2, FileUp, X, Plus, FileSpreadsheet, Share2,
} from "lucide-react";
import api from "../lib/api";
import { GRADE_SYSTEMS } from "../lib/grades";
import { exportAndDelete, shareAndDelete, canShareFiles, downloadClassCsv } from "../lib/exportClass";
import ConfirmModal from "../components/ConfirmModal";
import SessionSetupModal from "../components/SessionSetupModal";

export default function Home() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState({ open: false });
  const [setup, setSetup] = useState(null); // class selected for a new round
  const fileRef = useRef(null);

  const closeModal = () => setModal({ open: false });

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

  const doImport = async (arr, gs) => {
    setImporting(true);
    setError(null);
    try {
      for (const file of arr) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("password", "test");
        fd.append("grade_system", gs);
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
    }
  };

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      let anyNew = false;
      for (const file of arr) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("password", "test");
        const pk = await api.post("/import/peek", fd);
        if (!pk.data.exists) anyNew = true;
      }
      setImporting(false);
      if (anyNew) {
        setModal({
          open: true,
          title: "Notensystem der neuen Klasse",
          description: "Diese Auswahl wird für die Klasse gespeichert und gilt für alle Bewertungen dieser Klasse.",
          actions: [
            { key: "g16", testid: "gs-grades-1-6", variant: "primary", label: "Noten 1–6 (mit Tendenzen)",
              onClick: () => { closeModal(); doImport(arr, "grades_1_6"); } },
            { key: "p15", testid: "gs-points-0-15", variant: "primary", label: "Punkte 0–15",
              onClick: () => { closeModal(); doImport(arr, "points_0_15"); } },
            { key: "cancel", testid: "modal-cancel", variant: "ghost", label: "Abbrechen", onClick: closeModal },
          ],
        });
      } else {
        await doImport(arr, "grades_1_6");
      }
    } catch (e) {
      setImporting(false);
      setError(e?.response?.data?.detail || "Datei konnte nicht gelesen werden.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startRound = async (classId, opts) => {
    const res = await api.post("/sessions", { class_id: classId, ...opts });
    navigate(`/grade/${res.data.id}`);
  };

  const removeClass = (cls) => {
    const hasGrades = (cls.session_count || 0) > 0;
    const actions = [];
    if (hasGrades) {
      actions.push({
        key: "export-del", testid: "modal-export-then-delete", variant: "success",
        label: "Exportieren, dann löschen",
        onClick: async () => {
          closeModal();
          await downloadClassCsv(cls.id, cls.name);
          await api.delete(`/classes/${cls.id}`);
          await load();
        },
      });
      actions.push({
        key: "del-only", testid: "modal-delete-without-export", variant: "danger",
        label: "Ohne Export löschen",
        onClick: async () => { closeModal(); await api.delete(`/classes/${cls.id}`); await load(); },
      });
    } else {
      actions.push({
        key: "del", testid: "modal-confirm-delete", variant: "danger",
        label: "Klasse löschen",
        onClick: async () => { closeModal(); await api.delete(`/classes/${cls.id}`); await load(); },
      });
    }
    actions.push({ key: "cancel", testid: "modal-cancel", variant: "ghost", label: "Abbrechen", onClick: closeModal });

    setModal({
      open: true,
      title: `Klasse „${cls.name}" löschen?`,
      description: hasGrades
        ? `Es gibt ${cls.session_count} noch nicht exportierte Bewertung${cls.session_count === 1 ? "" : "en"}. Möchtest du sie vorher exportieren? Beim Löschen gehen Klasse, Schüler*innen und alle Bewertungen unwiderruflich verloren.`
        : "Die Klasse und alle Schüler*innen werden unwiderruflich gelöscht.",
      actions,
    });
  };

  const handleExport = (cls) => {
    setModal({
      open: true,
      title: "Bewertungen exportieren & löschen?",
      description: `Alle gesammelten Benotungen von „${cls.name}" werden als CSV exportiert und der Sammelbestand anschließend geleert.`,
      actions: [
        {
          key: "ok", testid: "modal-confirm-export", variant: "primary",
          label: "Exportieren & löschen",
          onClick: async () => { closeModal(); await exportAndDelete(cls.id, cls.name); await load(); },
        },
        { key: "cancel", testid: "modal-cancel", variant: "ghost", label: "Abbrechen", onClick: closeModal },
      ],
    });
  };

  const handleShare = (cls) => {
    setModal({
      open: true,
      title: `${canShareFiles() ? "Teilen" : "Herunterladen"} & löschen?`,
      description: `Alle gesammelten Benotungen von „${cls.name}" werden ${canShareFiles() ? "geteilt" : "heruntergeladen"} und der Sammelbestand anschließend geleert.`,
      actions: [
        {
          key: "ok", testid: "modal-confirm-share", variant: "success",
          label: `${canShareFiles() ? "Teilen" : "Herunterladen"} & löschen`,
          onClick: async () => { closeModal(); const ok = await shareAndDelete(cls.id, cls.name); if (ok) await load(); },
        },
        { key: "cancel", testid: "modal-cancel", variant: "ghost", label: "Abbrechen", onClick: closeModal },
      ],
    });
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
                onStart={(cat) => setSetup({ cls: c, category: cat })}
                onDelete={() => removeClass(c)}
                onExport={() => handleExport(c)}
                onShare={() => handleShare(c)}
              />
            ))}
          </div>
        )}
      </main>

      <ConfirmModal {...modal} onClose={closeModal} />
      <SessionSetupModal
        open={!!setup}
        className={setup?.cls?.name}
        category={setup?.category}
        onStart={async (opts) => { const c = setup.cls; setSetup(null); await startRound(c.id, opts); }}
        onClose={() => setSetup(null)}
      />
    </div>
  );
}

function ClassCard({ c, onStart, onDelete, onExport, onShare }) {
  const [busy, setBusy] = useState(false);
  const sessions = c.session_count || 0;
  const sonstige = c.sonstige_count || 0;
  const klausur = c.klausur_count || 0;
  const sysLabel = (GRADE_SYSTEMS[c.grade_system] || {}).short || c.grade_system;

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const disabled = c.student_count === 0 || busy;

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

      <div className="mt-2 flex items-center gap-3 text-stone-500 font-medium text-sm">
        <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {c.student_count}</span>
        <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-bold text-xs" data-testid={`class-system-${c.id}`}>
          {sysLabel}
        </span>
      </div>

      {/* Sonstige Leistungen */}
      <div className="mt-5 rounded-2xl border-2 border-stone-200 p-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-stone-400">Sonstige Leistungen</p>
        <p className="mt-0.5 font-bold text-stone-800 text-sm" data-testid={`sonstige-count-${c.id}`}>
          {sonstige} Bewertung{sonstige === 1 ? "" : "en"}
        </p>
        <button
          onClick={() => onStart("sonstige")}
          data-testid={`start-sonstige-${c.id}`}
          disabled={disabled}
          className="mt-2 w-full px-4 py-2.5 bg-emerald-400 text-stone-900 font-heading font-extrabold rounded-xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:hover:translate-y-0"
        >
          <Plus className="w-4 h-4" /> Neue sonstige Leistung
        </button>
      </div>

      {/* Klausuren */}
      <div className="mt-3 rounded-2xl border-2 border-stone-200 p-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-stone-400">Klausuren</p>
        <p className="mt-0.5 font-bold text-stone-800 text-sm" data-testid={`klausur-count-${c.id}`}>
          {klausur} Bewertung{klausur === 1 ? "" : "en"}
        </p>
        <button
          onClick={() => onStart("klausur")}
          data-testid={`start-klausur-${c.id}`}
          disabled={disabled}
          className="mt-2 w-full px-4 py-2.5 bg-sky-400 text-stone-900 font-heading font-extrabold rounded-xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:hover:translate-y-0"
        >
          <Plus className="w-4 h-4" /> Neue Klausur
        </button>
      </div>

      {sessions > 0 && (
        <div className="mt-4 pt-3 border-t-2 border-stone-100 space-y-2">
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
