import { APP_VERSION } from "../generated/appVersion";

const VERSION_FILE = `${process.env.PUBLIC_URL || "."}/app-version.json`;
const CHECK_TIMEOUT_MS = 3500;
const UPDATE_TIMEOUT_MS = 20000;

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function cacheBust(url) {
  const absolute = new URL(url, window.location.href);
  absolute.searchParams.set("__nb_update", String(Date.now()));
  return absolute.href;
}

async function readJson(response) {
  if (!response || !response.ok) return null;
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

export async function localAppVersion() {
  if (APP_VERSION?.buildId) return { ...APP_VERSION, source: "bundle" };
  if ("caches" in window) {
    const cached = await caches.match(VERSION_FILE) || await caches.match("./app-version.json");
    const parsed = await readJson(cached);
    if (parsed) return { ...parsed, source: "cache" };
  }
  return null;
}

export async function serverAppVersion(timeoutMs = CHECK_TIMEOUT_MS) {
  const response = await withTimeout(
    fetch(cacheBust(VERSION_FILE), { cache: "no-store", credentials: "same-origin", headers: { "Cache-Control": "no-cache" } }),
    timeoutMs,
    "Versionsprüfung hat zu lange gedauert."
  );
  if (!response.ok) throw new Error("Versionsdatei konnte nicht geladen werden (HTTP " + response.status + ").");
  const parsed = await readJson(response);
  if (!parsed || !parsed.buildId) throw new Error("Versionsdatei ist unvollständig.");
  return parsed;
}

function key(version) {
  return version?.buildId || version?.gitSha || version?.builtAt || version?.version || "";
}

export function isServerVersionNewer(localVersion, remoteVersion) {
  if (!remoteVersion) return false;
  if (!localVersion) return true;
  const localTime = Date.parse(localVersion.builtAt || "");
  const remoteTime = Date.parse(remoteVersion.builtAt || "");
  if (Number.isFinite(localTime) && Number.isFinite(remoteTime)) return remoteTime > localTime + 1000;
  return !!key(remoteVersion) && key(remoteVersion) !== key(localVersion);
}

export async function checkAppUpdate() {
  const [local, remote] = await Promise.all([localAppVersion(), serverAppVersion()]);
  return { local, remote, available: isServerVersionNewer(local, remote) };
}

function postToWorker(worker, message, timeoutMs = UPDATE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("Kein Service Worker aktiv."));
      return;
    }
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error("Update hat zu lange gedauert.")), timeoutMs);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      if (event.data?.ok) resolve(event.data);
      else reject(new Error(event.data?.message || "Update fehlgeschlagen."));
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function waitForControllerChange(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigator.serviceWorker.removeEventListener("controllerchange", finish);
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", finish);
    window.setTimeout(finish, timeoutMs);
  });
}

export async function forceAppUpdate() {
  const remote = await serverAppVersion(UPDATE_TIMEOUT_MS);
  if (!("serviceWorker" in navigator)) {
    window.location.reload();
    return { remote };
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    window.location.reload();
    return { remote };
  }
  await registration.update().catch(() => {});
  if (registration.waiting) {
    registration.waiting.postMessage({ type: "NB_SKIP_WAITING" });
    await waitForControllerChange();
  }
  const worker = navigator.serviceWorker.controller || registration.active || registration.waiting;
  await postToWorker(worker, { type: "NB_FORCE_UPDATE", remote });
  window.location.reload();
  return { remote };
}

export function formatVersion(version) {
  if (!version) return "unbekannt";
  const sha = version.gitSha && version.gitSha !== "unknown" ? " · " + version.gitSha : "";
  const date = version.builtAt ? new Date(version.builtAt).toLocaleString("de-DE") : "";
  return [version.version || "n.b.", date].filter(Boolean).join(" · ") + sha;
}
