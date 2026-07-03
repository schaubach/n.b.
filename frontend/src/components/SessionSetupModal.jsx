import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, ClipboardList } from "lucide-react";

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isoToDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Modal shown before starting a grading round. Pre-filled with defaults so the
// teacher can simply hit "Bewertung starten".
export default function SessionSetupModal({ open, className, category = "sonstige", onStart, onClose }) {
  const isKlausur = category === "klausur";
  const defaultName = isKlausur ? "Klausur" : "mündliche Mitarbeit";
  const [title, setTitle] = useState(defaultName);
  const [weight, setWeight] = useState("1");
  const [date, setDate] = useState(todayISO());

  useEffect(() => {
    if (open) {
      setTitle(isKlausur ? "Klausur" : "mündliche Mitarbeit");
      setWeight("1");
      setDate(todayISO());
    }
  }, [open, isKlausur]);

  const start = () => {
    const w = parseFloat(String(weight).replace(",", ".")) || 1;
    onStart({
      title: title.trim() || defaultName,
      weight: w,
      date: isoToDE(date),
      category,
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          data-testid="session-setup-modal"
        >
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="relative w-full max-w-md bg-white border-2 border-stone-900 rounded-3xl shadow-brutal p-6 sm:p-8"
          >
            <button
              onClick={onClose}
              data-testid="setup-close"
              className="absolute top-4 right-4 text-stone-400 hover:text-stone-900 transition-colors"
              aria-label="Schließen"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-emerald-400 border-2 border-stone-900 flex items-center justify-center shadow-brutal-sm">
                <ClipboardList className="w-6 h-6 text-stone-900" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">
                  {isKlausur ? "Neue Klausur" : "Neue sonstige Leistung"}
                </p>
                <h3 className="font-heading text-2xl font-black text-stone-900 leading-none">{className}</h3>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-bold text-stone-700">Name</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  data-testid="setup-name-input"
                  className="mt-1 w-full px-4 py-3 rounded-xl border-2 border-stone-300 focus:border-stone-900 outline-none font-medium text-stone-900"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-stone-700">Gewichtung</span>
                  <input
                    type="number" min="0" step="0.5"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    data-testid="setup-weight-input"
                    className="mt-1 w-full px-4 py-3 rounded-xl border-2 border-stone-300 focus:border-stone-900 outline-none font-mono font-bold text-stone-900"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-stone-700">Datum</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    data-testid="setup-date-input"
                    className="mt-1 w-full px-4 py-3 rounded-xl border-2 border-stone-300 focus:border-stone-900 outline-none font-medium text-stone-900"
                  />
                </label>
              </div>
            </div>

            <button
              onClick={start}
              data-testid="setup-start-button"
              className="mt-6 w-full px-5 py-4 bg-stone-900 text-white font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5" /> Bewertung starten
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
