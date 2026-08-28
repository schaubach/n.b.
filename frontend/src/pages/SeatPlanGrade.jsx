import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, Check, FileUp, LayoutGrid, Loader2, Minus, Pencil, Plus, Trash2, X,
} from "lucide-react";
import api from "../lib/api";
import { gradeColorClasses, initials } from "../lib/grades";
import { gradeOptions, pointGradeLabel } from "../lib/gradebook";
import { parseSeatPlanPdf } from "../lib/seatPlanPdf";

function cellsFromPlan(plan) {
  const cells = Array(Math.max(1, plan.rows) * Math.max(2, plan.columns)).fill(null);
  (plan.seats || []).forEach((seat) => {
    const index = Number(seat.row) * Number(plan.columns) + Number(seat.column);
    if (index >= 0 && index < cells.length) cells[index] = seat.student_id;
  });
  return cells;
}

function seatsFromCells(cells, columns) {
  return cells.flatMap((studentId, index) => studentId ? [{
    row: Math.floor(index / columns),
    column: index % columns,
    student_id: studentId,
  }] : []);
}

function withOralAverage(students) {
  const average = students.length
    ? students.reduce((sum, student) => sum + (Number(student.oral_grade_count) || 0), 0) / students.length
    : 0;
  return students.map((student) => ({ ...student, oral_grade_average: average }));
}

function assessmentBorder(student) {
  const count = Number(student?.oral_grade_count);
  const average = Number(student?.oral_grade_average);
  if (!Number.isFinite(count) || !Number.isFinite(average) || average <= 0) return "border-2 border-stone-900";
  if (count <= average - 1) return "border-4 border-rose-500 ring-2 ring-rose-200";
  if (count >= average + 1) return "border-4 border-emerald-500 ring-2 ring-emerald-200";
  return "border-2 border-stone-900";
}

