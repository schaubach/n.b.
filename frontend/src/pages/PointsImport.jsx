import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, FileUp, Loader2, UserPlus, X } from "lucide-react";
import api from "../lib/api";
import { importMail, inspectPointsImport, parsePointsImport } from "../lib/pointsImport";
import { evaluatePercent, normalizePointScale, pointsNeededForBetter } from "../lib/gradeScales";
import { gradeColorClasses, gradeTier } from "../lib/grades";

export default function PointsImport() {
  const { classId, sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const input = useRef(null);
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [scaleId, setScaleId] = useState("");
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newStudents, setNewStudents] = useState([]);
  const [addMail, setAddMail] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (sessionId) {
          const result = (await api.get(`/sessions/${sessionId}/points`)).data;
          if (result.session.entry_mode !== "csv_points") throw new Error("Diese Bewertung ist kein CSV-Import.");
          if (!active) return;
          setData(result);
          setRows(result.import_review || []);
          setScaleId(result.session.grade_scale_id);
        } else {
          const cls = (await api.get(`/classes/${classId}`)).data;
          const scales = (await api.get("/grade-scales")).data;
          const opts = location.state || {};
          if (opts.category !== "klausur" && opts.sl_type !== "written") throw new Error("Bitte den CSV-Import über eine neue schriftliche Bewertung starten.");
          if (!active) return;
          setData({ students: cls.students, grade_scales: scales, session: { ...opts, class_id: cls.id, class_name: cls.name, grade_system: cls.grade_system } });
          setScaleId(opts.grade_scale_id || cls.grade_scale_id || scales[0]?.id);
        }
      } catch (err) { if (active) setError(err.message || "Import konnte nicht geöffnet werden."); }
    })();
    return () => { active = false; };
  }, [classId, sessionId, location.state]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const checks = useMemo(() => inspectPointsImport(rows, data?.students || []), [rows, data]);
  const unresolved = checks.filter((check) => !check.ready).length;
  const accepted = checks.filter((check) => check.ready && !check.missing).length;
  const missing = checks.filter((check) => check.missing).length;
  const scale = useMemo(() => normalizePointScale(
    sessionId && data?.grade_scale?.id === scaleId ? data.grade_scale : data?.grade_scales?.find((item) => item.id === scaleId),
    data?.session.grade_system,
  ), [data, scaleId, sessionId]);

  const change = (index, values) => {
    setRows((current) => {
      const next = current.map((row, i) => i === index
        ? { ...row, ...values, decision: values.decision || "pending" }
        : values.maximum !== undefined && row.decision === "accept" ? { ...row, decision: "pending" } : row);
      const covered = new Set(next.map((row) => row.student_id));
      data.students.filter((student) => !student.inactive && !covered.has(student.id)).forEach((student) => next.push({
        key: `manual-missing-${student.id}-${next.length}`, line: null, mail: student.email || "", status: "Keine CSV-Zeile",
        student_id: student.id, achieved: "", maximum: "", decision: "pending", source_issues: ["Keine eindeutig zugeordnete CSV-Zeile für diese Person."],
      }));
      return next;
    });
    setDirty(true);
  };

  const readFile = async (file) => {
    if (!file || !data) return;
    if (dirty && !window.confirm("Bisherige Importprüfung durch diese Datei ersetzen?")) return;
    setError("");
    setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Die CSV-Datei darf höchstens 2 MB groß sein.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const originalStudents = data.students.filter((student) => !student.import_new);
      const parsed = parsePointsImport(text, originalStudents);
      setData((current) => ({ ...current, students: originalStudents }));
      setNewStudents([]);
      setRows(parsed);
      setFilename(file.name);
      setDirty(true);
    } catch (err) { setRows([]); setError(err.message || "Die Datei konnte nicht gelesen werden."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };

  const finish = async () => {
    if (unresolved || busy || !rows.length) return;
    if (sessionId && !window.confirm("Diese Bewertung neu berechnen? Manuell überschriebene Noten dieser Spalte werden durch die geprüften Importnoten ersetzt.")) return;
    if (!accepted && !window.confirm("Alle Zeilen bleiben ohne Note. Bewertung trotzdem speichern?")) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post("/sessions/import-points", {
        ...data.session, session_id: sessionId, grade_scale_id: scaleId, review: rows, new_students: newStudents,
      });
      setDirty(false);
      navigate(`/gradebook/${result.data.class_id}`, { replace: true });
    } catch (err) { setError(err?.response?.data?.detail || err.message || "Import konnte nicht gespeichert werden."); setBusy(false); }
  };

  const leave = () => {
    if (busy || (dirty && !window.confirm("Importprüfung ohne Übernahme verlassen?"))) return;
    navigate(sessionId ? `/gradebook/${data?.session.class_id}` : "/");
  };

  const addStudent = (first, last) => {
    const temporaryId = "import-" + Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const email = importMail(addMail);
    const student = { id: temporaryId, first_name: first.trim(), last_name: last.trim(), email, import_new: true };
    setNewStudents((current) => [...current, { ...student, temporary_id: temporaryId }]);
    setData((current) => ({ ...current, students: [...current.students, student].sort((a, b) => a.last_name.localeCompare(b.last_name, "de") || a.first_name.localeCompare(b.first_name, "de")) }));
    setRows((current) => current.map((row) => importMail(row.mail) === email ? { ...row, student_id: temporaryId, decision: "pending" } : row));
    setDirty(true);
    setAddMail(null);
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-stone-50 text-stone-900">
      <header className="grid grid-cols-[auto_minmax(0,1fr)] shrink-0 items-center gap-3 border-b-2 border-stone-200 bg-white p-4 sm:flex sm:flex-wrap">
        <button type="button" onClick={leave} disabled={busy} aria-label="Zurück" className="rounded-lg border-2 border-stone-900 p-2"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1"><h1 className="font-heading text-xl font-black">Punkteimport prüfen</h1><p className="break-words text-sm text-stone-600">{data?.session.class_name} · {data?.session.title}</p></div>
        <button type="button" onClick={finish} disabled={!data || !rows.length || unresolved > 0 || busy} className="col-span-2 flex items-center justify-center gap-2 rounded-lg border-2 border-stone-900 bg-stone-900 px-4 py-2 font-bold text-white disabled:opacity-40" data-testid="points-import-finish">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} {accepted} Noten übernehmen</button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-5">
        {error && <p role="alert" className="shrink-0 whitespace-pre-wrap rounded-lg border-2 border-rose-600 bg-rose-50 p-3 font-bold text-rose-900">{error}</p>}
        {!data && !error && <Loader2 className="h-8 w-8 animate-spin" />}
        {data && <>
          <div className="flex shrink-0 flex-wrap items-end gap-3">
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => readFile(event.target.files?.[0])} data-testid="points-import-file" />
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-lg border-2 border-stone-900 bg-white px-4 py-2 font-bold"><FileUp className="h-5 w-5" /> CSV auswählen</button>
            <label className="min-w-0"><span className="block text-xs font-bold text-stone-600">Notenschlüssel</span><select aria-label="Notenschlüssel" disabled={busy} value={scaleId} onChange={(event) => { setScaleId(event.target.value); setDirty(true); }} className="max-w-full rounded-lg border-2 border-stone-300 bg-white p-2">{data.grade_scales.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <span className="break-all text-sm text-stone-500">{filename}</span>
          </div>
          <div aria-live="polite" className={`shrink-0 rounded-lg border-2 px-3 py-2 font-bold ${unresolved ? "border-amber-500 bg-amber-50 text-amber-900" : "border-emerald-500 bg-emerald-50 text-emerald-900"}`}>
            {unresolved} offene Zeilen · {accepted} bestätigt · {missing} ohne Eintrag
            {newStudents.length > 0 && <span className="block text-sm">{newStudents.length} neue Lernende zur Aufnahme vorgemerkt</span>}
          </div>
          {sessionId && <p className="text-sm font-bold text-amber-900">Erneute Übernahme ersetzt die Noten dieser Spalte einschließlich manueller Überschreibungen.</p>}
          <div className="min-h-0 flex-1 overflow-auto border border-stone-300 bg-white">
            <table className="w-full min-w-[1100px] border-collapse text-sm" data-testid="points-import-table">
              <thead className="sticky top-0 z-10 bg-stone-900 text-white"><tr>{["Quelle / Mail", "Lernende", "Erreichte Punkte", "Maximale Punkte", "Notenvorschau", "Probleme / Hinweise", "Entscheidung"].map((title) => <th key={title} className="px-3 py-3 text-left">{title}</th>)}</tr></thead>
              <tbody>{rows.map((row, index) => {
                const check = checks[index];
                const evaluated = !check.missing && check.valid ? evaluatePercent(check.achieved / check.maximum * 100, scale, data.session.grade_system, data.session) : null;
                const grade = evaluated?.value || "";
                const better = evaluated ? pointsNeededForBetter(check.achieved, check.maximum, scale, evaluated.rowIndex, data.session.grade_system, data.session) : null;
                const near = better && better.points > 0 && better.points <= 1 && (data.session.grade_system === "points_0_15" || gradeTier(grade, data.session.grade_system) !== gradeTier(better.target, data.session.grade_system));
                const tone = check.missing ? "bg-stone-100" : check.errors.length ? "bg-rose-50" : check.issues.length || row.decision === "pending" ? "bg-amber-50" : "bg-white";
                return <tr key={row.key} className={`border-b-2 border-stone-200 align-top ${tone}`} data-testid={`points-import-row-${index}`}>
                  <td className="max-w-52 px-3 py-3"><span className="font-bold">{row.line ? `Zeile ${row.line}` : "Ohne CSV-Zeile"}</span><div className="break-all text-xs">{row.mail || "Mail fehlt"}</div><div className="mt-1 text-xs font-bold">{row.status || "Status fehlt"}</div></td>
                  <td className="px-2 py-3"><select disabled={busy} value={row.student_id} aria-label={`Lernende Zeile ${index + 1}`} onChange={(event) => change(index, { student_id: event.target.value })} className={`max-w-52 rounded border-2 bg-white p-2 ${!check.student ? "border-rose-500" : "border-stone-300"}`}><option value="">Nicht zugeordnet</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.last_name}, {student.first_name}{student.inactive ? " (inaktiv)" : ""}{student.import_new ? " (neu)" : ""}</option>)}</select>
                    {row.mail && !data.students.some((student) => importMail(student.email) === importMail(row.mail)) && <button type="button" disabled={busy} onClick={() => setAddMail(row.mail)} className="mt-2 flex items-center gap-1 rounded border border-stone-500 bg-white px-2 py-2 text-left text-xs font-bold"><UserPlus className="h-4 w-4 shrink-0" /> Lernende/n zufügen</button>}
                  </td>
                  <td className="px-2 py-3"><input disabled={busy} aria-label={`Erreichte Punkte Zeile ${index + 1}`} inputMode="decimal" value={row.achieved} onChange={(event) => change(index, { achieved: event.target.value })} className={`w-24 rounded border-2 bg-white p-2 font-mono ${!Number.isFinite(check.achieved) || check.achieved > check.maximum ? "border-rose-500" : "border-stone-300"}`} /></td>
                  <td className="px-2 py-3"><input disabled={busy} aria-label={`Maximale Punkte Zeile ${index + 1}`} inputMode="decimal" value={row.maximum} onChange={(event) => change(index, { maximum: event.target.value })} className={`w-24 rounded border-2 bg-white p-2 font-mono ${!(check.maximum > 0) || !Number.isFinite(check.maximum) ? "border-rose-500" : "border-stone-300"}`} /></td>
                  <td className="px-3 py-3">{grade ? <span className={`inline-block rounded-lg border-2 px-3 py-1 font-mono text-lg font-black ${gradeColorClasses(grade, data.session.grade_system)}`}>{grade}</span> : <span className="text-stone-500">Keine Note</span>}
                    {better && <div data-testid={`points-import-better-${index}`} className={`mt-2 w-max max-w-40 rounded px-2 py-1 text-xs font-black ${near ? "bg-amber-300 text-stone-900 ring-2 ring-stone-900" : "bg-stone-100 text-stone-600"}`}>{String(better.points).replace(".", ",")} P. bis {better.target}</div>}
                  </td>
                  <td className="min-w-60 max-w-sm px-3 py-3">{check.issues.length ? <ul className="space-y-1">{check.issues.map((issue, i) => <li key={i} className={`flex gap-1 text-xs font-semibold ${i < check.errors.length && !check.missing ? "text-rose-800" : "text-amber-900"}`}><AlertTriangle className="h-4 w-4 shrink-0" /><span className="[overflow-wrap:anywhere]">{issue}</span></li>)}</ul> : <span className="text-emerald-800">Keine Probleme erkannt</span>}</td>
                  <td className="px-2 py-3"><select disabled={busy} aria-label={`Entscheidung Zeile ${index + 1}`} value={row.decision} onChange={(event) => change(index, { decision: event.target.value })} className={`rounded border-2 bg-white p-2 font-bold ${row.decision === "pending" ? "border-amber-500" : check.missing ? "border-stone-400" : "border-emerald-500"}`}><option value="pending">Noch prüfen</option><option value="accept" disabled={!check.valid}>Bestätigt</option><option value="missing">Ohne Eintrag</option></select></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </>}
      </main>
      {addMail !== null && <AddImportStudent mail={addMail} onClose={() => setAddMail(null)} onAdd={addStudent} />}
    </div>
  );
}

