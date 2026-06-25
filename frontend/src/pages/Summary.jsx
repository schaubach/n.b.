import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, FileSpreadsheet, Share2, Plus, CheckCircle2, Pencil } from "lucide-react";
import api from "../lib/api";
import { initials } from "../lib/grades";
import { exportAndDelete, shareAndDelete, canShareFiles } from "../lib/exportClass";

export default function Summary() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const res = await api.get(`/sessions/${sessionId}`);
      setSession(res.data);
      try {
        const cls = await api.get(`/classes/${res.data.class_id}`);
        setSessionCount(cls.data.session_count || 0);
      } catch (e) {}
      setLoading(false);
    })();
  }, [sessionId]);

  const newRound = async () => {
    const res = await api.post("/sessions", { class_id: session.class_id });
    navigate(`/grade/${res.data.id}`);
  };

  const handleExport = async () => {
    if (!window.confirm(
      "Alle gesammelten Benotungen werden als CSV exportiert und anschließend gelöscht. Fortfahren?"
    )) return;
    setError(null); setBusy(true);
    try {
      await exportAndDelete(session.class_id, session.class_name);
      navigate("/");
    } catch (e) {
      setError("Export fehlgeschlagen. Bitte erneut versuchen.");
    } finally { setBusy(false); }
  };

  const handleShare = async () => {
    if (!window.confirm(
      "Alle gesammelten Benotungen werden geteilt und anschließend gelöscht. Fortfahren?"
    )) return;
    setError(null); setBusy(true);
    try {
      const ok = await shareAndDelete(session.class_id, session.class_name);
      if (ok) navigate("/");
    } catch (e) {
      setError("Teilen fehlgeschlagen. Bitte erneut versuchen.");
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  const students = session.students || [];
  const graded = students.filter((s) => s.grade);

  return (
    <div className="min-h-screen bg-stone-50 bg-dots">
      <header className="px-4 sm:px-10 pt-8 pb-4 max-w-3xl mx-auto flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          data-testid="summary-back-button"
          className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-stone-900 rounded-full font-bold text-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all"
        >
          <ArrowLeft className="w-5 h-5" /> Klassen
        </button>
        <button
          onClick={() => navigate(`/grade/${sessionId}`)}
          data-testid="summary-edit-button"
          className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-stone-900 rounded-full font-bold text-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all"
        >
          <Pencil className="w-4 h-4" /> Bearbeiten
        </button>
      </header>

      <main className="px-4 sm:px-10 max-w-3xl mx-auto pb-32">
        <div className="mt-2">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">Zusammenfassung</p>
          <h1 className="font-heading text-3xl sm:text-4xl font-black text-stone-900">
            {session.class_name}
          </h1>
          <p className="text-stone-500 mt-1 font-medium">
            {session.title} · {graded.length} von {students.length} bewertet
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 border-2 border-emerald-900/10 text-emerald-900 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" />
            {sessionCount} Bewertung{sessionCount === 1 ? "" : "en"} für diese Klasse gesammelt
          </div>
        </div>

        <div className="mt-6 rounded-3xl border-2 border-stone-900 bg-white shadow-brutal-sm overflow-hidden">
          {students.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.015 }}
              data-testid={`summary-row-${s.id}`}
              className={`flex items-center gap-4 px-4 sm:px-6 py-3 ${i !== 0 ? "border-t-2 border-stone-100" : ""}`}
            >
              <div className="w-11 h-11 rounded-xl border-2 border-stone-900 overflow-hidden bg-stone-200 shrink-0">
                {s.photo ? (
                  <img src={s.photo} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-heading font-black text-stone-400">
                    {initials(s.first_name, s.last_name)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-stone-900 truncate">
                  {s.first_name} <span className="font-black">{s.last_name}</span>
                </p>
              </div>
              <div
                data-testid={`summary-grade-${s.id}`}
                className={`min-w-[3rem] text-center px-3 py-1.5 rounded-xl font-mono font-black text-lg border-2 ${
                  s.grade
                    ? "bg-emerald-100 text-emerald-900 border-stone-900"
                    : "bg-stone-100 text-stone-300 border-stone-200"
                }`}
              >
                {s.grade || "–"}
              </div>
            </motion.div>
          ))}
        </div>
      </main>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-stone-50 via-stone-50 to-transparent">
        <div className="max-w-3xl mx-auto">
          {error && (
            <p data-testid="export-error" className="text-center text-sm font-bold text-rose-700 mb-2">
              {error}
            </p>
          )}
          <button
            onClick={newRound}
            disabled={busy}
            data-testid="summary-new-round-button"
            className="w-full mb-3 px-5 py-3 bg-emerald-400 text-stone-900 font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Plus className="w-5 h-5" /> Weitere Bewertung erstellen
          </button>
          <div className="flex gap-3">
            <button
              onClick={handleExport}
              disabled={busy}
              data-testid="export-csv-button"
              className="flex-1 px-4 py-4 bg-stone-900 text-white font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 text-sm sm:text-base disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
              Exportieren &amp; löschen
            </button>
            <button
              onClick={handleShare}
              disabled={busy}
              data-testid="export-share-button"
              className="flex-1 px-4 py-4 bg-white text-stone-900 font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 text-sm sm:text-base disabled:opacity-50"
            >
              <Share2 className="w-5 h-5" />
              {canShareFiles() ? "Teilen" : "Laden"} &amp; löschen
            </button>
          </div>
          <p className="text-center text-xs text-stone-400 mt-2 font-medium">
            Export enthält alle gesammelten Runden (je eine Spalte) · danach wird der Bestand geleert
          </p>
        </div>
      </div>
    </div>
  );
}
