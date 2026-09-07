const OFFLINE_CACHE_NAME = "nb-offline-v7";

function offlineShellHtml() {
  const html = document.documentElement.cloneNode(true);
  const root = html.querySelector("#root");
  if (root) root.replaceChildren();
  return "<!doctype html>\n" + html.outerHTML;
}

async function primeOfflineShell() {
  if (!("caches" in window)) return;
  const cache = await caches.open(OFFLINE_CACHE_NAME);
  const base = new URL(process.env.PUBLIC_URL || ".", window.location.href);
  const response = new Response(offlineShellHtml(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  await Promise.all([
    cache.put(new URL("./", base).href, response.clone()),
    cache.put(new URL("./index.html", base).href, response.clone()),
  ]);
}

export async function register() {
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;

  try {
    await primeOfflineShell();
    const swUrl = `${process.env.PUBLIC_URL}/sw.js`;
    const registration = await navigator.serviceWorker.register(swUrl, { scope: "./" });
    const ready = await navigator.serviceWorker.ready;
    const worker = ready.active || registration.active || navigator.serviceWorker.controller;
    worker?.postMessage({ type: "NB_PRIME_OFFLINE", html: offlineShellHtml() });
  } catch (error) {
    console.warn("Offline-Modus konnte nicht vorbereitet werden.", error);
  }
}
