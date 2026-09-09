import api from "./api";

const MAIL_BACKEND_PORT = 8123;
const CONFIG_FILE = (process.env.PUBLIC_URL || "") + "/mail-backend-config.json";

const encoder = new TextEncoder();
const verifiedIdentityCache = new Map();
const DEFAULT_HEALTH_TIMEOUT_MS = 3500;
const DEFAULT_IDENTITY_TIMEOUT_MS = 5000;
const DEFAULT_SEND_TIMEOUT_MS = 12000;
const SENT_COPY_TIMEOUT_MS = 90000;

function displayMode() {
  if (typeof window === "undefined") return "unbekannt";
  if (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator?.standalone === true) return "Home-Screen-App";
  return "Safari-Tab";
}

function runtimeDetails(url) {
  const target = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "unbekannt";
  const secure = typeof window !== "undefined" ? window.isSecureContext : false;
  const online = typeof navigator !== "undefined" ? navigator.onLine : false;
  const worker = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller?.scriptURL : "";
  return [
    "Ziel: " + target.href,
    "App-Modus: " + displayMode(),
    "App-Origin: " + appOrigin,
    "Backend-Origin: " + target.origin,
    "Gleiche Origin: " + (appOrigin === target.origin ? "ja" : "nein"),
    "Sicherer Kontext: " + (secure ? "ja" : "nein"),
    "Browser meldet online: " + (online ? "ja" : "nein"),
    "Service Worker: " + (worker || "kein Controller"),
  ];
}

function requestFailure(stage, url, error, response) {
  const details = runtimeDetails(url);
  if (response) details.push("HTTP: " + response.status + " " + (response.statusText || ""));
  if (error) details.push("Browserfehler: " + (error.name || "Fehler") + (error.message ? " - " + error.message : ""));
  if (error?.name === "AbortError") details.push("Einordnung: Zeitueberschreitung; Zielhost oder Route antwortet nicht rechtzeitig.");
  else if (error instanceof TypeError) details.push("Einordnung: Safari hat die Netzwerkanfrage abgewiesen. Moeglich sind TLS-Vertrauen, CORS, DNS/Route oder ein nicht erreichbarer Host.");
  if (details.some((item) => item === "Gleiche Origin: nein")) details.push("Hinweis: Bei verschiedenen Origins muss die App-Origin in ALLOWED_ORIGINS des Mail-Backends stehen.");
  details.push("Safari stellt JavaScript keine weitergehenden Zertifikatsdetails bereit.");
  return stage + " fehlgeschlagen.\n" + details.join("\n");
}

function canonicalPublicKeyPem(value) {
  return String(value || "").trim().replace(/\r\n/g, "\n") + "\n";
}

async function publicKeyFingerprint(value) {
  return sha256Hex(canonicalPublicKeyPem(value));
}

