import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import api from "../lib/api";
import GradebookModal from "../components/GradebookModal";

export default function GradebookPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [classInfo, setClassInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/classes/" + classId);
        if (!cancelled) setClassInfo(res.data);
      } catch (err) {
        if (!cancelled) setError("Notenstand konnte nicht geladen werden.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [classId]);

  const close = () => navigate("/", { replace: true });

  return (
    <div className="h-screen overflow-hidden bg-stone-50 bg-dots">
      {loading && (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
        </div>
      )}
      {error && !loading && (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="font-bold text-rose-700">{error}</p>
          <button onClick={close} className="rounded-xl border-2 border-stone-900 bg-white px-4 py-3 font-heading font-extrabold text-stone-900 shadow-brutal-sm">Klassenübersicht</button>
        </div>
      )}
      <GradebookModal
        open={!!classInfo && !loading}
        classId={classId}
        className={classInfo?.name || ""}
        onClose={close}
      />
    </div>
  );
}
