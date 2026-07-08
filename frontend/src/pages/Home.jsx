import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Trash2, CheckCircle2,
  Loader2, FileUp, X, Plus, Camera, Table2, Mail, UserRound, Percent,
} from "lucide-react";
import api from "../lib/api";
import { GRADE_SYSTEMS } from "../lib/grades";
import { deleteClassSessions, downloadClassCsv } from "../lib/exportClass";
import ConfirmModal from "../components/ConfirmModal";
import SessionSetupModal from "../components/SessionSetupModal";
import PhotoManager from "../components/PhotoManager";
import GradebookModal from "../components/GradebookModal";
import TeacherConfigModal from "../components/TeacherConfigModal";
import GradeScaleManager from "../components/GradeScaleManager";

export default function Home() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState({ open: false });
  const [setup, setSetup] = useState(null); // class selected for a new round
  const [photoClass, setPhotoClass] = useState(null);
  const [gradebookClass, setGradebookClass] = useState(null);
  const [teacherConfigOpen, setTeacherConfigOpen] = useState(false);
  const [gradeScaleOpen, setGradeScaleOpen] = useState(false);
  const [gradeScales, setGradeScales] = useState([]);
  const [importOptions, setImportOptions] = useState(null);
  const fileRef = useRef(null);

  const closeModal = () => setModal({ open: false });

  const load = async () => {
    setLoading(true);
    try {
      const [res, scaleRes] = await Promise.all([api.get("/classes"), api.get("/grade-scales")]);
      setClasses(res.data);
      setGradeScales(scaleRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doImport = async (arr, gs, gradeScaleId = "MEDA") => {
    setImporting(true);
    setError(null);
    try {
      for (const file of arr) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("grade_system", gs);
        fd.append("grade_scale_id", gradeScaleId);
        const res = await api.post("/import/csv", fd);
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
        const pk = await api.post("/import/peek", fd);
        if (pk.data.any_new) anyNew = true;
      }
      setImporting(false);
      if (anyNew) {
        setImportOptions({ files: arr, gradeSystem: "grades_1_6", gradeScaleId: gradeScales[0]?.id || "MEDA" });
      } else {
        await doImport(arr, "grades_1_6", gradeScales[0]?.id || "MEDA");
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
    navigate(res.data.points_mode ? `/points/${res.data.id}` : `/grade/${res.data.id}`);
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

  const handleDeleteGrades = (cls) => {
    setModal({
      open: true,
      title: `Bewertungen von „${cls.name}" löschen?`,
      description: "Du kannst nur die Bewertungen löschen oder die komplette Klasse samt Namen, Fotos, Noten und Bewertungen entfernen.",
      actions: [
        {
          key: "delete-sessions", testid: "modal-confirm-delete-sessions", variant: "danger",
          label: "Bewertungen löschen",
          onClick: async () => { closeModal(); await deleteClassSessions(cls.id); await load(); },
        },
        {
          key: "delete-class", testid: "modal-confirm-delete-class", variant: "danger",
          label: "Klasse löschen",
          onClick: async () => { closeModal(); await api.delete(`/classes/${cls.id}`); await load(); },
        },
        { key: "cancel", testid: "modal-cancel", variant: "ghost", label: "Abbrechen", onClick: closeModal },
      ],
    });
  };

  return (
    <div className="min-h-screen bg-stone-50 bg-dots">
      <header className="px-6 sm:px-10 pt-8 pb-6 max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <img src={process.env.PUBLIC_URL + "/logo.jpeg"} alt="n.b." className="w-14 h-14 rounded-2xl border-2 border-stone-900 object-cover shadow-brutal-sm" />
            <div className="min-w-0">
              <h1 className="font-heading text-3xl sm:text-4xl font-black tracking-tight text-stone-900">
                n.b.
              </h1>
              <p className="text-stone-500 text-sm font-medium">
                Noten blitzschnell vergeben
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setGradeScaleOpen(true)}
              data-testid="grade-scale-button"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-amber-300 px-4 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm transition-all active:translate-y-0.5 active:shadow-none"
              aria-label="Notenskalen"
            >
              <Percent className="w-5 h-5" />
              <span className="hidden sm:inline">Skalen</span>
            </button>
            <button
              type="button"
              onClick={() => setTeacherConfigOpen(true)}
              data-testid="teacher-config-button"
              className="inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-stone-900 bg-white px-4 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm transition-all active:translate-y-0.5 active:shadow-none"
              aria-label="Lehrendenkonfiguration"
            >
              <Mail className="w-5 h-5" />
              <UserRound className="w-5 h-5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              data-testid="import-file-input"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              data-testid="import-button"
              disabled={importing}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-stone-900 px-4 py-3 font-heading font-extrabold text-white shadow-brutal-sm transition-all active:translate-y-0.5 active:shadow-none disabled:opacity-60"
            >
              {importing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              <span>Klasse aus IServ importieren</span>
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 sm:px-10 max-w-6xl mx-auto pb-24">
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
                {result.added_students} neu, {result.updated_students} aktualisiert
                {result.reactivated_students ? `, ${result.reactivated_students} reaktiviert` : ""}
                {result.inactive_students ? `, ${result.inactive_students} ausgegraut` : ""} ·{" "}
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
            Noch keine Klassen. Importiere oben rechts deine erste IServ-CSV-Datei.
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {classes.map((c) => (
              <ClassCard
                key={c.id} c={c}
                onStart={(cat) => setSetup({ cls: c, category: cat })}
                onDelete={() => removeClass(c)}
                onDeleteGrades={() => handleDeleteGrades(c)}
                onPhotos={() => setPhotoClass(c)}
                onGradebook={() => setGradebookClass(c)}
              />
            ))}
          </div>
        )}
      </main>

      <ConfirmModal {...modal} onClose={closeModal} />
      <PhotoManager
        open={!!photoClass}
        classId={photoClass?.id}
        className={photoClass?.name}
        onChanged={load}
        onClose={() => setPhotoClass(null)}
      />
      <GradebookModal
        open={!!gradebookClass}
        classId={gradebookClass?.id}
        className={gradebookClass?.name}
        onClose={() => setGradebookClass(null)}
      />
      <TeacherConfigModal
        open={teacherConfigOpen}
        onClose={() => setTeacherConfigOpen(false)}
      />
      <GradeScaleManager
        open={gradeScaleOpen}
        onClose={() => setGradeScaleOpen(false)}
        onChanged={load}
      />
      <ImportOptionsModal
        options={importOptions}
        scales={gradeScales}
        onChange={setImportOptions}
        onCancel={() => setImportOptions(null)}
        onImport={(next) => { setImportOptions(null); doImport(next.files, next.gradeSystem, next.gradeScaleId); }}
      />
      <SessionSetupModal
        open={!!setup}
        className={setup?.cls?.name}
        category={setup?.category}
        gradeSystem={setup?.cls?.grade_system}
        gradeScaleId={setup?.cls?.grade_scale_id}
        gradeScales={gradeScales}
        onStart={async (opts) => { const c = setup.cls; setSetup(null); await startRound(c.id, opts); }}
        onClose={() => setSetup(null)}
      />
    </div>
  );
}

function ClassCard({ c, onStart, onDelete, onDeleteGrades, onPhotos, onGradebook }) {
  const [busy, setBusy] = useState(false);
  const sessions = c.session_count || 0;
  const sonstige = c.sonstige_count || 0;
  const klausur = c.klausur_count || 0;
  const sysLabel = (GRADE_SYSTEMS[c.grade_system] || {}).short || c.grade_system;
  const examLabel = c.grade_system === "points_0_15" ? "Klausur" : "Klassenarbeit";

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
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-2xl font-black text-stone-900 leading-tight min-w-0">{c.name}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onPhotos}
            data-testid={`photos-class-${c.id}`}
            className="text-stone-300 hover:text-emerald-600 transition-colors"
            aria-label="Fotos zuordnen"
          >
            <Camera className="w-5 h-5" />
          </button>
          <button
            onClick={onDelete}
            data-testid={`delete-class-${c.id}`}
            className="text-stone-300 hover:text-rose-600 transition-colors"
            aria-label="Klasse löschen"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-stone-500 font-medium text-sm">
        <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {c.student_count}</span>
        <span className="flex items-center gap-1.5"><Camera className="w-4 h-4" /> {c.photo_count || 0}</span>
        <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-bold text-xs" data-testid={`class-system-${c.id}`}>
          {sysLabel}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-xs">
          {c.grade_scale_name || "MEDA"}
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
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-stone-400">{examLabel}en</p>
        <p className="mt-0.5 font-bold text-stone-800 text-sm" data-testid={`klausur-count-${c.id}`}>
          {klausur} Bewertung{klausur === 1 ? "" : "en"}
        </p>
        <button
          onClick={() => onStart("klausur")}
          data-testid={`start-klausur-${c.id}`}
          disabled={disabled}
          className="mt-2 w-full px-4 py-2.5 bg-sky-400 text-stone-900 font-heading font-extrabold rounded-xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-40 disabled:hover:translate-y-0"
        >
          <Plus className="w-4 h-4" /> Neue {examLabel}
        </button>
      </div>

      {sessions > 0 && (
        <div className="mt-4 pt-3 border-t-2 border-stone-100 space-y-2">
          <button
            onClick={() => run(onGradebook)}
            disabled={busy}
            data-testid={`gradebook-class-${c.id}`}
            className="w-full px-4 py-3 bg-white text-stone-900 font-bold rounded-xl border-2 border-stone-900 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            <Table2 className="w-4 h-4" />
            Notenstand
          </button>
          <button
            onClick={() => run(onDeleteGrades)}
            disabled={busy}
            data-testid={`delete-sessions-${c.id}`}
            className="w-full px-4 py-3 bg-white text-rose-700 font-bold rounded-xl border-2 border-rose-300 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Löschen
          </button>
        </div>
      )}
    </motion.div>
  );
}




function ImportOptionsModal({ options, scales, onChange, onCancel, onImport }) {
  if (!options) return null;
  const update = (patch) => onChange({ ...options, ...patch });
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-3xl border-2 border-stone-900 bg-white p-6 shadow-brutal">
        <h3 className="font-heading text-2xl font-black text-stone-900">Neue Klasse importieren</h3>
        <p className="mt-1 text-sm font-bold text-stone-500">Wähle Notenschema und Standardnotenskala für die neue Klasse.</p>
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-stone-700">Notenschema</span>
            <select value={options.gradeSystem} onChange={(e) => update({ gradeSystem: e.target.value })} className="mt-1 w-full rounded-xl border-2 border-stone-300 bg-white px-4 py-3 font-bold text-stone-900">
              <option value="grades_1_6">Noten 1-6</option>
              <option value="points_0_15">Punkte 0-15</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-bold text-stone-700">Standardnotenskala</span>
            <select value={options.gradeScaleId} onChange={(e) => update({ gradeScaleId: e.target.value })} className="mt-1 w-full rounded-xl border-2 border-stone-300 bg-white px-4 py-3 font-bold text-stone-900">
              {(scales || []).map((scale) => <option key={scale.id} value={scale.id}>{scale.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onCancel} className="rounded-xl border-2 border-stone-300 bg-white px-4 py-3 font-heading font-extrabold text-stone-700">Abbrechen</button>
          <button type="button" onClick={() => onImport(options)} className="rounded-xl border-2 border-stone-900 bg-stone-900 px-4 py-3 font-heading font-extrabold text-white">Importieren</button>
        </div>
      </div>
    </div>
  );
}