function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_SEND_TIMEOUT_MS) {
  if (typeof AbortController === "undefined") return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(hash);
}

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function publicKeyPemToArrayBuffer(pem) {
  const base64 = String(pem || "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  if (!base64) {
    throw new Error("Public Key fuer die Backend-Identitaet fehlt.");
  }
  return base64ToArrayBuffer(base64);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export async function loadInstallPackageMailBackendConfig() {
  const configUrl = new URL(CONFIG_FILE, window.location.href).href;
  let response;
  try {
    response = await fetchWithTimeout(configUrl, { cache: "no-store", credentials: "same-origin" }, DEFAULT_IDENTITY_TIMEOUT_MS);
  } catch (error) {
    throw new Error(requestFailure("Laden der Backend-Credentials", configUrl, error));
  }
  if (!response.ok) {
    const authHint = response.status === 401
      ? " Die Home-Screen-App hat wahrscheinlich keine Basic-Auth-Sitzung des Safari-Tabs. Bitte die Credentials-Datei in der Lehrendenkonfiguration laden."
      : "";
    throw new Error("mail-backend-config.json fehlt oder ist nicht lesbar." + authHint + "\n" + requestFailure("Laden der Backend-Credentials", configUrl, null, response));
  }
  const config = await response.json().catch(() => null);
  if (!config) throw new Error("mail-backend-config.json ist kein gueltiges JSON.\n" + runtimeDetails(configUrl).join("\n"));
  const preSharedKey = String(config.preSharedKey || "").trim();
  const backendIdentityPublicKey = String(config.backendIdentityPublicKey || "").trim();
  if (!preSharedKey || preSharedKey.includes("NICHT_INS_REPOSITORY")) {
    throw new Error("Pre-Shared-Key fuer das Mail-Backend fehlt.");
  }
  if (!backendIdentityPublicKey || backendIdentityPublicKey.includes("-----BEGIN PUBLIC KEY-----\\n...")) {
    throw new Error("Public Key fuer die Backend-Identitaet fehlt.");
  }
  return { preSharedKey, backendIdentityPublicKey, source: "install-package" };
}

export async function loadMailBackendConfig() {
  try {
    const configRes = await api.get("/teacher-config");
    const localConfig = configRes.data || {};
    const localPreSharedKey = String(localConfig.mail_backend_pre_shared_key || "").trim();
    const localPublicKey = String(localConfig.backend_identity_public_key || "").trim();
    if (localPreSharedKey && localPublicKey) {
      return { preSharedKey: localPreSharedKey, backendIdentityPublicKey: localPublicKey, source: "teacher-config" };
    }
  } catch (error) {}

  return loadInstallPackageMailBackendConfig();
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

function identityDetails(host, payload, localFingerprint, preSharedKey) {
  return [
    "Konfigurierter Host: " + (host || "fehlt"),
    "Backend serverName: " + (payload?.serverName || "fehlt"),
    "Lokaler Public-Key-SHA256 aus mail-backend-config.json: " + (localFingerprint || "fehlt"),
    "Backend Public-Key-SHA256 aus /api/identity: " + (payload?.publicKeySha256 || "fehlt"),
    "Lokaler Pre-Shared-Key aus mail-backend-config.json: " + (preSharedKey || "fehlt"),
  ].join("; ");
}

async function verifyBackendIdentity(host, publicKeyPem, preSharedKey) {
  const fingerprint = await publicKeyFingerprint(publicKeyPem);
  const cacheKey = host + "|" + fingerprint;
  if (verifiedIdentityCache.has(cacheKey)) return verifiedIdentityCache.get(cacheKey);

  const challenge = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  let response;
  const identityUrl = "https://" + host + ":" + MAIL_BACKEND_PORT + "/api/identity?challenge=" + encodeURIComponent(challenge);
  try {
    response = await fetchWithTimeout(identityUrl, { cache: "no-store" }, DEFAULT_IDENTITY_TIMEOUT_MS);
  } catch (error) {
    throw new Error(requestFailure("Identitaetsabfrage", identityUrl, error));
  }
  const identity = await response.json().catch(() => ({}));
  if (!response.ok || !identity.payload || !identity.signature) {
    throw new Error((identity.detail || "Backend-Identitaet konnte nicht gelesen werden.") + "\n" + requestFailure("Identitaetsabfrage", identityUrl, null, response));
  }
  const payload = identity.payload;
  if (payload.app !== "n.b." || payload.challenge !== challenge) {
    throw new Error("Backend-Identitaet passt nicht zur App. " + identityDetails(host, payload, fingerprint, preSharedKey) + "; App: " + (payload.app || "fehlt") + "; Challenge erhalten: " + (payload.challenge || "fehlt"));
  }
  if (payload.serverName && normalizeMailBackendHost(payload.serverName) !== host) {
    throw new Error("Backend-Identitaet passt nicht zur konfigurierten Adresse. " + identityDetails(host, payload, fingerprint, preSharedKey));
  }
  // The backend fingerprint is diagnostic only: PEM wrapping or a missing final
  // newline changes this text hash even when the cryptographic key is identical.
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyPemToArrayBuffer(publicKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    base64ToArrayBuffer(identity.signature),
    encoder.encode(stableStringify(payload))
  );
  if (!valid) {
    throw new Error("Backend-Identitaet konnte nicht verifiziert werden. Die Signatur passt nicht zum lokalen Public Key. " + identityDetails(host, payload, fingerprint, preSharedKey));
  }
  const verified = { payload, fingerprint };
  verifiedIdentityCache.set(cacheKey, verified);
  return verified;
}

export async function checkMailBackendHealth(value, options = {}) {
  const host = normalizeMailBackendHost(value);
  if (!host) {
    return { ok: false, message: "IP-Adresse des Mail-Backends fehlt." };
  }
  const healthUrl = "https://" + host + ":" + MAIL_BACKEND_PORT + "/health";
  try {
    const response = await fetchWithTimeout(healthUrl, { cache: "no-store" }, options.timeoutMs || DEFAULT_HEALTH_TIMEOUT_MS);
    if (!response.ok) {
      return { ok: false, message: requestFailure("Healthcheck", healthUrl, null, response) };
    }
    const result = await response.json().catch(() => ({}));
    if (result.ok !== true) {
      return { ok: false, message: "Healthcheck lieferte keine positive Antwort.\n" + runtimeDetails(healthUrl).join("\n") };
    }
    return { ok: true, message: "Mail-Backend erreichbar." };
  } catch (error) {
    return { ok: false, message: requestFailure("Healthcheck", healthUrl, error) };
  }
}

export async function checkMailBackendConnection(value, options = {}) {
  const host = normalizeMailBackendHost(value);
  const health = await checkMailBackendHealth(host, options);
  if (!health.ok) return health;
  try {
    const config = await loadMailBackendConfig();
    const verified = await verifyBackendIdentity(host, config.backendIdentityPublicKey, config.preSharedKey);
    return {
      ok: true,
      message: [
        "Mail-Backend erreichbar und Identitaet bestaetigt.",
        "Credential-Quelle: " + (config.source === "teacher-config" ? "lokal verschluesselte Lehrendenkonfiguration" : "Installationspaket"),
        "Lokaler Public-Key-SHA256: " + verified.fingerprint,
        "Backend Public-Key-SHA256: " + (verified.payload?.publicKeySha256 || "fehlt"),
      ].join("\n"),
    };
  } catch (error) {
    return { ok: false, message: error?.message || "Backend-Verbindung konnte nicht geprueft werden." };
  }
}

async function sendMessagesViaBackend(teacherConfig, messages, options = {}) {
  const host = normalizeMailBackendHost(teacherConfig?.mail_backend_host);
  if (!host) throw new Error("IP-Adresse des Mail-Backends fehlt.");
  const health = await checkMailBackendHealth(host, { timeoutMs: options.healthTimeoutMs });
  if (!health.ok) throw new Error(health.message);
  const { preSharedKey, backendIdentityPublicKey } = await loadMailBackendConfig();
  await verifyBackendIdentity(host, backendIdentityPublicKey, preSharedKey);
  const payload = { teacher: teacherConfig, messages };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  const signature = await hmacSha256Hex(preSharedKey, timestamp + "." + nonce + "." + body);
  const url = "https://" + host + ":" + MAIL_BACKEND_PORT + "/api/send-gradebook";

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NB-Timestamp": timestamp,
        "X-NB-Nonce": nonce,
        "X-NB-Signature": signature,
      },
      body,
    }, options.sendTimeoutMs || (teacherConfig?.copy_to_sent === true ? SENT_COPY_TIMEOUT_MS : DEFAULT_SEND_TIMEOUT_MS));
  } catch (error) {
    throw new Error(requestFailure("Mailversand", url, error));
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.detail || "Mailversand fehlgeschlagen.");
  }
  return result;
}


export async function sendGradebookMailsViaBackend(teacherConfig, messages) {
  return sendMessagesViaBackend(teacherConfig, messages);
}

export async function sendBackupMailViaBackend(teacherConfig, attachment, options = {}) {
  const today = new Date().toLocaleDateString("de-DE");
  return sendMessagesViaBackend(teacherConfig, [{
    to: teacherConfig.email,
    subject: "n.b. Backup " + today,
    text: "Automatisches n.b. Backup vom " + today + ". Die Datei ist ein passwortgeschuetztes ZIP; Passwort ist Ihr IServ-Passwort.",
    html: "<p>Automatisches n.b. Backup vom " + today + ".</p><p>Die Datei ist ein passwortgeschuetztes ZIP; Passwort ist Ihr IServ-Passwort.</p>",
    attachments: [attachment],
  }], options);
}
