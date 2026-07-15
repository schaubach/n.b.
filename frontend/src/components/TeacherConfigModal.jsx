import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Download, KeyRound, Loader2, Mail, RefreshCw, Save, Upload, UserRound, X } from "lucide-react";
import api from "../lib/api";
import { checkMailBackendHealth } from "../lib/mailBackend";
import { importEncryptedBackup, sendBackupToTeacher } from "../lib/backup";
import { checkAppUpdate, forceAppUpdate, formatVersion } from "../lib/appUpdate";

export default function TeacherConfigModal({ open, onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mailBackendHost, setMailBackendHost] = useState("");
  const [backupIntervalDays, setBackupIntervalDays] = useState(7);
  const [mailBackendPreSharedKey, setMailBackendPreSharedKey] = useState("");
  const [backendIdentityPublicKey, setBackendIdentityPublicKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backendCheck, setBackendCheck] = useState({ status: "idle", message: "" });
  const [backupBusy, setBackupBusy] = useState(false);
  const [updateCheck, setUpdateCheck] = useState({ status: "idle", available: false, message: "Version noch nicht geprüft.", local: null, remote: null });
  const [updateBusy, setUpdateBusy] = useState(false);

  const teacherConfigPayload = () => ({
    name,
    email,
    password,
    mail_backend_host: mailBackendHost,
    backup_interval_days: Math.min(365, Math.max(1, Number.parseInt(backupIntervalDays, 10) || 7)),
    mail_backend_pre_shared_key: mailBackendPreSharedKey,
    backend_identity_public_key: backendIdentityPublicKey,
  });

  const errorText = (err, fallback) => err?.response?.data?.detail || err?.message || fallback;
  const firstText = (...values) => values.find((value) => typeof value === "string" && value.trim())?.trim() || "";

  const credentialsFromJson = (data) => {
    const teacher = data.teacher || data.teacherConfig || data.lehrendenkonfiguration || {};
    return {
      name: firstText(data.name, data.teacher_name, data.teacherName, teacher.name),
      email: firstText(data.email, data.mail, data.accountMail, data.accountmail, data.teacher_email, teacher.email, teacher.mail),
      password: firstText(data.password, data.iservPassword, data.iserv_passwort, data.IServPasswort, teacher.password, teacher.iservPassword),
      mailBackendHost: firstText(data.mail_backend_host, data.mailBackendHost, data.serverName, data.host, teacher.mail_backend_host, teacher.mailBackendHost),
      backupIntervalDays: data.backup_interval_days ?? data.backupIntervalDays ?? teacher.backup_interval_days ?? teacher.backupIntervalDays,
      preSharedKey: firstText(data.preSharedKey, data.mail_backend_pre_shared_key, data.NB_MAIL_PSK, data.nbMailPsk, data.psk),
      publicKey: firstText(data.backendIdentityPublicKey, data.backend_identity_public_key, data.publicKey, data.backendPublicKey),
    };
  };

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
        setBackupIntervalDays(res.data.backup_interval_days || 7);
        setMailBackendPreSharedKey(res.data.mail_backend_pre_shared_key || "");
        setBackendIdentityPublicKey(res.data.backend_identity_public_key || "");
      })
      .catch(() => setError("Lehrendenkonfiguration konnte nicht geladen werden."))
      .finally(() => setLoading(false));
  }, [open]);

  const checkForUpdate = async () => {
    setUpdateCheck((current) => ({ ...current, status: "checking", message: "Version wird geprüft..." }));
    try {
      const result = await checkAppUpdate();
      setUpdateCheck({
        status: result.available ? "available" : "current",
        available: result.available,
        local: result.local,
        remote: result.remote,
        message: result.available ? "Auf dem Server ist eine neue WebApp-Version verfügbar." : "Diese WebApp ist aktuell.",
      });
    } catch (err) {
      setUpdateCheck((current) => ({ ...current, status: "error", available: false, message: err?.message || "Versionsprüfung nicht möglich." }));
    }
  };

  useEffect(() => {
    if (!open) return;
    checkForUpdate();
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


  const runAppUpdate = async () => {
    setUpdateBusy(true);
    setMessage("");
    setError("");
    setUpdateCheck((current) => ({ ...current, status: "updating", message: "Neue Version wird geladen..." }));
    try {
      await forceAppUpdate();
    } catch (err) {
      setUpdateCheck((current) => ({ ...current, status: "error", available: true, message: err?.message || "Update konnte nicht durchgeführt werden." }));
      setError(errorText(err, "Update konnte nicht durchgeführt werden."));
      setUpdateBusy(false);
    }
  };

  const runBackup = async () => {
    setBackupBusy(true);
    setMessage("");
    setError("");
    try {
      await api.post("/teacher-config", teacherConfigPayload());
      await sendBackupToTeacher({ download: true });
      setMessage("Backup wurde erstellt, heruntergeladen und an die Lehrendenadresse gesendet.");
    } catch (err) {
      setError(errorText(err, "Backup konnte nicht erstellt werden."));
    } finally {
      setBackupBusy(false);
    }
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!window.confirm("Backup importieren? Der aktuelle lokale Datenbestand wird ersetzt.")) return;
    setBackupBusy(true);
    setMessage("");
    setError("");
    try {
      await importEncryptedBackup(file);
      setMessage("Backup wurde importiert. Die App wird neu geladen.");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setError(errorText(err, "Backup konnte nicht importiert werden."));
    } finally {
      setBackupBusy(false);
    }
  };

  const importCredentials = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const parsed = credentialsFromJson(JSON.parse(await file.text()));
      const nextName = parsed.name || name;
      const nextEmail = parsed.email || email;
      const nextPassword = parsed.password || password;
      const nextHost = parsed.mailBackendHost || mailBackendHost;
      const nextInterval = parsed.backupIntervalDays || backupIntervalDays;
      const nextPreSharedKey = parsed.preSharedKey || mailBackendPreSharedKey;
      const nextPublicKey = parsed.publicKey || backendIdentityPublicKey;
      if (!parsed.name && !parsed.email && !parsed.password && !parsed.mailBackendHost && !parsed.preSharedKey && !parsed.publicKey) {
        throw new Error("Die Datei enthaelt keine erkannten Credentials.");
      }
      const payload = {
        name: nextName,
        email: nextEmail,
        password: nextPassword,
        mail_backend_host: nextHost,
        backup_interval_days: nextInterval,
        mail_backend_pre_shared_key: nextPreSharedKey,
        backend_identity_public_key: nextPublicKey,
      };
      const saved = await api.post("/teacher-config", payload);
      setName(saved.data.name || "");
      setEmail(saved.data.email || "");
      setPassword(nextPassword);
      setMailBackendHost(saved.data.mail_backend_host || "");
      setBackupIntervalDays(saved.data.backup_interval_days || 7);
      setMailBackendPreSharedKey(saved.data.mail_backend_pre_shared_key || "");
      setBackendIdentityPublicKey(saved.data.backend_identity_public_key || "");
      setMessage("Credentials wurden geladen und gespeichert.");
    } catch (err) {
      setError(errorText(err, "Credentials konnten nicht geladen werden."));
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await api.post("/teacher-config", teacherConfigPayload());
      setBackupIntervalDays(saved.data.backup_interval_days || 7);
      setMessage("Lehrendenkonfiguration gespeichert.");
    } catch (err) {
      setError(errorText(err, "Lehrendenkonfiguration konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="teacher-config-modal">
          <div className="absolute inset-0 bg-stone-900/45 backdrop-blur-sm" onClick={onClose} />
          <motion.form initial={{ scale: 0.92, y: 18, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} onSubmit={submit} className="relative my-3 max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl border-2 border-stone-900 bg-white p-5 shadow-brutal sm:my-4 sm:max-h-[calc(100dvh-2rem)] sm:p-8">
            <button type="button" onClick={onClose} className="absolute right-4 top-4 text-stone-400 hover:text-stone-900" aria-label="Schließen">
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-stone-900 bg-white text-stone-900 shadow-brutal-sm">
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
                  <label className="block">
                    <span className="text-sm font-bold text-stone-700">Automatisches Backup alle</span>
                    <div className="mt-1 flex items-center gap-3">
                      <input type="number" min="1" max="365" step="1" value={backupIntervalDays} onChange={(event) => setBackupIntervalDays(event.target.value)} className="w-28 rounded-xl border-2 border-stone-300 px-4 py-3 font-bold text-stone-900 outline-none focus:border-stone-900" />
                      <span className="text-sm font-bold text-stone-700">Tage</span>
                    </div>
                    <span className="mt-1 block text-xs font-bold text-stone-500">Geprüft wird beim Öffnen bzw. Entsperren der App.</span>
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

                <div className="mt-5 rounded-2xl border-2 border-stone-200 bg-stone-50 px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">WebApp-Version</p>
                      <p className={"mt-1 text-sm font-black " + (updateCheck.available ? "text-amber-800" : updateCheck.status === "error" ? "text-rose-800" : "text-stone-700")}>{updateCheck.message}</p>
                      <p className="mt-1 text-xs font-bold text-stone-500">Lokal: {formatVersion(updateCheck.local)}</p>
                      {updateCheck.remote && <p className="text-xs font-bold text-stone-500">Server: {formatVersion(updateCheck.remote)}</p>}
                      <p className="mt-1 text-xs font-bold text-stone-500">Lokale Noten, Fotos und Konfiguration in IndexedDB bleiben beim Update erhalten.</p>
                    </div>
                    <button type="button" onClick={updateCheck.available ? runAppUpdate : checkForUpdate} disabled={updateBusy || updateCheck.status === "checking" || updateCheck.status === "updating"} className={"flex shrink-0 items-center justify-center gap-2 rounded-2xl border-2 px-5 py-3 font-heading font-extrabold shadow-brutal-sm disabled:opacity-50 " + (updateCheck.available ? "border-stone-900 bg-amber-300 text-stone-900" : "border-stone-900 bg-white text-stone-900")}>
                      {(updateBusy || updateCheck.status === "checking" || updateCheck.status === "updating") ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
                      {updateCheck.available ? "Neue Version" : updateCheck.status === "current" ? "Aktuell" : "Version prüfen"}
                    </button>
                  </div>
                </div>

                <div className="mt-5">
                  <label className={(saving || backupBusy ? "pointer-events-none opacity-50" : "cursor-pointer") + " flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-white px-5 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm"}>
                    <KeyRound className="h-5 w-5" />
                    Credentials laden
                    <input type="file" accept=".json,application/json" onChange={importCredentials} disabled={saving || backupBusy} className="hidden" />
                  </label>
                  {(mailBackendPreSharedKey && backendIdentityPublicKey) && <p className="mt-2 text-xs font-bold text-emerald-700">Backend-Credentials lokal geladen.</p>}
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={runBackup} disabled={backupBusy || saving} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-white px-5 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm disabled:opacity-50">
                    {backupBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                    Backup
                  </button>
                  <label className={"flex items-center justify-center gap-2 rounded-2xl border-2 border-stone-900 bg-white px-5 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm " + (backupBusy ? "pointer-events-none opacity-50" : "cursor-pointer")}>
                    <Upload className="h-5 w-5" />
                    Import Backup
                    <input type="file" onChange={importBackup} disabled={backupBusy} className="hidden" />
                  </label>
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
