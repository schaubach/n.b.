import api from "./api";

export function classFileName(className, dateLabel) {
  const name = (className || "Klasse").replace(/\s+/g, "_");
  const date = (dateLabel || new Date().toLocaleDateString("de-DE")).replace(/\./g, "-");
  return `${name}_alle_Bewertungen_${date}.csv`;
}

export async function getClassCsvFile(classId, className) {
  const res = await api.get(`/classes/${classId}/export.csv`, { responseType: "blob" });
  return new File([res.data], classFileName(className), { type: "text/csv" });
}

export function triggerDownload(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function canShareFiles() {
  try {
    const f = new File(["x"], "t.csv", { type: "text/csv" });
    return !!(navigator.canShare && navigator.canShare({ files: [f] }));
  } catch (e) {
    return false;
  }
}

export async function deleteClassSessions(classId) {
  await api.delete(`/classes/${classId}/sessions`);
}

// Download the aggregated CSV, then delete all collected gradings.
export async function exportAndDelete(classId, className) {
  const file = await getClassCsvFile(classId, className);
  triggerDownload(file);
  await deleteClassSessions(classId);
}

// Share the aggregated CSV via the OS share sheet, then delete.
// Returns false if the user cancelled the share (nothing deleted).
export async function shareAndDelete(classId, className) {
  const file = await getClassCsvFile(classId, className);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      if (e && e.name === "AbortError") return false;
      throw e;
    }
  } else {
    triggerDownload(file);
  }
  await deleteClassSessions(classId);
  return true;
}
