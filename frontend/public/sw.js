const CACHE_NAME = "nb-offline-v4";
const CORE_ASSETS = ["./", "./index.html", "./manifest.json", "./logo.jpeg", "./icon.svg", "./asset-manifest.json", "./app-version.json"];
const NAVIGATION_UPDATE_TIMEOUT_MS = 1800;

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

async function fetchAndPut(cache, asset) {
  const response = await fetch(cacheBustedUrl(asset), { cache: "reload", credentials: "same-origin" });
  if (!response || !response.ok) throw new Error("Update-Asset konnte nicht geladen werden: " + asset);
  await cache.put(asset, response.clone());
  if (asset === "./" || asset === "./index.html") await cache.put("./index.html", response.clone());
}

async function updateOfflineCache() {
  const cache = await caches.open(CACHE_NAME);
  const assets = new Set(CORE_ASSETS);
  const manifestResponse = await fetch(cacheBustedUrl("./asset-manifest.json"), { cache: "reload", credentials: "same-origin" });
  if (!manifestResponse || !manifestResponse.ok) throw new Error("Asset-Manifest konnte nicht geladen werden.");
  const manifest = await manifestResponse.clone().json();
  await cache.put("./asset-manifest.json", manifestResponse);
  Object.values(manifest.files || {}).forEach((asset) => {
    if (typeof asset === "string" && !asset.endsWith(".map")) assets.add(asset);
  });
  await Promise.all(Array.from(assets).map((asset) => fetchAndPut(cache, asset)));
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
  const assets = new Set(CORE_ASSETS);
  try {
    const response = await fetch("./asset-manifest.json", { cache: "reload" });
    const manifest = await response.json();
    Object.values(manifest.files || {}).forEach((asset) => {
      if (typeof asset === "string" && !asset.endsWith(".map")) assets.add(asset);
    });
  } catch (error) {}
  await cache.addAll(Array.from(assets));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
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
        return caches.match("./index.html").then((index) => {
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
