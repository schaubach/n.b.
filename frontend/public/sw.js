const CACHE_NAME = "nb-offline-v7";
const CORE_ASSETS = ["./manifest.json", "./logo.jpeg", "./icon.svg", "./asset-manifest.json", "./app-version.json"];
const GRADE_SCALE_INDEX = "./notenskala/index.json";
const NAVIGATION_UPDATE_TIMEOUT_MS = 1800;

function scopedUrl(asset) {
  return new URL(asset, self.registration.scope).href;
}

function fetchWithTimeout(request, timeoutMs = NAVIGATION_UPDATE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}


function cacheBustedUrl(asset) {
  const url = new URL(asset, self.location.href);
  url.searchParams.set("__nb_update", String(Date.now()));
  return url.href;
}

function validGradeScaleFilename(name) {
  return typeof name === "string" && /\.csv$/i.test(name) && !name.includes("/") && !name.includes("\\");
}

async function bundledGradeScaleAssets(reload = false) {
  const response = await fetch(reload ? cacheBustedUrl(GRADE_SCALE_INDEX) : GRADE_SCALE_INDEX, {
    cache: reload ? "reload" : "default",
    credentials: "same-origin",
  });
  if (!response || !response.ok) throw new Error("Notenskalen-Index konnte nicht geladen werden.");
  const files = await response.json();
  return [GRADE_SCALE_INDEX, ...(Array.isArray(files) ? files.filter(validGradeScaleFilename).map((name) => `./notenskala/${encodeURIComponent(name)}`) : [])];
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

async function fetchAndPut(cache, asset, reload = false) {
  const source = reload ? cacheBustedUrl(asset) : scopedUrl(asset);
  const response = await fetch(source, { cache: reload ? "reload" : "default", credentials: "same-origin" });
  if (!response || !response.ok) throw new Error("Update-Asset konnte nicht geladen werden: " + asset);
  await cache.put(scopedUrl(asset), response.clone());
  if (asset === "./" || asset === "./index.html") await cache.put(scopedUrl("./index.html"), response.clone());
}

async function updateOfflineCache() {
  const cache = await caches.open(CACHE_NAME);
  const assets = new Set(CORE_ASSETS);
  const manifestResponse = await fetch(cacheBustedUrl("./asset-manifest.json"), { cache: "reload", credentials: "same-origin" });
  if (!manifestResponse || !manifestResponse.ok) throw new Error("Asset-Manifest konnte nicht geladen werden.");
  const manifest = await manifestResponse.clone().json();
  await cache.put(scopedUrl("./asset-manifest.json"), manifestResponse);
  await cacheOfflineHtml(cache, createOfflineShell(manifest));
  Object.values(manifest.files || {}).forEach((asset) => {
    if (typeof asset === "string" && !asset.endsWith(".map")) assets.add(asset);
  });
  (await bundledGradeScaleAssets(true)).forEach((asset) => assets.add(asset));
  await Promise.all(Array.from(assets).map((asset) => fetchAndPut(cache, asset, true)));
}

function refreshHtmlInBackground(request) {
  fetchWithTimeout(request).then((response) => {
    if (!response || !response.ok) return;
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => {
      cache.put(request, copy.clone());
      cache.put("./index.html", copy);
    });
  }).catch(() => {});
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch("./asset-manifest.json", { cache: "reload", credentials: "same-origin" });
  if (!response.ok) throw new Error("Asset-Manifest konnte nicht geladen werden.");
  const manifest = await response.json();
  const entrypoints = new Set((manifest.entrypoints || []).filter((asset) => typeof asset === "string"));
  const optionalAssets = new Set(CORE_ASSETS);
  Object.values(manifest.files || {}).forEach((asset) => {
    if (typeof asset === "string" && !asset.endsWith(".map") && !asset.endsWith("index.html") && !entrypoints.has(asset)) optionalAssets.add(asset);
  });
  await cacheOfflineHtml(cache, createOfflineShell(manifest));
  try {
    (await bundledGradeScaleAssets()).forEach((asset) => optionalAssets.add(asset));
  } catch (error) {}

  // A short failure of a PDF chunk or scale must not invalidate the complete
  // installation. The app shell and its entrypoints remain mandatory.
  await Promise.all(Array.from(entrypoints).map((asset) => fetchAndPut(cache, asset)));
  await Promise.allSettled(Array.from(optionalAssets).map((asset) => fetchAndPut(cache, asset)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("nb-offline-") && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});


self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "NB_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (type === "NB_FORCE_UPDATE") {
    const port = event.ports && event.ports[0];
    event.waitUntil(
      updateOfflineCache()
        .then(() => {
          if (port) port.postMessage({ ok: true });
        })
        .catch((error) => {
          if (port) port.postMessage({ ok: false, message: error && error.message ? error.message : "Update fehlgeschlagen." });
        })
    );
    return;
  }
  if (type === "NB_PRIME_OFFLINE") {
    const html = typeof event.data.html === "string" ? event.data.html : "";
    if (!html) return;
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cacheOfflineHtml(cache, html)));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(Response.error());
    return;
  }

  if (url.pathname.endsWith("/mail-backend-config.json")) {
    event.respondWith(fetch(request));
    return;
  }

  const wantsHtml = request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
  if (wantsHtml) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          refreshHtmlInBackground(request);
          return cached;
        }
        return caches.match(scopedUrl("./index.html")).then((index) => {
          if (index) {
            refreshHtmlInBackground(request);
            return index;
          }
          return fetchWithTimeout(request, 3000);
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
