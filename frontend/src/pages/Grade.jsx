import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Undo2, Loader2, CheckCheck, Hand } from "lucide-react";
import api from "../lib/api";
import { buildEdgeCells, centerCell, ZONE_STYLES, initials } from "../lib/grades";

const THRESHOLD = 60; // px of drag before an edge grade registers

function vibrate(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
}

export default function Grade() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState(null);
  const [students, setStudents] = useState([]);
  const [cells, setCells] = useState([]);
  const [center, setCenter] = useState({ value: "5", alt: "3" });
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(null);
  const [exitDir, setExitDir] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const cellRefs = useRef([]);
  const centersRef = useRef([]);
  const draggingRef = useRef(false);

  useEffect(() => {
    (async () => {
      const res = await api.get(`/sessions/${sessionId}`);
      setSession(res.data);
      setStudents(res.data.students);
      setCells(buildEdgeCells(res.data.grade_system));
      setCenter(centerCell(res.data.grade_system));
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

  const assign = useCallback((value, exitVec) => {
    const student = students[index];
    if (!student) return;
    setExitDir(exitVec || { x: 0, y: 0 });
    vibrate(20);
    setHistory((h) => [...h, { studentId: student.id, index }]);
    setActive(null);
    setIndex((i) => i + 1);
    api.post(`/sessions/${sessionId}/grades`, { student_id: student.id, value }).catch(() => {});
  }, [students, index, sessionId]);

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
      const c = centersRef.current[active];
      const exitVec = c
        ? { x: (c.x - window.innerWidth / 2) * 1.8, y: (c.y - window.innerHeight / 2) * 1.8 }
        : { x: 0, y: 0 };
      assign(cell.value, exitVec);
    } else {
      setActive(null);
    }
    setTimeout(() => { draggingRef.current = false; }, 60);
  };

  const onTapCard = () => {
    if (draggingRef.current) return;
    assign(center.value, { x: 0, y: 0 });
  };

  const tapCell = (i) => {
    if (index >= students.length) return;
    const c = centersRef.current[i];
    const exitVec = c
      ? { x: (c.x - window.innerWidth / 2) * 1.8, y: (c.y - window.innerHeight / 2) * 1.8 }
      : { x: 0, y: 0 };
    assign(cells[i].value, exitVec);
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
            {session?.date}
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
        {/* Top zone */}
        <div className="absolute top-0 left-0 right-0 h-[30%] grid grid-cols-3 gap-1.5 p-1.5 z-10">
          {byZone("top").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} />)}
        </div>
        {/* Bottom zone */}
        <div className="absolute bottom-0 left-0 right-0 h-[30%] grid grid-cols-3 gap-1.5 p-1.5 z-10">
          {byZone("bottom").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} />)}
        </div>
        {/* Left zone */}
        <div className="absolute left-0 top-[30%] bottom-[30%] w-[26%] grid grid-rows-3 gap-1.5 p-1.5 z-10">
          {byZone("left").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} />)}
        </div>
        {/* Right zone */}
        <div className="absolute right-0 top-[30%] bottom-[30%] w-[26%] grid grid-rows-3 gap-1.5 p-1.5 z-10">
          {byZone("right").map((c) => <ZoneCell key={c.index} c={c} active={active} cellRefs={cellRefs} onTap={tapCell} />)}
        </div>

        {/* Card / center */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <AnimatePresence custom={exitDir} mode="popLayout">
            {!done && student && (
              <motion.div
                key={student.id}
                data-testid="student-swipe-card"
                className="pointer-events-auto relative z-40 w-[190px] h-[248px] sm:w-[230px] sm:h-[300px] bg-white border-2 border-stone-900 rounded-3xl shadow-brutal flex flex-col overflow-hidden cursor-grab active:cursor-grabbing"
                drag
                dragSnapToOrigin
                dragElastic={0.7}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                onTap={onTapCard}
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
                  <span className="font-heading text-xl sm:text-2xl font-black text-stone-900 leading-none truncate max-w-full">
                    {student.last_name}
                  </span>
                  <span className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-200 text-violet-900 font-mono font-bold text-xs border-2 border-stone-900/10">
                    <Hand className="w-3 h-3" /> Tippen = {center.value} · {center.alt}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {done && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              data-testid="grading-done"
              className="pointer-events-auto z-40 bg-white border-2 border-stone-900 rounded-3xl shadow-brutal p-8 text-center max-w-sm mx-4"
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

function ZoneCell({ c, active, cellRefs, onTap }) {
  const st = ZONE_STYLES[c.zone];
  const isActive = active === c.index;
  return (
    <button
      ref={(el) => (cellRefs.current[c.index] = el)}
      onClick={() => onTap(c.index)}
      data-testid={`grade-cell-${c.value}`}
      className={`relative w-full h-full rounded-2xl border-2 border-stone-900/10 flex flex-col items-center justify-center transition-all duration-150 ${
        isActive ? st.active : st.idle
      }`}
    >
      <span className="font-mono font-black text-4xl sm:text-6xl leading-none">{c.value}</span>
      <span className="font-mono font-bold text-xs sm:text-base opacity-50 mt-1">{c.alt}</span>
    </button>
  );
}
