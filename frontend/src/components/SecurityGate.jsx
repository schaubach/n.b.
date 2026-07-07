import React, { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { createVault, hasVault, unlockVault } from "../lib/cryptoStore";
import { maybeSendAutomaticBackup } from "../lib/backup";

export default function SecurityGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setConfigured(await hasVault());
      setChecking(false);
    })();
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (configured) {
        await unlockVault(password);
      } else {
        if (password !== repeat) throw new Error("Die Passwoerter stimmen nicht ueberein.");
        await createVault(password);
        setConfigured(true);
      }
      setReady(true);
      maybeSendAutomaticBackup().catch(() => {});
      setPassword("");
      setRepeat("");
    } catch (err) {
      setError(err.message || "Entsperren fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (ready) return children;

  return (
    <div className="min-h-screen bg-stone-50 bg-dots flex items-center justify-center px-5 py-10">
      <main className="w-full max-w-md rounded-3xl border-2 border-stone-900 bg-white p-6 sm:p-8 shadow-brutal">
        <div className="flex items-center gap-3">
          <img src={process.env.PUBLIC_URL + "/logo.jpeg"} alt="n.b." className="w-12 h-12 rounded-2xl border-2 border-stone-900 object-cover shadow-brutal-sm" />
          <div>
            <h1 className="font-heading text-3xl font-black text-stone-900 leading-none">n.b.</h1>
            <p className="text-sm font-bold text-stone-400 uppercase tracking-[0.16em] mt-1">
              {configured ? "Tresor entsperren" : "Tresor einrichten"}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border-2 border-emerald-900/10 bg-emerald-50 p-4 flex gap-3 text-emerald-950">
          <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm font-medium leading-relaxed">
            Klassen, Fotos und Noten werden nur lokal gespeichert und vor dem Speichern verschluesselt.
          </p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-stone-700">Passwort</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={configured ? "current-password" : "new-password"}
              className="mt-1 w-full rounded-2xl border-2 border-stone-900 bg-stone-50 px-4 py-3 font-bold text-stone-900 outline-none focus:ring-4 focus:ring-emerald-300"
              minLength={8}
              required
            />
          </label>

          {!configured && (
            <label className="block">
              <span className="text-sm font-bold text-stone-700">Passwort wiederholen</span>
              <input
                type="password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-2xl border-2 border-stone-900 bg-stone-50 px-4 py-3 font-bold text-stone-900 outline-none focus:ring-4 focus:ring-emerald-300"
                minLength={8}
                required
              />
            </label>
          )}

          {error && (
            <p className="rounded-2xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-4 bg-stone-900 text-white font-heading font-extrabold rounded-2xl border-2 border-stone-900 shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
            {configured ? "Entsperren" : "Lokalen Tresor erstellen"}
          </button>
        </form>
      </main>
    </div>
  );
}
