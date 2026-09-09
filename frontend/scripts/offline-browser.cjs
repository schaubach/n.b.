// Run after npm run build. Set PLAYWRIGHT_MODULE to an existing Playwright installation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { jsPDF } = require("jspdf");

const root = path.resolve(__dirname, "..");
const build = path.join(root, "build");
const buildVersion = JSON.parse(fs.readFileSync(path.join(build, "app-version.json"))).version;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nb-offline-browser-"));
const profile = path.join(work, "profile");
let failedUpdate = false;
let context;
const failures = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const relative = decodeURIComponent(url.pathname).replace(/^\/installwebapp\//, "") || "index.html";
  if (!url.pathname.startsWith("/installwebapp/") || relative.includes("..")) { response.writeHead(404).end(); return; }
  if (relative === "missing.chunk.js") { response.writeHead(503).end(); return; }
  const file = path.join(build, relative);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
  let bytes = fs.readFileSync(file);
  if (failedUpdate && relative === "asset-manifest.json") {
    const manifest = JSON.parse(bytes);
    manifest.files.missing = "./missing.chunk.js";
    bytes = Buffer.from(JSON.stringify(manifest));
  }
  const types = { ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css", ".jpeg": "image/jpeg", ".csv": "text/csv", ".svg": "image/svg+xml" };
  response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  response.end(bytes);
});

async function workerMessage(page, type) {
  return page.evaluate((messageType) => new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("Worker timeout")), 45000);
    channel.port1.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); channel.port1.close(); };
    navigator.serviceWorker.controller.postMessage({ type: messageType }, [channel.port2]);
  }), type);
}

