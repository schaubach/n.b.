const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../public/sw.js"), "utf8");
const scope = "https://school.example/installwebapp/";
const absolute = (request) => new URL(typeof request === "string" ? request : request.url, scope).href;

function setup() {
  const stores = new Map();
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const items = stores.get(name);
      return {
        async put(request, response) { items.set(absolute(request), response.clone()); },
        async match(request) { return items.get(absolute(request))?.clone(); },
        async delete(request) { return items.delete(absolute(request)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  let release = 1;
  let blocked = "";
  let offline = false;
  let versionReads = 0;
  let changeDuringDownload = false;
  const requests = [];
  const network = async (request) => {
    const pathname = new URL(absolute(request)).pathname;
    requests.push(pathname);
    if (offline) throw new TypeError("Offline");
    if (pathname.includes(blocked || "not-a-path")) return new Response("Unavailable", { status: 503 });
    const version = { buildId: "release-" + release, version: "1.6." + release, builtAt: `2026-09-0${release}T12:00:00.000Z` };
    let data;
    if (pathname.endsWith("app-version.json")) {
      versionReads += 1;
      if (changeDuringDownload && versionReads % 2 === 0) version.buildId += "-changed";
      data = version;
    } else if (pathname.endsWith("asset-manifest.json")) {
      data = {
        files: { main: `./static/js/main.${release}.js`, pdf: `./static/js/pdf.${release}.js`, index: "./index.html" },
        entrypoints: [`static/js/main.${release}.js`],
      };
    } else if (pathname.endsWith("notenskala/index.json")) data = ["MEDA.csv"];
    else if (pathname.endsWith("index.html") || pathname.endsWith("/")) return new Response("Login", { status: 401 });
    else return new Response("asset-" + release, { headers: { "Content-Type": "application/javascript" } });
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  };
  function worker() {
    const handlers = {};
    let skipped = false;
    const context = vm.createContext({
      self: {
        registration: { scope }, location: new URL("sw.js", scope),
        addEventListener(type, handler) { handlers[type] = handler; },
        async skipWaiting() { skipped = true; }, clients: { async claim() {} },
      },
      caches, crypto: webcrypto, fetch: network, URL, Response, AbortController,
      setTimeout: (fn, ms) => setTimeout(fn, ms < 1000 ? 0 : ms), clearTimeout,
    });
    vm.runInContext(source, context);
    async function dispatch(type, data = {}) {
      let pending;
      handlers[type]({ ...data, waitUntil(promise) { pending = promise; } });
      await pending;
    }
    return {
      get skipped() { return skipped; },
      async install() { await dispatch("install"); await dispatch("activate"); },
      async message(type) {
        let reply;
        await dispatch("message", { data: { type }, ports: [{ postMessage(value) { reply = value; } }] });
        return reply;
      },
      async request(asset, navigate = false) {
        let response;
        const request = { url: absolute(asset), method: "GET", mode: navigate ? "navigate" : "cors", headers: new Headers() };
        handlers.fetch({ request, respondWith(promise) { response = promise; } });
        return response;
      },
    };
  }
  return {
    worker, stores, requests,
    set release(value) { release = value; },
    set blocked(value) { blocked = value; },
    set offline(value) { offline = value; },
    set changeDuringDownload(value) { changeDuringDownload = value; },
  };
}

test("cold offline start and every PDF chunk work without an HTML Basic-Auth session", async () => {
  const env = setup();
  await env.worker().install();
  assert.equal(env.requests.some((url) => url.endsWith("index.html")), false);
  env.offline = true;
  const restarted = env.worker();
  const before = env.requests.length;
  for (const url of ["./", "./index.html", "./index.html?source=pwa"]) {
    assert.match(await (await restarted.request(url, true)).text(), /main\.1\.js/);
  }
  assert.equal(await (await restarted.request("./static/js/pdf.1.js")).text(), "asset-1");
  assert.equal(await (await restarted.request("./notenskala/MEDA.csv")).text(), "asset-1");
  assert.equal((await restarted.message("NB_OFFLINE_STATUS")).ok, true);
  assert.equal(env.requests.length, before);
});

test("a missing lazy chunk prevents installation and deletes the incomplete package", async () => {
  const env = setup();
  env.blocked = "pdf.1.js";
  const worker = env.worker();
  await assert.rejects(worker.install(), /Offline-Datei/);
  assert.equal(worker.skipped, false);
  assert.equal(env.stores.size, 0);
});

test("an interrupted force update preserves the entire previous package across restart", async () => {
  const env = setup();
  const worker = env.worker();
  await worker.install();
  env.release = 2;
  env.blocked = "pdf.2.js";
  assert.equal((await worker.message("NB_FORCE_UPDATE")).ok, false);
  env.offline = true;
  const restarted = env.worker();
  assert.match(await (await restarted.request("./index.html?source=pwa", true)).text(), /main\.1\.js/);
  assert.equal(await (await restarted.request("./static/js/pdf.1.js")).text(), "asset-1");
  assert.equal((await restarted.message("NB_OFFLINE_STATUS")).version.buildId, "release-1");
});

test("opening online never replaces cached HTML independently of its assets", async () => {
  const env = setup();
  const worker = env.worker();
  await worker.install();
  env.release = 2;
  const before = env.requests.length;
  assert.match(await (await worker.request("./", true)).text(), /main\.1\.js/);
  await worker.message("NB_PRIME_OFFLINE");
  assert.equal(env.requests.length, before);
  env.offline = true;
  assert.match(await (await env.worker().request("./", true)).text(), /main\.1\.js/);
});

test("successful update selects the new snapshot while open old tabs can still load their chunks", async () => {
  const env = setup();
  const worker = env.worker();
  await worker.install();
  env.release = 2;
  assert.equal((await worker.message("NB_FORCE_UPDATE")).ok, true);
  env.offline = true;
  const restarted = env.worker();
  assert.match(await (await restarted.request("./", true)).text(), /main\.2\.js/);
  assert.equal(await (await restarted.request("./static/js/pdf.1.js")).text(), "asset-1");
  assert.equal(await (await restarted.request("./static/js/pdf.2.js")).text(), "asset-2");
});

test("a deployment change during download cannot publish a mixed version", async () => {
  const env = setup();
  const worker = env.worker();
  await worker.install();
  env.release = 2;
  env.changeDuringDownload = true;
  assert.equal((await worker.message("NB_FORCE_UPDATE")).ok, false);
  assert.equal((await worker.message("NB_OFFLINE_STATUS")).version.buildId, "release-1");
});

test("network errors and version queries cannot poison the offline cache", async () => {
  const env = setup();
  const worker = env.worker();
  await worker.install();
  env.blocked = "extra.js";
  assert.equal((await worker.request("./static/js/extra.js")).status, 503);
  env.blocked = "";
  assert.equal((await worker.request("./static/js/extra.js")).status, 200);
  env.release = 2;
  assert.equal((await (await worker.request("./app-version.json?__nb_update=1")).json()).buildId, "release-2");
  assert.equal((await (await worker.request("./app-version.json")).json()).buildId, "release-1");
});

test("a failed automatic worker installation leaves the active release available", async () => {
  const env = setup();
  await env.worker().install();
  env.release = 2;
  env.blocked = "pdf.2.js";
  const installing = env.worker();
  await assert.rejects(installing.install(), /Offline-Datei/);
  assert.equal(installing.skipped, false);
  env.offline = true;
  const restarted = env.worker();
  assert.match(await (await restarted.request("./", true)).text(), /main\.1\.js/);
  assert.equal((await restarted.message("NB_OFFLINE_STATUS")).ok, true);
});

test("readiness detects missing assets instead of reporting an incomplete package as ready", async () => {
  const env = setup();
  const worker = env.worker();
  await worker.install();
  for (const store of env.stores.values()) store.delete(absolute("./static/js/pdf.1.js"));
  const status = await worker.message("NB_OFFLINE_STATUS");
  assert.equal(status.ok, false);
  assert.equal(status.missing[0], absolute("./static/js/pdf.1.js"));
});
