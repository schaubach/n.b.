import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Undo2, Loader2 } from "lucide-react";
import api from "../lib/api";
import { buildCells, gradeColorClasses, gradeAccent, initials } from "../lib/grades";
import { normalizeExamGradeValue } from "../lib/gradeScales";

const THRESHOLD = 55; // px of drag before a grade registers

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
  const [flash, setFlash] = useState(null);

  const cellRefs = useRef([]);
  const centersRef = useRef([]);
  const draggingRef = useRef(false);
  const assigningRef = useRef(false);

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

  // When all students are graded, go straight to the list.
  useEffect(() => {
    if (!loading && students.length > 0 && index >= students.length) {
      const t = setTimeout(() => navigate(`/summary/${sessionId}`, { replace: true }), 380);
      return () => clearTimeout(t);
    }
  }, [index, students.length, loading, navigate, sessionId]);

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

  const assign = useCallback((value, exitVec, color) => {
    const student = students[index];
    if (!student || assigningRef.current) return;
    const finalValue = normalizeExamGradeValue(value, session, session.grade_system);
    assigningRef.current = true;
    setFlash({ value: finalValue, color: gradeAccent(finalValue, session.grade_system) || color });
    setActive(null);
    vibrate(30);
    api.post(`/sessions/${sessionId}/grades`, { student_id: student.id, value: finalValue }).catch(() => {});
    setTimeout(() => {
      setExitDir(exitVec || { x: 0, y: 0 });
      setHistory((h) => [...h, { studentId: student.id, index }]);
      setIndex((i) => i + 1);
      setFlash(null);
      assigningRef.current = false;
    }, 240);
  }, [students, index, session, sessionId]);

  const exitVecFor = (i) => {
    const c = centersRef.current[i];
    return c
      ? { x: (c.x - window.innerWidth / 2) * 1.9, y: (c.y - window.innerHeight / 2) * 1.9 }
      : { x: 0, y: 0 };
  };

  const onDrag = (_e, info) => {
    const dist = Math.hypot(info.offset.x, info.offset.y);
    if (dist > 10) draggingRef.current = true;
    if (dist < THRESHOLD) {
      if (active !== null) setActive(null);
      return;
    }
    const i = nearestCell(info.point);
    if (i !== active) { setActive(i); vibrate(8); }
  };

  const onDragEnd = (_e, info) => {
    const dist = Math.hypot(info.offset.x, info.offset.y);
    if (dist >= THRESHOLD && active !== null) {
      const cell = cells[active];
      assign(cell.value, exitVecFor(active), gradeAccent(cell.value, session.grade_system));
    } else {
      setActive(null);
    }
    setTimeout(() => { draggingRef.current = false; }, 60);
  };

  const tapCell = (i) => {
    if (index >= students.length || assigningRef.current) return;
    assign(cells[i].value, exitVecFor(i), gradeAccent(cells[i].value, session.grade_system));
  };

  const skipCard = () => {
    if (draggingRef.current || assigningRef.current) return;
    const student = students[index];
    if (!student) return;
    assigningRef.current = true;
    setActive(null);
    setExitDir({ x: 0, y: window.innerHeight * 0.7 });
    setHistory((h) => [...h, { studentId: student.id, index }]);
    setIndex((i) => i + 1);
    vibrate(10);
    setTimeout(() => { assigningRef.current = false; }, 260);
  };

  const undo = async () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setExitDir({ x: 0, y: 0 });
    setIndex(last.index);
    vibrate(12);
    try { await api.delete(`/sessions/${sessionId}/grades/${last.studentId}`); } catch (e) {}
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
  const byZone = (z) => cells.filter((c) => c.zone === z);
  const flankLeft = cells.find((c) => c.zone === "flankLeft");
  const flankRight = cells.find((c) => c.zone === "flankRight");

  return (
    <div className="h-screen w-screen overflow-hidden bg-stone-50 no-scroll flex flex-col select-none">
      {/* Header */}
      <header className="h-14 sm:h-16 px-3 sm:px-6 flex items-center justify-between shrink-0 z-50">
        <button
          onClick={() => navigate("/")}
          data-testid="grade-back-button"
          className="flex items-center gap-2 px-3 py-2 bg-white border-2 border-stone-900 rounded-full font-bold text-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all"
        >
          <ArrowLeft className="w-5 h-5" /> <span className="hidden sm:inline">Klassen</span>
        </button>
        <div className="text-center">
          <p className="font-heading font-extrabold text-stone-900 leading-none text-base sm:text-lg">
            {session?.class_name}
          </p>
          <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
            {session?.title} · {session?.date}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="grade-progress"
            className="px-3 py-1.5 bg-white border-2 border-stone-900 rounded-full font-mono font-bold text-stone-900 shadow-brutal-sm text-sm"
          >
            {Math.min(index, total)} / {total}
          </span>
          <button
            onClick={undo}
            disabled={history.length === 0}
            data-testid="undo-grade-button"
            className="flex items-center px-3 py-2 bg-white border-2 border-stone-900 rounded-full font-bold text-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-30"
          >
            <Undo2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Grading area */}
      <div className="flex-1 relative w-full">
        {/* Top zone (1er) */}
        <div className="absolute top-0 left-0 right-0 h-[30%] grid grid-cols-3 gap-1.5 p-1.5 z-10">
          {byZone("top").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} systemId={session.grade_system} />)}
        </div>
        {/* Bottom zone (3er) */}
        <div className="absolute bottom-0 left-0 right-0 h-[30%] grid grid-cols-3 gap-1.5 p-1.5 z-10">
          {byZone("bottom").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} systemId={session.grade_system} />)}
        </div>
        {/* Left zone (4er) */}
        <div className="absolute left-0 top-[30%] bottom-[30%] w-[21%] grid grid-rows-3 gap-1.5 p-1.5 z-10">
          {byZone("left").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} systemId={session.grade_system} />)}
        </div>
        {/* Right zone (2er) */}
        <div className="absolute right-0 top-[30%] bottom-[30%] w-[21%] grid grid-rows-3 gap-1.5 p-1.5 z-10">
          {byZone("right").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} systemId={session.grade_system} />)}
        </div>
        {/* Flank 6 (left of card) */}
        <div className="absolute left-[21%] top-[35%] bottom-[35%] w-[14%] p-1.5 z-10">
          {flankLeft && <ZoneCell c={flankLeft} active={active} cellRefs={cellRefs} onTap={tapCell} systemId={session.grade_system} />}
        </div>
        {/* Flank 5 (right of card) */}
        <div className="absolute right-[21%] top-[35%] bottom-[35%] w-[14%] p-1.5 z-10">
          {flankRight && <ZoneCell c={flankRight} active={active} cellRefs={cellRefs} onTap={tapCell} systemId={session.grade_system} />}
        </div>

        {/* Card */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <AnimatePresence custom={exitDir} mode="popLayout">
            {!done && student && (
              <motion.div
                key={student.id}
                data-testid="student-swipe-card"
                className={`pointer-events-auto relative z-40 w-[168px] h-[224px] sm:w-[210px] sm:h-[280px] bg-white border-2 border-stone-900 rounded-3xl shadow-brutal flex flex-col overflow-hidden cursor-grab active:cursor-grabbing ${student.inactive ? "opacity-60 grayscale" : ""}`}
                drag
                dragSnapToOrigin
                dragElastic={0.7}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                onTap={skipCard}
                custom={exitDir}
                initial={{ scale: 0.85, opacity: 0, y: 24 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={(dir) => ({
                  x: dir.x, y: dir.y, scale: 0.3, opacity: 0, rotate: dir.x > 0 ? 16 : dir.x < 0 ? -16 : 0,
                  transition: { duration: 0.3, ease: "easeIn" },
                })}
                whileDrag={{ scale: 1.05, boxShadow: "16px 16px 0px 0px #1c1917" }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
              >
                <div className="flex-1 w-full bg-stone-200 border-b-2 border-stone-900 overflow-hidden">
                  {student.photo ? (
                    <img src={student.photo} alt="" draggable={false} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-200 to-stone-300">
                      <span className="font-heading text-5xl font-black text-stone-400">
                        {initials(student.first_name, student.last_name)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="px-3 py-2 flex flex-col justify-center items-center text-center">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider truncate max-w-full">
                    {student.first_name}
                  </span>
                  <span className="font-heading text-lg sm:text-2xl font-black text-stone-900 leading-none truncate max-w-full">
                    {student.last_name}
                  </span>
                  <span className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-stone-200 text-stone-600 font-bold text-[11px] uppercase tracking-wide border-2 border-stone-900/10">
                    {student.inactive ? "Nicht mehr im IServ-Import" : "Tippen = überspringen"}
                  </span>
                </div>

                <AnimatePresence>
                  {flash && (
                    <motion.div
                      key="flash"
                      data-testid="grade-flash"
                      className="absolute inset-0 z-50 rounded-3xl flex items-center justify-center pointer-events-none"
                      style={{ backgroundColor: flash.color + "e6", boxShadow: `0 0 0 8px ${flash.color}` }}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                    >
                      <span className="font-mono font-black text-white text-6xl sm:text-7xl drop-shadow-lg">
                        {flash.value}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ZoneCell({ c, active, cellRefs, onTap, systemId }) {
  const isActive = active === c.index;
  const color = gradeColorClasses(c.value, systemId);
  return (
    <button
      ref={(el) => (cellRefs.current[c.index] = el)}
      onClick={() => onTap(c.index)}
      data-testid={`grade-cell-${c.value}`}
      className={`relative w-full h-full rounded-2xl border-2 flex flex-col items-center justify-center transition-all duration-150 ${color} ${
        isActive ? "ring-4 ring-stone-900 z-30 scale-[1.03]" : ""
      }`}
    >
      <span className="font-mono font-black text-3xl sm:text-5xl leading-none">{c.value}</span>
      <span className="font-mono font-bold text-xs sm:text-base opacity-70 mt-1">{c.alt}</span>
    </button>
  );
}