async function launch(offline = false) {
  context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1024, height: 1366 }, acceptDownloads: true, offline });
  const page = context.pages()[0];
  page.on("pageerror", (error) => failures.push(error.message));
  return page;
}

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/installwebapp/index.html?source=pwa`;
  let page = await launch();
  await page.goto(url);
  await page.getByText("Offline bereit:", { exact: false }).waitFor({ timeout: 45000 });
  assert.equal((await workerMessage(page, "NB_OFFLINE_STATUS")).ok, true);
  await page.getByLabel("Passwort", { exact: true }).fill("offline-test-vault");
  await page.getByLabel("Passwort wiederholen").fill("offline-test-vault");
  await page.getByRole("button", { name: "Lokalen Tresor erstellen" }).click();
  await page.getByTestId("import-button").waitFor();
  // Seed only synthetic records through the same on-disk encryption format.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("nb-local-vault", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const get = (store, key) => new Promise((resolve) => { db.transaction(store).objectStore(store).get(key).onsuccess = (event) => resolve(event.target.result); });
    const decode = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    const encode = (bytes) => btoa(String.fromCharCode(...bytes));
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode("offline-test-vault"), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: decode(await get("meta", "salt")), iterations: await get("meta", "iterations"), hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const box = await get("data", "state");
    const state = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(box.iv) }, key, decode(box.data))));
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
    const photo = canvas.toDataURL("image/jpeg");
    state.classes = [{ id: "offline-class", name: "Offline-Testklasse", grade_system: "grades_1_6", grade_scale_id: "MEDA" }];
    state.students = [{ id: "ada", class_id: "offline-class", first_name: "Ada", last_name: "Alpha", photo }];
    state.sessions = [{ id: "test-ka", class_id: "offline-class", title: "Testarbeit", category: "klausur", date: "09.09.2026", weight: 1 }];
    state.grades = [{ session_id: "test-ka", student_id: "ada", value: "2" }];
    state.teacher_config = { name: "Testlehrkraft", email: "test@example.invalid", password: "offline-test-iserv", backup_interval_days: 7, mail_backend_pre_shared_key: "test-psk", backend_identity_public_key: "test-public-key" };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(state)));
    await new Promise((resolve, reject) => {
      const tx = db.transaction("data", "readwrite");
      tx.objectStore("data").put({ iv: encode(iv), data: encode(new Uint8Array(encrypted)) }, "state");
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  failedUpdate = true;
  const rejected = await workerMessage(page, "NB_FORCE_UPDATE");
  assert.equal(rejected.ok, false);
  assert.equal((await workerMessage(page, "NB_OFFLINE_STATUS")).ok, true);
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  page = await launch(true);
  const start = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.getByRole("button", { name: "Entsperren", exact: true }).waitFor();
  console.log("Cold restart with server stopped:", Date.now() - start, "ms");
  await page.getByLabel("Passwort", { exact: true }).fill("offline-test-vault");
  await page.getByRole("button", { name: "Entsperren", exact: true }).click();
  await page.getByText("Offline-Testklasse", { exact: true }).waitFor();
  await page.getByTestId("gradebook-class-offline-class").click();
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).filter({ visible: true }).click();
  const pdf = await pdfDownload;
  const pdfPath = path.join(work, "gradebook.pdf");
  await pdf.saveAs(pdfPath);
  assert.equal(fs.readFileSync(pdfPath).subarray(0, 5).toString(), "%PDF-");
  await page.getByRole("button", { name: "Schliessen", exact: true }).click();
  await page.getByTestId("class-menu-offline-class").click();
  await page.getByTestId("seat-plan-class-offline-class").click();
  const seatPdf = new jsPDF();
  seatPdf.rect(20, 20, 60, 30); seatPdf.text("Ada Alpha", 25, 35);
  await page.locator('input[type="file"]').setInputFiles({ name: "seating.pdf", mimeType: "application/pdf", buffer: Buffer.from(seatPdf.output("arraybuffer")) });
  await page.getByText(/1 aktive Namen wurden/).waitFor({ timeout: 20000 });
  await page.goto(url);
  await page.getByLabel("Passwort", { exact: true }).fill("offline-test-vault");
  await page.getByRole("button", { name: "Entsperren", exact: true }).click();
  const zipDownload = page.waitForEvent("download");
  await page.getByTestId("home-backup-button").click();
  const zip = await zipDownload;
  const zipPath = path.join(work, "backup.zip");
  await zip.saveAs(zipPath);
  const files = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  assert.match(files, /images\/ada.jpg/);
  assert.match(files, /notenstand\//);
  assert.match(execFileSync("unzip", ["-P", "offline-test-iserv", "-p", zipPath, "data/state.csv"], { encoding: "utf8" }), /Offline-Testklasse/);
  await page.getByTestId("rename-class-offline-class").click();
  await page.getByLabel("Neuer Name", { exact: true }).fill("Geaendert nach Backup");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.getByText("Geaendert nach Backup", { exact: true }).waitFor();
  await page.getByTestId("teacher-config-button").click();
  page.on("dialog", (dialog) => dialog.accept());
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Credentials speichern", exact: true }).click();
  const json = await jsonDownload;
  const jsonPath = path.join(work, "credentials.json");
  await json.saveAs(jsonPath);
  assert.equal(JSON.parse(fs.readFileSync(jsonPath)).teacher.password, "offline-test-iserv");
  const config = page.getByTestId("teacher-config-modal");
  await config.getByText("Lokal: " + buildVersion, { exact: false }).waitFor();
  await config.getByText("Offline bereit:", { exact: false }).waitFor();
  await config.screenshot({ path: path.join(work, "offline-config.png") });
  await config.locator('input[type="file"]:not([accept])').setInputFiles(zipPath);
  await page.getByRole("button", { name: "Entsperren", exact: true }).waitFor({ timeout: 15000 });
  await page.getByLabel("Passwort", { exact: true }).fill("offline-test-vault");
  await page.getByRole("button", { name: "Entsperren", exact: true }).click();
  await page.getByText("Offline-Testklasse", { exact: true }).waitFor();
  assert.equal(await page.getByText("Geaendert nach Backup", { exact: true }).count(), 0);
  await page.getByTestId("gradebook-class-offline-class").click();
  await page.getByText("Ada Alpha", { exact: true }).waitFor();
  assert.match(await page.getByTestId("gradebook-modal").locator("tbody").innerText(), /2/);
  await page.getByTestId("gradebook-modal").screenshot({ path: path.join(work, "offline-grades.png") });
  await page.getByRole("button", { name: "Schliessen", exact: true }).click();
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-testid="class-card-offline-class"]');
    return card && Number(getComputedStyle(card).opacity) === 1;
  });
  await page.screenshot({ path: path.join(work, "offline-restored.png") });
  assert.deepEqual(failures, []);
  console.log("PASS: offline restart, unlock, grades, PDF download, seating PDF import, encrypted backup with photos, credentials export, backup restore");
  console.log("Test artifacts:", work);
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close();
  server.close();
});