export default function SeatPlanGrade() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [session, setSession] = useState(null);
  const [students, setStudents] = useState([]);
  const [rows, setRows] = useState(1);
  const [columns, setColumns] = useState(4);
  const [cells, setCells] = useState([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const sessionRes = await api.get(`/sessions/${sessionId}`);
        const nextSession = sessionRes.data;
        const planRes = await api.get(`/classes/${nextSession.class_id}/seating-plan`);
        let nextPlan = planRes.data.plan;
        if (!planRes.data.saved) {
          const savedPlan = await api.put(`/classes/${nextSession.class_id}/seating-plan`, nextPlan);
          nextPlan = savedPlan.data.plan;
        }
        setSession(nextSession);
        setStudents(nextSession.students || planRes.data.students || []);
        setRows(nextPlan.rows);
        setColumns(nextPlan.columns);
        setCells(cellsFromPlan(nextPlan));
        if (!planRes.data.saved) setMessage("Standard-Sitzplan erstellt. Du kannst ihn direkt verwenden oder eine Sitzplan-PDF hochladen.");
      } catch (err) {
        setError(err?.response?.data?.detail || err?.message || "Sitzplan konnte nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const gradedCount = students.filter((student) => student.grade).length;

  const persist = async (nextRows, nextColumns, nextCells) => {
    setRows(nextRows);
    setColumns(nextColumns);
    setCells(nextCells);
    setSaving(true);
    setError("");
    try {
      const result = await api.put(`/classes/${session.class_id}/seating-plan`, {
        rows: nextRows,
        columns: nextColumns,
        seats: seatsFromCells(nextCells, nextColumns),
      });
      setRows(result.data.plan.rows);
      setColumns(result.data.plan.columns);
      setCells(cellsFromPlan(result.data.plan));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || "Sitzplan konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const uploadPdf = async (file) => {
    if (!file) return;
    setParsing(true);
    setError("");
    setMessage("");
    try {
      const parsed = await parseSeatPlanPdf(file, students);
      const nextCells = cellsFromPlan(parsed);
      await persist(parsed.rows, parsed.columns, nextCells);
      const uncertain = parsed.uncertain.length;
      const unmatched = parsed.unmatched.length;
      setEditing(uncertain > 0 || unmatched > 0);
      setMessage(`${parsed.matched} Namen wurden räumlich zugeordnet.${unmatched ? ` ${unmatched} nicht erkannte Namen wurden am Ende ergänzt.` : ""}${uncertain ? ` Bitte prüfe ${uncertain} unsichere Zuordnung${uncertain === 1 ? "" : "en"}.` : ""}`);
    } catch (err) {
      setError(err?.message || "Die Sitzplan-PDF konnte nicht ausgewertet werden.");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const assignSeat = (index, studentId) => {
    const next = cells.slice();
    if (studentId) {
      const previous = next.indexOf(studentId);
      if (previous >= 0) next[previous] = null;
    }
    next[index] = studentId || null;
    persist(rows, columns, next);
  };

  const changeRows = (delta) => {
    const nextRows = rows + delta;
    if (nextRows < 1 || nextRows > 30) return;
    if (delta < 0 && cells.slice((rows - 1) * columns).some(Boolean)) {
      setError("Die letzte Reihe enthält noch Lernende und kann deshalb nicht entfernt werden.");
      return;
    }
    persist(nextRows, columns, delta > 0 ? [...cells, ...Array(columns).fill(null)] : cells.slice(0, nextRows * columns));
  };

  const changeColumns = (delta) => {
    const nextColumns = columns + delta;
    if (nextColumns < 2 || nextColumns > 12) return;
    if (delta < 0 && Array.from({ length: rows }, (_, row) => cells[row * columns + columns - 1]).some(Boolean)) {
      setError("Die letzte Spalte enthält noch Lernende und kann deshalb nicht entfernt werden.");
      return;
    }
    const next = Array(rows * nextColumns).fill(null);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < Math.min(columns, nextColumns); column += 1) {
        next[row * nextColumns + column] = cells[row * columns + column];
      }
    }
    persist(rows, nextColumns, next);
  };

  const setGrade = async (student, value) => {
    const hadGrade = !!student.grade;
    try {
      if (value) await api.post(`/sessions/${sessionId}/grades`, { student_id: student.id, value });
      else await api.delete(`/sessions/${sessionId}/grades/${student.id}`);
      setStudents((current) => withOralAverage(current.map((item) => item.id === student.id ? {
        ...item,
        grade: value || null,
        oral_grade_count: hadGrade === !!value
          ? item.oral_grade_count
          : Math.max(0, (Number(item.oral_grade_count) || 0) + (value ? 1 : -1)),
      } : item)));
      setPicker(null);
    } catch (err) {
      setError(err?.response?.data?.detail || "Note konnte nicht gespeichert werden.");
    }
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-stone-50"><Loader2 className="h-8 w-8 animate-spin text-stone-400" /></div>;
  }

  if (!session) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-50 p-6"><div className="max-w-lg rounded-2xl border-2 border-rose-800 bg-rose-100 p-5 font-bold text-rose-900">{error}</div></div>;
  }

  return (
    <div className="min-h-screen bg-stone-50 bg-dots">
      <header className="sticky top-0 z-40 border-b-2 border-stone-200 bg-stone-50/95 px-3 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 rounded-full border-2 border-stone-900 bg-white px-3 py-2 font-bold shadow-brutal-sm">
            <ArrowLeft className="h-5 w-5" /> <span className="hidden sm:inline">Klassen</span>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate font-heading text-lg font-black text-stone-900">{session.class_name}</p>
            <p className="truncate text-xs font-bold uppercase tracking-[0.14em] text-stone-500">{session.title} · Sitzplan · {gradedCount}/{students.length}</p>
          </div>
          <button onClick={() => navigate(`/summary/${sessionId}`)} className="flex items-center gap-2 rounded-xl border-2 border-stone-900 bg-stone-900 px-4 py-2.5 font-heading font-extrabold text-white shadow-brutal-sm">
            <Check className="h-5 w-5" /> Fertig
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-stone-900 bg-white p-3 shadow-brutal-sm">
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(event) => uploadPdf(event.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={parsing || saving} className="flex items-center gap-2 rounded-xl border-2 border-stone-900 bg-emerald-400 px-4 py-2.5 font-heading font-extrabold disabled:opacity-50">
            {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />} Sitzplan hochladen
          </button>
          <button onClick={() => setEditing((value) => !value)} className={`flex items-center gap-2 rounded-xl border-2 border-stone-900 px-4 py-2.5 font-heading font-extrabold ${editing ? "bg-amber-300" : "bg-white"}`}>
            {editing ? <Check className="h-5 w-5" /> : <Pencil className="h-5 w-5" />} {editing ? "Bearbeitung fertig" : "Sitzplan bearbeiten"}
          </button>
          {editing && (
            <div className="ml-auto flex flex-wrap items-center gap-2 text-sm font-bold">
              <span>Reihen</span><StepButton icon={Minus} onClick={() => changeRows(-1)} disabled={saving || rows <= 1} /><span className="w-6 text-center font-mono">{rows}</span><StepButton icon={Plus} onClick={() => changeRows(1)} disabled={saving || rows >= 30} />
              <span className="ml-2">Spalten</span><StepButton icon={Minus} onClick={() => changeColumns(-1)} disabled={saving || columns <= 2} /><span className="w-6 text-center font-mono">{columns}</span><StepButton icon={Plus} onClick={() => changeColumns(1)} disabled={saving || columns >= 12} />
            </div>
          )}
          <span className="ml-auto inline-flex min-w-[7rem] items-center justify-end gap-2 text-sm font-bold text-stone-500">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> speichere</> : <><Check className="h-4 w-4 text-emerald-600" /> gespeichert</>}
          </span>
        </div>

        {message && <div className="mt-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 font-bold text-emerald-900">{message}</div>}
        {error && <div className="mt-3 flex items-center gap-2 rounded-xl border-2 border-rose-400 bg-rose-100 px-4 py-3 font-bold text-rose-900"><X className="h-5 w-5 shrink-0" />{error}</div>}

        <div className="mt-5 overflow-auto rounded-2xl border-2 border-stone-900 bg-stone-200 p-3 shadow-brutal-sm" style={{ maxHeight: "calc(100vh - 210px)" }}>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(132px, 1fr))`, minWidth: `${columns * 144}px` }}>
            {cells.map((studentId, index) => {
              const student = studentsById.get(studentId);
              return editing ? (
                <SeatEditor key={index} student={student} students={students} onChange={(value) => assignSeat(index, value)} />
              ) : (
                <SeatCard key={index} student={student} systemId={session.grade_system} onClick={() => student && setPicker(student)} />
              );
            })}
          </div>
        </div>
      </main>

      <GradePicker student={picker} systemId={session.grade_system} onPick={(value) => setGrade(picker, value)} onRemove={() => setGrade(picker, null)} onClose={() => setPicker(null)} />
    </div>
  );
}

function StepButton({ icon: Icon, onClick, disabled }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-stone-900 bg-white disabled:opacity-30"><Icon className="h-4 w-4" /></button>;
}

function SeatEditor({ student, students, onChange }) {
  return (
    <div className={`flex min-h-28 flex-col justify-between rounded-xl border-2 border-dashed p-2 ${student ? "border-stone-900 bg-white" : "border-stone-400 bg-stone-100"}`}>
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-4 w-4 text-stone-400" />
        <span className="truncate text-xs font-bold text-stone-500">{student ? `${student.first_name} ${student.last_name}` : "Freier Platz"}</span>
      </div>
      <select value={student?.id || ""} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-lg border-2 border-stone-300 bg-white px-2 py-2 text-sm font-bold text-stone-900">
        <option value="">Freier Platz</option>
        {students.map((option) => <option key={option.id} value={option.id}>{option.last_name}, {option.first_name}</option>)}
      </select>
    </div>
  );
}

function SeatCard({ student, systemId, onClick }) {
  if (!student) return <div className="min-h-32 rounded-xl border-2 border-dashed border-stone-400 bg-stone-100" aria-label="Freier Platz" />;
  return (
    <button type="button" onClick={onClick} className={`relative flex min-h-32 min-w-0 flex-col items-center justify-center overflow-hidden rounded-xl bg-white p-3 text-center shadow-sm transition-transform active:scale-[0.98] ${assessmentBorder(student)} ${student.inactive ? "opacity-60 grayscale" : ""}`}>
      {student.grade && <span className={`absolute right-2 top-2 rounded-lg border-2 px-2 py-1 font-mono text-lg font-black ${gradeColorClasses(student.grade, systemId)}`}>{student.grade}</span>}
      <div className="h-14 w-14 overflow-hidden rounded-xl border-2 border-stone-900 bg-stone-200">
        {student.photo ? <img src={student.photo} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center font-heading text-xl font-black text-stone-500">{initials(student.first_name, student.last_name)}</span>}
      </div>
      <span className="mt-2 max-w-full truncate text-xs font-bold text-stone-500">{student.first_name}</span>
      <span className="max-w-full truncate font-heading text-base font-black text-stone-900">{student.last_name}</span>
    </button>
  );
}

function GradePicker({ student, systemId, onPick, onRemove, onClose }) {
  const options = gradeOptions(systemId);
  return (
    <AnimatePresence>
      {student && (
        <motion.div className="fixed inset-0 z-[100] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }} className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border-2 border-stone-900 bg-white p-6 shadow-brutal">
            <button onClick={onClose} className="absolute right-4 top-4 text-stone-500" aria-label="Schließen"><X className="h-5 w-5" /></button>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Mündliche Note</p>
            <h2 className="pr-8 font-heading text-2xl font-black text-stone-900">{student.first_name} {student.last_name}</h2>
            <div className="mt-5 grid grid-cols-4 gap-2">
              {options.map((value) => <button key={value} onClick={() => onPick(value)} className={`flex min-h-16 flex-col items-center justify-center rounded-xl border-2 font-mono font-black active:scale-95 ${student.grade === value ? "ring-4 ring-stone-900 " : ""}${gradeColorClasses(value, systemId)}`}><span className="text-xl">{value}</span>{systemId === "points_0_15" && <span className="text-[10px] opacity-70">{pointGradeLabel(value)}</span>}</button>)}
            </div>
            {student.grade && <button onClick={onRemove} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-rose-300 bg-white px-4 py-3 font-bold text-rose-700"><Trash2 className="h-4 w-4" /> Note entfernen</button>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
