import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Loader2, Pencil, FileSpreadsheet, Share2 } from "lucide-react";
import api from "../lib/api";
import { initials } from "../lib/grades";

export default function Summary() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api.get(`/sessions/${sessionId}`);
      setSession(res.data);
      setLoading(false);
    })();
    try {
      const probe = new File(["x"], "t.csv", { type: "text/csv" });
      setCanShareFiles(!!(navigator.canShare && navigator.canShare({ files: [probe] })));
    } catch (e) { setCanShareFiles(false); }
  }, [sessionId]);

  const fileName = () => {
    const name = (session?.class_name || "Klasse").replace(/\s+/g, "_");
    const date = (session?.date || "").replace(/\./g, "-");
    return `${name}_${date}.csv`;
  };

  const fetchCsvFile = async () => {
    const res = await api.get(`/sessions/${sessionId}/export.csv`, { responseType: "blob" });
    return new File([res.data], fileName(), { type: "text/csv" });
  };

  const handleDownload = async () => {
    setError(null);
    setBusy(true);
    try {
      const file = await fetchCsvFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setError("Download fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    setError(null);
    setBusy(true);
    try {
      const file = await fetchCsvFile();
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: fileName(),
          text: `Noten ${session?.class_name} (${session?.date})`,
        });
      } else {
        await handleDownload();
      }
    } catch (e) {
      if (e && e.name !== "AbortError") setError("Teilen nicht möglich. Datei wird stattdessen geladen.");
    } finally {
      setBusy(false);
    }
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

      {/* Sticky export bar */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-stone-50 via-stone-50 to-transparent">
        <div className="max-w-3xl mx-auto">
          {error && (
            <p data-testid="export-error" className="text-center text-sm font-bold text-rose-700 mb-2">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              disabled={busy}
              data-testid="export-csv-button"
              className="flex-1 px-5 py-4 bg-stone-900 text-white font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 hover:shadow-brutal active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-3 text-base sm:text-lg disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <FileSpreadsheet className="w-6 h-6" />}
              CSV herunterladen
              {!busy && <Download className="w-5 h-5" />}
            </button>
            <button
              onClick={handleShare}
              disabled={busy}
              data-testid="export-share-button"
              className="px-5 py-4 bg-emerald-400 text-stone-900 font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 hover:shadow-brutal active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              title="An iDoceo / Dateien teilen"
            >
              <Share2 className="w-6 h-6" />
              <span className="hidden sm:inline">Teilen</span>
            </button>
          </div>
          <p className="text-center text-xs text-stone-400 mt-2 font-medium">
            Spalte „{session.date}" · {canShareFiles ? '„Teilen" sendet direkt an iDoceo/Dateien · ' : ''}in iDoceo per CSV-Import einlesen
          </p>
        </div>
      </div>
    </div>
  );
}