function AddImportStudent({ mail, onClose, onAdd }) {
  const ref = useRef(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const validMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(importMail(mail));
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="add-import-student-title" className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-lg border-2 border-stone-900 bg-white p-5 backdrop:bg-stone-900/40">
    <form onSubmit={(event) => { event.preventDefault(); if (first.trim() && last.trim() && validMail) onAdd(first, last); }}>
      <div className="flex items-center justify-between gap-2"><h2 id="add-import-student-title" className="text-xl font-black">Lernende/n zufügen</h2><button type="button" onClick={onClose} aria-label="Schließen"><X className="h-5 w-5" /></button></div>
      <p className="my-3 break-all text-sm">{mail}</p>
      {!validMail && <p role="alert" className="mb-3 font-bold text-rose-800">Diese Mailadresse ist ungültig. Bitte die Quelldatei korrigieren.</p>}
      <label className="block font-bold">Vorname<input autoFocus required maxLength={100} value={first} onChange={(event) => setFirst(event.target.value)} className="mb-3 mt-1 w-full rounded border-2 border-stone-300 p-2 font-normal" /></label>
      <label className="block font-bold">Nachname<input required maxLength={100} value={last} onChange={(event) => setLast(event.target.value)} className="mb-3 mt-1 w-full rounded border-2 border-stone-300 p-2 font-normal" /></label>
      <button type="submit" disabled={!first.trim() || !last.trim() || !validMail} className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 p-3 font-bold text-white disabled:opacity-40"><UserPlus className="h-5 w-5" /> Zur Aufnahme vormerken</button>
    </form>
  </dialog>;
}
