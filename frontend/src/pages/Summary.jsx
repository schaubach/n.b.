import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2, Pencil, X, Trash2, Table2 } from "lucide-react";
import api from "../lib/api";
import { initials, allGrades, gradeColorClasses } from "../lib/grades";
import { overrideOptions } from "../lib/gradebook";
import { normalizeExamGradeValue, shouldUseWholeExamGrades } from "../lib/gradeScales";
import GradebookModal from "../components/GradebookModal";

export default function Summary() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(null); // student being corrected
  const [gradebookOpen, setGradebookOpen] = useState(false);

  const updateGrade = async (studentId, value) => {
    try {
      const normalizedValue = value === null ? null : normalizeExamGradeValue(value, session, session.grade_system);
      if (normalizedValue === null) {
        await api.delete(`/sessions/${sessionId}/grades/${studentId}`);
      } else {
        await api.post(`/sessions/${sessionId}/grades`, { student_id: studentId, value: normalizedValue });
      }
      setSession((s) => ({
        ...s,
        students: s.students.map((st) => (st.id === studentId ? { ...st, grade: normalizedValue } : st)),
      }));
    } catch (e) {}
    setPicker(null);
  };

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
      <main className="px-4 sm:px-10 max-w-3xl mx-auto pb-44 pt-8">
        <div className="mt-2">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">
            {session.category === "klausur" ? "Klausur" : "Sonstige Leistung"}
          </p>
          <h1 className="font-heading text-3xl sm:text-4xl font-black text-stone-900">
            {session.class_name}
          </h1>
          <p className="text-stone-500 mt-1 font-medium">
            {session.title} · Gewichtung {session.weight ?? 1} · {graded.length} von {students.length} bewertet
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 border-2 border-emerald-900/10 text-emerald-900 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" />
            {sessionCount} Bewertung{sessionCount === 1 ? "" : "en"} für diese Klasse gesammelt
          </div>
        </div>

        <div className="mt-6 rounded-3xl border-2 border-stone-900 bg-white shadow-brutal-sm overflow-hidden">
          {students.map((s, i) => (
            <motion.button
              key={s.id}
              type="button"
              onClick={() => setPicker(s)}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.015 }}
              data-testid={`summary-row-${s.id}`}
              className={`w-full text-left flex items-center gap-4 px-4 sm:px-6 py-3 hover:bg-stone-50 transition-colors ${i !== 0 ? "border-t-2 border-stone-100" : ""} ${s.inactive ? "opacity-60 grayscale" : ""}`}
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
                <p className="text-xs text-stone-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <Pencil className="w-3 h-3" /> {s.inactive ? "Nicht mehr im IServ-Import · weiter korrigierbar" : "Tippen zum Korrigieren"}
                </p>
              </div>
              <div
                data-testid={`summary-grade-${s.id}`}
                className={`min-w-[3rem] text-center px-3 py-1.5 rounded-xl font-mono font-black text-lg border-2 ${
                  s.grade
                    ? gradeColorClasses(s.grade, session.grade_system)
                    : "bg-stone-100 text-stone-300 border-stone-200"
                }`}
              >
                {s.grade || "–"}
              </div>
            </motion.button>
          ))}
        </div>
      </main>

      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-stone-50 via-stone-50 to-transparent">
        <div className="max-w-3xl mx-auto space-y-2">
          {graded.length > 0 && (
            <button
              onClick={() => setGradebookOpen(true)}
              data-testid="summary-gradebook-button"
              className="w-full px-5 py-3 bg-stone-900 text-white font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2"
            >
              <Table2 className="w-5 h-5" /> Notenstand <ArrowRight className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => navigate("/")}
            data-testid="summary-back-button"
            className="w-full px-5 py-3 bg-white text-stone-900 font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" /> Klassen
          </button>
        </div>
      </div>

      <GradebookModal
        open={gradebookOpen}
        classId={session.class_id}
        className={session.class_name}
        onClose={() => setGradebookOpen(false)}
      />

      <GradePicker
        student={picker}
        session={session}
        systemId={session.grade_system}
        onPick={(v) => updateGrade(picker.id, v)}
        onRemove={() => updateGrade(picker.id, null)}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

function GradePicker({ student, session, systemId, onPick, onRemove, onClose }) {
  const grades = shouldUseWholeExamGrades(session, systemId)
    ? overrideOptions(systemId).map((value) => ({ value, alt: "" }))
    : allGrades(systemId);
  return (
    <AnimatePresence>
      {student && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          data-testid="grade-picker"
        >
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="relative w-full max-w-md bg-white border-2 border-stone-900 rounded-3xl shadow-brutal p-6"
          >
            <button
              onClick={onClose}
              data-testid="picker-close"
              className="absolute top-4 right-4 text-stone-400 hover:text-stone-900 transition-colors"
              aria-label="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">Note korrigieren</p>
            <h3 className="font-heading text-2xl font-black text-stone-900 leading-tight mt-0.5">
              {student.first_name} {student.last_name}
            </h3>

            <div className="mt-5 grid grid-cols-4 gap-2">
              {grades.map((g) => (
                <button
                  key={g.value}
                  onClick={() => onPick(g.value)}
                  data-testid={`picker-grade-${g.value}`}
                  className={`py-3 rounded-xl border-2 font-mono font-black flex flex-col items-center justify-center transition-all active:scale-95 ${
                    student.grade === g.value
                      ? "ring-4 ring-stone-900 " + gradeColorClasses(g.value, systemId)
                      : gradeColorClasses(g.value, systemId)
                  }`}
                >
                  <span className="text-xl leading-none">{g.value}</span>
                  <span className="text-[10px] opacity-50 mt-0.5">{g.alt}</span>
                </button>
              ))}
            </div>

            {student.grade && (
              <button
                onClick={onRemove}
                data-testid="picker-remove"
                className="mt-4 w-full px-5 py-3 bg-white text-rose-600 font-bold rounded-xl border-2 border-rose-300 hover:border-rose-500 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Note entfernen
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
