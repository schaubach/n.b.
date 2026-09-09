const WORKER_BUILD = "__NB_WORKER_BUILD__";
const CACHE_PREFIX = "nb-offline-v10-" + encodeURIComponent(self.registration.scope) + "-";
const META_CACHE = CACHE_PREFIX + "metadata";
const CORE_ASSETS = ["./manifest.json", "./logo.jpeg", "./icon.svg"];
const GRADE_SCALE_INDEX = "./notenskala/index.json";
const REQUEST_TIMEOUT_MS = 8000;
const ACTIVE_KEY = scopedUrl("./__offline_active__");
const COMPLETE_KEY = scopedUrl("./__offline_complete__");
const PENDING_KEY = scopedUrl("./__offline_pending__/" + encodeURIComponent(WORKER_BUILD));
let updateInFlight;

function scopedUrl(asset) {
  return new URL(asset, self.registration.scope).href;
}

function fetchWithTimeout(request, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}


function cacheBustedUrl(asset) {
  const url = new URL(asset, self.location.href);
  url.searchParams.set("__nb_update", String(Date.now()));
  return url.href;
}

function validGradeScaleFilename(name) {
  return typeof name === "string" && /\.csv$/i.test(name) && !name.includes("/") && !name.includes("\\");
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createOfflineShell(manifest) {
  const entrypoints = Array.isArray(manifest.entrypoints) ? manifest.entrypoints : [];
  const styles = entrypoints
    .filter((asset) => typeof asset === "string" && asset.endsWith(".css"))
    .map((asset) => `<link href="${escapeAttribute(scopedUrl(asset))}" rel="stylesheet">`)
    .join("");
  const scripts = entrypoints
    .filter((asset) => typeof asset === "string" && asset.endsWith(".js"))
    .map((asset) => `<script defer src="${escapeAttribute(scopedUrl(asset))}"></script>`)
    .join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#fafaf9"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="n.b."><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self' https://*:8123; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests"><link rel="manifest" href="./manifest.json" crossorigin="use-credentials"><link rel="icon" href="./logo.jpeg" type="image/jpeg"><link rel="apple-touch-icon" href="./logo.jpeg">${styles}<title>n.b. - Noten blitzschnell vergeben</title></head><body><noscript>JavaScript muss aktiviert sein.</noscript><div id="root"></div>${scripts}</body></html>`;
}

async function cacheOfflineHtml(cache, html) {
  const response = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  await Promise.all([
    cache.put(scopedUrl("./"), response.clone()),
    cache.put(scopedUrl("./index.html"), response.clone()),
    cache.put(scopedUrl("./index.html?source=pwa"), response.clone()),
  ]);
}

async function fetchAsset(asset, attempts = 3) {
  const url = new URL(asset, self.registration.scope);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) {
    throw new Error("Asset ausserhalb der App: " + asset);
  }
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(cacheBustedUrl(asset), { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("Offline-Datei nicht geladen (HTTP " + response.status + "): " + asset);
      if ((response.headers.get("Content-Type") || "").includes("text/html")) {
        throw new Error("Statt der Offline-Datei wurde HTML geliefert: " + asset);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

async function missingAssets(cache, assets) {
  const missing = [];
  for (const asset of assets) {
    if (!await cache.match(scopedUrl(asset))) missing.push(asset);
  }
  return missing;
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

async function activeSnapshot() {
  const meta = await caches.open(META_CACHE);
  const response = await meta.match(ACTIVE_KEY);
  return response ? response.json() : null;
}

async function prepareSnapshot() {
  const name = CACHE_PREFIX + crypto.randomUUID();
  const cache = await caches.open(name);
  try {
    const versionResponse = await fetchAsset("./app-version.json");
    const version = await versionResponse.clone().json();
    if (!version.buildId) throw new Error("Die Build-Version fehlt.");
    const manifestResponse = await fetchAsset("./asset-manifest.json");
    const manifest = await manifestResponse.clone().json();
    if (!Array.isArray(manifest.entrypoints) || !manifest.entrypoints.some((asset) => asset.endsWith(".js"))) {
      throw new Error("Das Asset-Manifest enthaelt keinen App-Startpunkt.");
    }
    const indexResponse = await fetchAsset(GRADE_SCALE_INDEX);
    const scales = await indexResponse.clone().json();
    if (!Array.isArray(scales) || scales.some((name) => !validGradeScaleFilename(name))) {
      throw new Error("Der Notenskalen-Index ist ungueltig.");
    }
    const assets = new Set([
      ...CORE_ASSETS,
      ...manifest.entrypoints,
      ...Object.values(manifest.files || {}).filter((asset) => typeof asset === "string" && !asset.endsWith(".map") && !asset.endsWith("index.html")),
      ...scales.map((name) => "./notenskala/" + encodeURIComponent(name)),
    ].map(scopedUrl));
    // Wait for every write to settle before deleting a failed staging cache.
    const downloads = await Promise.allSettled(Array.from(assets, async (asset) => {
      await cache.put(asset, await fetchAsset(asset));
    }));
    const failed = downloads.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const finalVersion = await (await fetchAsset("./app-version.json")).json();
    const finalManifest = await (await fetchAsset("./asset-manifest.json")).json();
    if (finalVersion.buildId !== version.buildId || JSON.stringify(finalManifest) !== JSON.stringify(manifest)) {
      throw new Error("Die Serverversion wurde waehrend des Downloads geaendert. Bitte Update wiederholen.");
    }
    await cache.put(scopedUrl("./app-version.json"), versionResponse);
    await cache.put(scopedUrl("./asset-manifest.json"), manifestResponse);
    await cache.put(scopedUrl(GRADE_SCALE_INDEX), indexResponse);
    await cacheOfflineHtml(cache, createOfflineShell(manifest));
    ["./app-version.json", "./asset-manifest.json", GRADE_SCALE_INDEX, "./", "./index.html", "./index.html?source=pwa"].forEach((asset) => assets.add(scopedUrl(asset)));
    const missing = await missingAssets(cache, assets);
    if (missing.length) throw new Error("Offline-Cache unvollstaendig: " + missing.join(", "));
    const snapshot = { name, version, assets: Array.from(assets) };
    await cache.put(COMPLETE_KEY, jsonResponse(snapshot));
    return snapshot;
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

async function commitSnapshot(snapshot) {
  const current = await activeSnapshot();
  if (current && Date.parse(current.version.builtAt) > Date.parse(snapshot.version.builtAt)) return;
  const meta = await caches.open(META_CACHE);
  // A single Cache.put is the commit point. Nothing touches the old package.
  await meta.put(ACTIVE_KEY, jsonResponse(snapshot));
  // Keep earlier assets available for open tabs whose code still imports them.
}

self.addEventListener("install", (event) => event.waitUntil((async () => {
  const snapshot = await prepareSnapshot();
  const meta = await caches.open(META_CACHE);
  await meta.put(PENDING_KEY, jsonResponse(snapshot));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const meta = await caches.open(META_CACHE);
  const pending = await meta.match(PENDING_KEY);
  if (pending) {
    await commitSnapshot(await pending.json());
    await meta.delete(PENDING_KEY);
  }
  await self.clients.claim();
})()));

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "NB_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (type === "NB_FORCE_UPDATE") {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      (updateInFlight || (updateInFlight = prepareSnapshot().then(commitSnapshot).finally(() => { updateInFlight = null; })))
        .then(() => {
          if (port) port.postMessage({ ok: true });
        })
        .catch((error) => {
          if (port) port.postMessage({ ok: false, message: error && error.message ? error.message : "Update fehlgeschlagen." });
        })
    );
    return;
  }
  if (type === "NB_OFFLINE_STATUS") {
    const port = event.ports && event.ports[0];
    event.waitUntil((async () => {
      try {
        const snapshot = await activeSnapshot();
        const missing = snapshot ? await missingAssets(await caches.open(snapshot.name), snapshot.assets) : ["App-Paket"];
        if (port) port.postMessage({ ok: missing.length === 0, missing, version: snapshot?.version });
      } catch (error) {
        if (port) port.postMessage({ ok: false, message: error.message });
      }
    })());
  }
});

async function cachedResponse(request, navigation) {
  const snapshot = await activeSnapshot();
  if (snapshot) {
    const cache = await caches.open(snapshot.name);
    const response = await cache.match(navigation ? scopedUrl("./index.html") : request);
    if (response) return response;
  }
  // Only content-hashed assets may fall back to previous releases, never HTML.
  if (!navigation && new URL(request.url).pathname.includes("/static/")) {
    const names = await caches.keys();
    for (const name of names.reverse()) {
      if (!name.startsWith(CACHE_PREFIX) && !/^nb-offline-v[0-9]+$/.test(name)) continue;
      const cache = await caches.open(name);
      if (name.startsWith(CACHE_PREFIX) && !await cache.match(COMPLETE_KEY)) continue;
      const response = await cache.match(request);
      if (response) return response;
    }
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Cross-origin calls, such as a separately addressed mail backend, must
    // remain in Safari's network stack. CORS and TLS still apply there.
    return;
  }

  if (url.pathname === "/health" || url.pathname.startsWith("/api/") || url.pathname.endsWith("/mail-backend-config.json") || url.searchParams.has("__nb_update")) {
    event.respondWith(fetchWithTimeout(request));
    return;
  }

  const wantsHtml = request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
  event.respondWith(
    cachedResponse(request, wantsHtml).then((cached) => {
      if (cached) return cached;
      return fetchWithTimeout(request);
    })
  );
});
