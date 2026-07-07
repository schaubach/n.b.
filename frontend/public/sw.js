const CACHE_NAME = "nb-offline-v2";
const CORE_ASSETS = ["./", "./index.html", "./manifest.json", "./logo.jpeg", "./icon.svg", "./asset-manifest.json"];

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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(Response.error());
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
