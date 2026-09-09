import React, { useEffect, useState } from "react";

export default function OfflineStatus() {
  const [status, setStatus] = useState({ ok: false, message: "Offline-Verfuegbarkeit wird geprueft..." });
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      const publish = (value) => { if (!disposed && current === generation) setStatus(value); };
      if (!("serviceWorker" in navigator)) {
        publish({ ok: false, message: "Offline-Start nicht verfuegbar. Bitte die App ueber vertrauenswuerdiges HTTPS oeffnen." });
        return;
      }
      const worker = navigator.serviceWorker.controller;
      if (!worker) {
        publish({ ok: false, message: "Offline-Installation noch nicht abgeschlossen. Im Schulnetz geoeffnet lassen." });
        return;
      }
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        publish({ ok: false, message: "Offline-Status nicht bestaetigt. Bitte im Schulnetz die App aktualisieren." });
      }, 5000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer);
        channel.port1.close();
        publish({ ok: data.ok, message: data.ok
          ? "Offline bereit: App-Start und lokale Funktionen sind gespeichert."
          : "Offline-Paket unvollstaendig. Bitte im Schulnetz aktualisieren." });
      };
      worker.postMessage({ type: "NB_OFFLINE_STATUS" }, [channel.port2]);
    };
    refresh();
    navigator.serviceWorker?.addEventListener("controllerchange", refresh);
    window.addEventListener("nb-offline-ready", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      navigator.serviceWorker?.removeEventListener("controllerchange", refresh);
      window.removeEventListener("nb-offline-ready", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return <p role="status" className={"mt-4 text-sm font-bold " + (status.ok ? "text-emerald-800" : "text-amber-800")}>{status.message}</p>;
}
