export async function register() {
  if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
  try {
    await navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/sw.js`, {
      scope: "./",
      updateViaCache: "none",
    });
    // Only the worker publishes a fully downloaded offline package.
    await navigator.serviceWorker.ready;
    navigator.storage?.persist?.().catch(() => {});
    window.dispatchEvent(new Event("nb-offline-ready"));
  } catch (error) {
    console.warn("Offline-Modus konnte nicht vorbereitet werden.", error);
    window.dispatchEvent(new Event("nb-offline-ready"));
  }
}
