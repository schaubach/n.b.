const MAIL_BACKEND_PORT = 8123;
const CONFIG_FILE = (process.env.PUBLIC_URL || "") + "/mail-backend-config.json";

const encoder = new TextEncoder();

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(signature);
}

async function loadMailBackendConfig() {
  const response = await fetch(CONFIG_FILE, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("mail-backend-config.json fehlt oder ist nicht lesbar.");
  }
  const config = await response.json();
  const preSharedKey = String(config.preSharedKey || "").trim();
  if (!preSharedKey || preSharedKey.includes("NICHT_INS_REPOSITORY")) {
    throw new Error("Pre-Shared-Key fuer das Mail-Backend fehlt.");
  }
  return { preSharedKey };
}

export function normalizeMailBackendHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = raw.includes("://") ? raw : "https://" + raw;
  try {
    return new URL(withScheme).hostname;
  } catch (error) {
    return raw.replace(/^https?:\/\//i, "").replace(/[:/].*$/, "");
  }
}

export async function sendGradebookMailsViaBackend(teacherConfig, messages) {
  const host = normalizeMailBackendHost(teacherConfig?.mail_backend_host);
  if (!host) throw new Error("IP-Adresse des Mail-Backends fehlt.");
  const { preSharedKey } = await loadMailBackendConfig();
  const payload = { teacher: teacherConfig, messages };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  const signature = await hmacSha256Hex(preSharedKey, timestamp + "." + nonce + "." + body);
  const url = "https://" + host + ":" + MAIL_BACKEND_PORT + "/api/send-gradebook";

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NB-Timestamp": timestamp,
        "X-NB-Nonce": nonce,
        "X-NB-Signature": signature,
      },
      body,
    });
  } catch (error) {
    throw new Error("Mail-Backend nicht erreichbar oder Zertifikat nicht vertraut.");
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.detail || "Mailversand fehlgeschlagen.");
  }
  return result;
}
