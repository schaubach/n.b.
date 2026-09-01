import api from "./api";
import { APP_VERSION } from "../generated/appVersion";

const BASE = `${process.env.PUBLIC_URL || "."}/notenskala`;

function validFilename(name) {
  return typeof name === "string" && /\.csv$/i.test(name) && !name.includes("/") && !name.includes("\\");
}

async function readResponse(response, type, message) {
  if (!response?.ok) throw new Error(`${message} (HTTP ${response?.status || "?"}).`);
  return response[type]();
}

export async function syncBundledGradeScales() {
  const version = String(APP_VERSION?.version || "").trim();
  if (!version) return { changed: false, skipped: true };
  const status = await api.get("/grade-scales/bundled-version");
  if (status.data?.version === version) return { changed: false, skipped: true };

  const indexResponse = await fetch(`${BASE}/index.json`, { cache: "no-store", credentials: "same-origin" });
  const index = await readResponse(indexResponse, "json", "Notenskalen-Index konnte nicht geladen werden");
  const files = Array.isArray(index) ? index.filter(validFilename) : [];
  if (!files.length) throw new Error("Im Notenskalen-Index sind keine CSV-Dateien eingetragen.");
  const scales = await Promise.all(files.map(async (filename) => {
    const response = await fetch(`${BASE}/${encodeURIComponent(filename)}`, { cache: "no-store", credentials: "same-origin" });
    const csv = await readResponse(response, "text", `Notenskala ${filename} konnte nicht geladen werden`);
    return { name: filename.replace(/\.csv$/i, ""), csv };
  }));
  const result = await api.post("/grade-scales/sync-bundled", { version, scales });
  return result.data;
}
