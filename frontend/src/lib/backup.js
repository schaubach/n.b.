import api from "./api";
import { sendBackupMailViaBackend } from "./mailBackend";

const BACKUP_MAGIC = "NBBAK1";
const BACKUP_VERSION = 1;
const DEFAULT_BACKUP_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const u16 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255]);
const u32 = (value) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const readU32 = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data || ""));
    const crc = crc32(data);
    const local = concatBytes([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    locals.push(local);
    central.push(concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const centralBytes = concatBytes(central);
  return concatBytes([...locals, centralBytes, concatBytes([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBytes.length), u32(offset), u16(0)])]);
}

function unzipStored(bytes) {
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && readU32(bytes, offset) === 0x04034b50) {
    if (readU16(bytes, offset + 8) !== 0) throw new Error("Backup-ZIP nutzt ein nicht unterstütztes Kompressionsformat.");
    const size = readU32(bytes, offset + 18);
    const nameLength = readU16(bytes, offset + 26);
    const extraLength = readU16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + size > bytes.length) throw new Error("Backup-ZIP ist beschaedigt oder unvollstaendig.");
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    files.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvLine = (values) => values.map(csvEscape).join(",");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((item) => item.some((value) => value !== ""));
}

function dataUrlToBytes(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) return null;
  try {
    return { mime: match[1], bytes: base64ToBytes(match[2]) };
  } catch (error) {
    return null;
  }
}
const bytesToDataUrl = (bytes, mime = "image/jpeg") => "data:" + mime + ";base64," + bytesToBase64(bytes);
const clone = (value) => JSON.parse(JSON.stringify(value));
const stateKeys = () => ["classes", "students", "sessions", "grades", "gradebook_overrides", "gradebook_weights", "grade_scales", "hidden_grade_scales", "point_sessions", "teacher_config", "backup_meta"];

function buildFilesFromState(rawState) {
  const state = clone(rawState);
  const files = [];
  const imageManifest = [];
  for (const student of state.students || []) {
    if (!student.photo) continue;
    const image = dataUrlToBytes(student.photo);
    if (!image) continue;
    const ext = image.mime === "image/png" ? "png" : "jpg";
    const name = "images/" + student.id + "." + ext;
    files.push({ name, data: image.bytes });
    imageManifest.push({ student_id: student.id, file: name, mime: image.mime });
    student.photo = "";
    student.photo_file = name;
  }
  files.push({ name: "data/state.csv", data: "\ufeff" + [["key", "json"], ...stateKeys().map((key) => [key, JSON.stringify(state[key] ?? (key === "teacher_config" || key === "backup_meta" ? {} : []))])].map(csvLine).join("\n") });
  files.push({ name: "data/images.csv", data: "\ufeff" + [["student_id", "file", "mime"], ...imageManifest.map((item) => [item.student_id, item.file, item.mime])].map(csvLine).join("\n") });
  files.push({ name: "manifest.json", data: JSON.stringify({ app: "n.b.", type: "encrypted-backup-source", version: BACKUP_VERSION, created_at: new Date().toISOString() }, null, 2) });
  return files;
}

function stateFromZipFiles(files) {
  const stateCsv = files.get("data/state.csv");
  if (!stateCsv) throw new Error("Backup enthaelt keine data/state.csv.");
  const rows = parseCsv(decoder.decode(stateCsv).replace(/^\ufeff/, ""));
  const restored = {};
  for (const row of rows.slice(1)) if (row[0]) restored[row[0]] = JSON.parse(row[1] || "null");
  const state = {};
  for (const key of stateKeys()) state[key] = restored[key] ?? (key === "teacher_config" || key === "backup_meta" ? {} : []);
  for (const student of state.students || []) {
    if (student.photo_file && files.has(student.photo_file)) {
      const mime = student.photo_file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      student.photo = bytesToDataUrl(files.get(student.photo_file), mime);
    }
    delete student.photo_file;
  }
  return state;
}

