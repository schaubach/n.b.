const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "build/app-version.json"), "utf8"));
const file = path.join(root, "build/sw.js");
const worker = fs.readFileSync(file, "utf8");
if (!worker.includes('"__NB_WORKER_BUILD__"')) throw new Error("Service-Worker build marker missing.");
// A changed worker triggers the browser's normal update lifecycle for each build.
fs.writeFileSync(file, worker.replace('"__NB_WORKER_BUILD__"', JSON.stringify(version.buildId)));
console.log("Service Worker stamped: " + version.buildId);
