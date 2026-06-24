import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Undo2, Loader2, CheckCheck } from "lucide-react";
import api from "../lib/api";
import { buildCells, initials } from "../lib/grades";

const THRESHOLD = 70; // px of drag before a grade can register

function vibrate(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
}

export default function Grade() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [students, setStudents] = useState([]);
  const [cells, setCells] = useState([]);
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(null);
  const [exitDir, setExitDir] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const cellRefs = useRef([]);
  const centersRef = useRef([]);
  const areaRef = useRef(null);

  useEffect(() => {
    (async () => {
      const res = await api.get(`/sessions/${sessionId}`);
      setSession(res.data);
      setStudents(res.data.students);
      setCells(buildCells(res.data.grade_system));
      const firstUngraded = res.data.students.findIndex((s) => !s.grade);
      setIndex(firstUngraded === -1 ? res.data.students.length : firstUngraded);
      setLoading(false);
    })();
  }, [sessionId]);

  const measure = useCallback(() => {
    centersRef.current = cellRefs.current.map((el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, cells, index]);

  const nearestCell = (point) => {
    let best = null, bestDist = Infinity;
    centersRef.current.forEach((c, i) => {
      if (!c) return;
      const d = Math.hypot(point.x - c.x, point.y - c.y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };

  const onDrag = (_e, info) => {
    const dist = Math.hypot(info.offset.x, info.offset.y);
    if (dist < THRESHOLD) {
      if (active !== null) setActive(null);
      return;
    }
    const i = nearestCell(info.point);
    if (i !== active) { setActive(i); vibrate(8); }
  };

  const assign = useCallback(async (cellIndex) => {
    const student = students[index];
    const cell = cells[cellIndex];
    if (!student || !cell) return;

    const center = centersRef.current[cellIndex];
    if (center) {
      setExitDir({
        x: (center.x - window.innerWidth / 2) * 1.8,
        y: (center.y - window.innerHeight / 2) * 1.8,
      });
    }
    vibrate(20);
    setHistory((h) => [...h, { studentId: student.id, index }]);
    setActive(null);
    setIndex((i) => i + 1);

    try {
      await api.post(`/sessions/${sessionId}/grades`, {
        student_id: student.id, value: cell.value,
      });
    } catch (e) {}
  }, [students, index, cells, sessionId]);

  const onDragEnd = (_e, info) => {
    const dist = Math.hypot(info.offset.x, info.offset.y);
    if (dist >= THRESHOLD && active !== null) {
      assign(active);
    } else {
      setActive(null);
    }
  };

  const undo = async () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setExitDir({ x: 0, y: 0 });
    setIndex(last.index);
    vibrate(12);
    try {
      await api.delete(`/sessions/${sessionId}/grades/${last.studentId}`);
    } catch (e) {}
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  const done = index >= students.length;
  const student = students[index];
  const total = students.length;

  return (
    <div className="h-screen w-screen overflow-hidden bg-stone-50 bg-dots no-scroll flex flex-col select-none">
      {/* Header */}
      <header className="h-16 sm:h-20 px-4 sm:px-8 flex items-center justify-between shrink-0 z-50">
        <button
          onClick={() => navigate("/")}
          data-testid="grade-back-button"
          className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-stone-900 rounded-full font-bold text-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all"
        >
          <ArrowLeft className="w-5 h-5" /> <span className="hidden sm:inline">Klassen</span>
        </button>

        <div className="text-center">
          <p className="font-heading font-extrabold text-stone-900 leading-none text-lg sm:text-xl">
            {session?.class_name}
          </p>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
            {session?.date}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="grade-progress"
            className="px-4 py-2 bg-white border-2 border-stone-900 rounded-full font-mono font-bold text-stone-900 shadow-brutal-sm"
          >
            {Math.min(index, total)} / {total}
          </span>
          <button
            onClick={undo}
            disabled={history.length === 0}
            data-testid="undo-grade-button"
            className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-stone-900 rounded-full font-bold text-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-30"
          >
            <Undo2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Grading area */}
      <div ref={areaRef} className="flex-1 relative w-full">
        {/* Edge cells */}
        <EdgeCells cells={cells} active={active} cellRefs={cellRefs}
          onTapCell={(i) => !done && assign(i)} />

        {/* Card */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <AnimatePresence custom={exitDir} mode="popLayout">
            {!done && student && (
              <motion.div
                key={student.id}
                data-testid="student-swipe-card"
                className="pointer-events-auto relative z-40 w-[230px] h-[310px] sm:w-[300px] sm:h-[400px] bg-white border-2 border-stone-900 rounded-3xl shadow-brutal flex flex-col overflow-hidden cursor-grab active:cursor-grabbing"
                drag
                dragSnapToOrigin
                dragElastic={0.6}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                custom={exitDir}
                initial={{ scale: 0.85, opacity: 0, y: 30 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={(dir) => ({
                  x: dir.x, y: dir.y, scale: 0.3, opacity: 0, rotate: dir.x > 0 ? 18 : -18,
                  transition: { duration: 0.32, ease: "easeIn" },
                })}
                whileDrag={{ scale: 1.04, boxShadow: "16px 16px 0px 0px #1c1917" }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
              >
                <div className="flex-1 w-full bg-stone-200 border-b-2 border-stone-900 overflow-hidden">
                  {student.photo ? (
                    <img src={student.photo} alt="" draggable={false}
                      className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-200 to-stone-300">
                      <span className="font-heading text-6xl font-black text-stone-400">
                        {initials(student.first_name, student.last_name)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="h-24 sm:h-28 px-4 flex flex-col justify-center items-center text-center">
                  <span className="text-sm font-bold text-stone-500 uppercase tracking-wider truncate max-w-full">
                    {student.first_name}
                  </span>
                  <span className="font-heading text-2xl sm:text-3xl font-black text-stone-900 leading-none mt-0.5 truncate max-w-full">
                    {student.last_name}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {done && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              data-testid="grading-done"
              className="pointer-events-auto z-40 bg-white border-2 border-stone-900 rounded-3xl shadow-brutal p-8 sm:p-10 text-center max-w-sm mx-4"
            >
              <div className="w-16 h-16 rounded-2xl bg-emerald-400 border-2 border-stone-900 flex items-center justify-center mx-auto mb-5 shadow-brutal-sm">
                <CheckCheck className="w-9 h-9 text-stone-900" />
              </div>
              <h2 className="font-heading text-2xl font-black text-stone-900">Alle bewertet!</h2>
              <p className="text-stone-500 mt-2">
                {total} Schüler*innen der Klasse {session?.class_name}.
              </p>
              <button
                onClick={() => navigate(`/summary/${sessionId}`)}
                data-testid="go-summary-button"
                className="mt-6 w-full px-5 py-4 bg-stone-900 text-white font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all"
              >
                Zusammenfassung & Export
              </button>
              {history.length > 0 && (
                <button onClick={undo} className="mt-3 w-full px-5 py-3 text-stone-600 font-bold">
                  <Undo2 className="w-4 h-4 inline mr-1" /> Letzte Note korrigieren
                </button>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function EdgeCells({ cells, active, cellRefs, onTapCell }) {
  const groups = [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8, 12), cells.slice(12, 16)];
  const cell = (c) => {
    const isActive = active === c.index;
    return (
      <button
        key={c.index}
        ref={(el) => (cellRefs.current[c.index] = el)}
        onClick={() => onTapCell(c.index)}
        data-testid={`grade-cell-${c.value}`}
        className={`w-14 h-14 sm:w-[4.5rem] sm:h-[4.5rem] rounded-2xl border-2 flex items-center justify-center font-mono font-black text-lg sm:text-2xl transition-all duration-150 ${
          isActive ? c.zone.active : `${c.zone.idle} border-transparent`
        }`}
      >
        {c.value}
      </button>
    );
  };
  return (
    <>
      <div className="absolute top-2 sm:top-4 left-1/2 -translate-x-1/2 flex gap-2 sm:gap-3 z-30">
        {groups[0].map(cell)}
      </div>
      <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 sm:gap-3 z-30">
        {groups[1].map(cell)}
      </div>
      <div className="absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 flex gap-2 sm:gap-3 z-30">
        {groups[2].map(cell)}
      </div>
      <div className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 sm:gap-3 z-30">
        {groups[3].map(cell)}
      </div>
    </>
  );
}
