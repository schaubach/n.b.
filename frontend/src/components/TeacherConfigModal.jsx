import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2, Mail, Save, UserRound, X } from "lucide-react";
import api from "../lib/api";
import { checkMailBackendHealth } from "../lib/mailBackend";

export default function TeacherConfigModal({ open, onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mailBackendHost, setMailBackendHost] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backendCheck, setBackendCheck] = useState({ status: "idle", message: "" });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMessage("");
    setError("");
    api.get("/teacher-config")
      .then((res) => {
        setName(res.data.name || "");
        setEmail(res.data.email || "");
        setPassword(res.data.password || "");
        setMailBackendHost(res.data.mail_backend_host || "");
      })
      .catch(() => setError("Lehrendenkonfiguration konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || loading) return undefined;
    const host = mailBackendHost.trim();
    if (!host) {
      setBackendCheck({ status: "idle", message: "" });
      return undefined;
    }
    let cancelled = false;
    setBackendCheck({ status: "checking", message: "Mail-Backend wird geprüft..." });
    const timer = window.setTimeout(() => {
      checkMailBackendHealth(host).then((result) => {
        if (!cancelled) setBackendCheck({ status: result.ok ? "ok" : "error", message: result.message });
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, loading, mailBackendHost]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.post("/teacher-config", { name, email, password, mail_backend_host: mailBackendHost });
      setMessage("Lehrendenkonfiguration gespeichert.");
    } catch (err) {
      setError("Lehrendenkonfiguration konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[130] flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="teacher-config-modal">
          <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onClose} />
          <motion.form initial={{ scale: 0.92, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} onSubmit={submit} className="relative w-full max-w-lg rounded-3xl border-2 border-stone-900 bg-white p-6 shadow-brutal sm:p-8">
            <button type="button" onClick={onClose} className="absolute right-4 top-4 text-stone-400 hover:text-stone-900" aria-label="Schließen">
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-stone-900 bg-stone-900 text-white shadow-brutal-sm">
                <Mail className="h-5 w-5" />
                <UserRound className="-ml-1 h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400">Lehrendenkonfiguration</p>
                <h2 className="font-heading text-2xl font-black text-stone-900">Mailversand</h2>
              </div>
            </div>

            {loading ? (
              <div className="mt-8 flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-stone-400" /></div>
            ) : (
              <>
                <div className="mt-6 space-y-4">
                  <label className="block">
                    <span className="text-sm font-bold text-stone-700">Name inkl. Bezeichnung</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} placeholder="z.B. Max Mustermann, StR" className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold text-stone-700">Mailadresse</span>
                    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vorname.nachname@rbbk-do.de" className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold text-stone-700">IServPasswort</span>
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-bold text-stone-700">IP-Adresse Mail-Backend</span>
                    <input value={mailBackendHost} onChange={(event) => setMailBackendHost(event.target.value)} placeholder="10.97.x.x" className="mt-1 w-full rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900" />
                    <span className="mt-1 block text-xs font-bold text-stone-500">Port 8123 und HTTPS werden automatisch verwendet.</span>
                  </label>
                </div>

                {backendCheck.status !== "idle" && (
                  <div className={"mt-5 flex items-start gap-3 rounded-2xl border-2 px-4 py-3 text-sm font-bold " + (backendCheck.status === "ok" ? "border-emerald-300 bg-emerald-100 text-emerald-900" : backendCheck.status === "checking" ? "border-stone-300 bg-stone-100 text-stone-700" : "border-rose-300 bg-rose-100 text-rose-900")}>
                    {backendCheck.status === "checking" ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" /> : backendCheck.status === "ok" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
                    <span>{backendCheck.message}</span>
                  </div>
                )}

                <div className="mt-5 rounded-2xl border-2 border-amber-300 bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950">
                  SMTP: rbbk-do.de, Port 587, STARTTLS. Der Versand läuft über das lokale Mail-Backend im Schulnetz und wird per HTTPS sowie HMAC-Signatur abgesichert.
                </div>

                {message && <p className="mt-4 rounded-xl border-2 border-emerald-300 bg-emerald-100 px-4 py-3 font-bold text-emerald-900">{message}</p>}
                {error && <p className="mt-4 rounded-xl border-2 border-rose-300 bg-rose-100 px-4 py-3 font-bold text-rose-900">{error}</p>}

                <button type="submit" disabled={saving} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-stone-900 px-5 py-4 font-heading font-extrabold text-white shadow-brutal-sm active:translate-y-0.5 active:shadow-none disabled:opacity-50">
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                  Speichern
                </button>
              </>
            )}
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