async function backupKey(preSharedKey, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(preSharedKey), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptZip(zipBytes, preSharedKey) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(preSharedKey, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, zipBytes));
  const header = encoder.encode(JSON.stringify({ version: BACKUP_VERSION, kdf: "PBKDF2-SHA256", iterations: 210000, salt: bytesToBase64(salt), iv: bytesToBase64(iv) }));
  return concatBytes([encoder.encode(BACKUP_MAGIC), u32(header.length), header, cipher]);
}

async function decryptZip(fileBytes, preSharedKey) {
  if (decoder.decode(fileBytes.slice(0, BACKUP_MAGIC.length)) !== BACKUP_MAGIC) throw new Error("Backup-Datei hat ein unbekanntes Format.");
  const headerLength = readU32(fileBytes, BACKUP_MAGIC.length);
  const headerStart = BACKUP_MAGIC.length + 4;
  const header = JSON.parse(decoder.decode(fileBytes.slice(headerStart, headerStart + headerLength)));
  const key = await backupKey(preSharedKey, base64ToBytes(header.salt));
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(header.iv) }, key, fileBytes.slice(headerStart + headerLength)));
}

async function loadPreSharedKey() {
  const response = await fetch((process.env.PUBLIC_URL || "") + "/mail-backend-config.json", { cache: "no-store" });
  if (!response.ok) throw new Error("mail-backend-config.json fehlt oder ist nicht lesbar.");
  const config = await response.json();
  const preSharedKey = String(config.preSharedKey || "").trim();
  if (!preSharedKey || preSharedKey.includes("NICHT_INS_REPOSITORY")) throw new Error("Pre-Shared-Key fuer Backups fehlt.");
  return preSharedKey;
}

const backupFilename = () => "nb-backup-" + new Date().toISOString().slice(0, 10) + ".zip.enc";

function triggerDownload(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function createEncryptedBackup() {
  const [stateRes, preSharedKey] = await Promise.all([api.get("/backup/state"), loadPreSharedKey()]);
  const zip = makeZip(buildFilesFromState(stateRes.data.state || {}));
  const encrypted = await encryptZip(zip, preSharedKey);
  return { bytes: encrypted, filename: backupFilename(), size: encrypted.length };
}

export async function sendBackupToTeacher({ download = false } = {}) {
  const configRes = await api.get("/teacher-config");
  const teacherConfig = configRes.data || {};
  if (!teacherConfig.email || !teacherConfig.password || !teacherConfig.mail_backend_host) throw new Error("Lehrendenkonfiguration fuer Backup unvollstaendig.");
  const backup = await createEncryptedBackup();
  await sendBackupMailViaBackend(teacherConfig, { filename: backup.filename, data: bytesToBase64(backup.bytes), contentType: "application/octet-stream", size: backup.size });
  await api.post("/backup/mark-sent", { sent_at: new Date().toISOString(), size: backup.size });
  if (download) triggerDownload(backup.bytes, backup.filename);
  return backup;
}

function backupIntervalDays(state) {
  const value = Number(state?.teacher_config?.backup_interval_days);
  if (!Number.isFinite(value)) return DEFAULT_BACKUP_INTERVAL_DAYS;
  return Math.min(365, Math.max(1, Math.floor(value)));
}

export async function maybeSendAutomaticBackup() {
  const stateRes = await api.get("/backup/state");
  const state = stateRes.data.state || {};
  const last = state.backup_meta?.last_backup_sent_at;
  const lastTime = last ? new Date(last).getTime() : 0;
  const intervalMs = backupIntervalDays(state) * DAY_MS;
  if (Number.isFinite(lastTime) && lastTime > 0 && Date.now() - lastTime < intervalMs) {
    return { skipped: true, next_at: new Date(lastTime + intervalMs).toISOString() };
  }
  try {
    await sendBackupToTeacher();
    return { sent: true };
  } catch (error) {
    return { skipped: true, error: error.message };
  }
}

export const maybeSendWeeklyBackup = maybeSendAutomaticBackup;

export async function importEncryptedBackup(file) {
  const preSharedKey = await loadPreSharedKey();
  const encrypted = new Uint8Array(await file.arrayBuffer());
  const zipBytes = await decryptZip(encrypted, preSharedKey);
  const state = stateFromZipFiles(unzipStored(zipBytes));
  await api.post("/backup/restore-state", { state });
  return { ok: true };
}