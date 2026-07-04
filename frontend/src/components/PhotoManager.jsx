import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import api from "../lib/api";
import { initials } from "../lib/grades";

function dataUrlFromImage(file, maxSize = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(drawToDataUrl(img, maxSize, quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Foto konnte nicht gelesen werden."));
    };
    img.src = url;
  });
}

function drawToDataUrl(source, maxSize = 900, quality = 0.82) {
  const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
  const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
  if (!sourceWidth || !sourceHeight) throw new Error("Kamerabild ist noch nicht bereit.");
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export default function PhotoManager({ classId, className, open, onClose, onChanged }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [target, setTarget] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const load = async () => {
    if (!classId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/classes/${classId}`);
      setStudents(res.data.students || []);
    } catch (err) {
      setError("Klasse konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  };

  useEffect(() => {
    if (open) load();
    if (!open) stopCamera();
    return () => stopCamera();
  }, [open, classId]);

  const savePhoto = async (student, photo) => {
    setBusyId(student.id);
    setError(null);
    try {
      await api.put(`/students/${student.id}/photo`, { photo });
      setStudents((items) => items.map((item) => item.id === student.id ? { ...item, photo } : item));
      onChanged?.();
    } catch (err) {
      setError(err.message || "Foto konnte nicht gespeichert werden.");
    } finally {
      setBusyId(null);
    }
  };

  const openFileFallback = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const choosePhoto = async (student) => {
    setTarget(student);
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      openFileFallback();
      return;
    }

    setBusyId(student.id);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        }
      }, 0);
    } catch (err) {
      setError("Kamera konnte nicht geöffnet werden. Du kannst stattdessen ein Bild auswählen.");
      openFileFallback();
    } finally {
      setBusyId(null);
    }
  };

  const capturePhoto = async () => {
    if (!target || !videoRef.current) return;
    try {
      const photo = drawToDataUrl(videoRef.current);
      stopCamera();
      await savePhoto(target, photo);
      setTarget(null);
    } catch (err) {
      setError(err.message || "Foto konnte nicht aufgenommen werden.");
    }
  };

  const cancelCamera = () => {
    stopCamera();
    setTarget(null);
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !target) return;
    setBusyId(target.id);
    setError(null);
    try {
      const photo = await dataUrlFromImage(file);
      await savePhoto(target, photo);
    } catch (err) {
      setError(err.message || "Foto konnte nicht gespeichert werden.");
    } finally {
      setBusyId(null);
      setTarget(null);
    }
  };

  const removePhoto = async (student) => {
    setBusyId(student.id);
    setError(null);
    try {
      await api.delete(`/students/${student.id}/photo`);
      setStudents((items) => items.map((item) => item.id === student.id ? { ...item, photo: null } : item));
      onChanged?.();
    } catch (err) {
      setError("Foto konnte nicht entfernt werden.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-5"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          data-testid="photo-manager"
        >
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
            className="relative w-full max-w-5xl max-h-[92vh] overflow-hidden bg-stone-50 border-2 border-stone-900 rounded-t-3xl sm:rounded-3xl shadow-brutal flex flex-col"
          >
            <header className="px-5 py-4 bg-white border-b-2 border-stone-900 flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-stone-900 text-white flex items-center justify-center">
                <Camera className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Fotos zuordnen</p>
                <h2 className="font-heading text-xl sm:text-2xl font-black text-stone-900 truncate">{className}</h2>
              </div>
              <button onClick={onClose} className="text-stone-400 hover:text-stone-900" aria-label="Schliessen">
                <X className="w-6 h-6" />
              </button>
            </header>

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFile}
            />

            {error && <p className="mx-5 mt-4 rounded-2xl bg-rose-100 border-2 border-rose-300 px-4 py-3 text-rose-900 font-bold">{error}</p>}

            <div className="overflow-auto p-5">
              {loading ? (
                <div className="h-48 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-stone-400" /></div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {students.map((student) => (
                    <div key={student.id} className="rounded-2xl border-2 border-stone-900 bg-white p-4 shadow-brutal-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-20 rounded-2xl border-2 border-stone-900 overflow-hidden bg-stone-200 shrink-0">
                          {student.photo ? (
                            <img src={student.photo} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-heading font-black text-2xl text-stone-400">
                              {initials(student.first_name, student.last_name)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-stone-900 truncate">{student.first_name}</p>
                          <p className="font-heading font-black text-stone-900 truncate">{student.last_name}</p>
                          <p className="text-xs font-bold text-stone-400 mt-1">{student.photo ? "Foto gespeichert" : "Noch kein Foto"}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => choosePhoto(student)}
                          disabled={busyId === student.id}
                          data-testid={`student-photo-${student.id}`}
                          className="flex-1 px-3 py-2.5 rounded-xl border-2 border-stone-900 bg-emerald-400 text-stone-900 font-heading font-extrabold shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                        >
                          {busyId === student.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                          Foto
                        </button>
                        {student.photo && (
                          <button
                            onClick={() => removePhoto(student)}
                            disabled={busyId === student.id}
                            className="px-3 py-2.5 rounded-xl border-2 border-rose-300 bg-white text-rose-600 font-bold active:scale-[0.98] transition-all"
                            aria-label="Foto entfernen"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          <AnimatePresence>
            {cameraOpen && target && (
              <motion.div
                className="absolute inset-0 z-[120] flex items-center justify-center bg-stone-950/90 p-4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                data-testid="camera-capture"
              >
                <div className="w-full max-w-2xl overflow-hidden rounded-3xl border-2 border-white bg-stone-900 shadow-brutal">
                  <div className="aspect-[3/4] sm:aspect-video bg-black">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  </div>
                  <div className="bg-white p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-400">Foto fuer</p>
                      <p className="font-heading font-black text-stone-900 truncate">{target.first_name} {target.last_name}</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={cancelCamera}
                        className="flex-1 sm:flex-none px-4 py-3 rounded-xl border-2 border-stone-300 bg-white text-stone-700 font-bold"
                      >
                        Abbrechen
                      </button>
                      <button
                        onClick={capturePhoto}
                        className="flex-1 sm:flex-none px-5 py-3 rounded-xl border-2 border-stone-900 bg-emerald-400 text-stone-900 font-heading font-extrabold shadow-brutal-sm active:translate-y-0.5 active:shadow-none transition-all flex items-center justify-center gap-2"
                      >
                        <Camera className="w-5 h-5" /> Aufnehmen
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
