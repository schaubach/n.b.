import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";

const VARIANTS = {
  primary: "bg-stone-900 text-white border-stone-900",
  danger: "bg-rose-500 text-white border-stone-900",
  success: "bg-emerald-400 text-stone-900 border-stone-900",
  ghost: "bg-white text-stone-700 border-stone-300",
};

// Reusable in-app confirmation modal (works inside sandboxed iframes,
// unlike window.confirm which browsers block there).
export default function ConfirmModal({ open, title, description, actions = [], onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          data-testid="confirm-modal"
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
              data-testid="confirm-modal-close"
              className="absolute top-4 right-4 text-stone-400 hover:text-stone-900 transition-colors"
              aria-label="Schließen"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 shrink-0 rounded-2xl bg-amber-300 border-2 border-stone-900 flex items-center justify-center shadow-brutal-sm">
                <AlertTriangle className="w-6 h-6 text-stone-900" />
              </div>
              <div className="min-w-0">
                <h3 className="font-heading text-2xl font-black text-stone-900 leading-tight">{title}</h3>
                {description && <p className="mt-2 text-stone-600 font-medium">{description}</p>}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              {actions.map((a) => (
                <button
                  key={a.key || a.label}
                  onClick={a.onClick}
                  data-testid={a.testid}
                  className={`w-full px-5 py-3.5 font-heading font-extrabold rounded-2xl border-2 shadow-brutal-sm hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all ${VARIANTS[a.variant] || VARIANTS.primary}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
