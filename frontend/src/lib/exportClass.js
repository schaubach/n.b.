import api from "./api";

export function classFileName(className, dateLabel) {
  const name = (className || "Klasse").replace(/\s+/g, "_");
  let date = dateLabel;
  if (!date) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    date = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  } else {
    date = date.replace(/\./g, "-");
  }
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

export async function deleteClassSessions(classId) {
  await api.delete(`/classes/${classId}/sessions`);
}

export async function downloadClassCsv(classId, className) {
  const file = await getClassCsvFile(classId, className);
  triggerDownload(file);
}
