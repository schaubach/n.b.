const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));

function run(command) {
  try {
    return execSync(command, { cwd: path.resolve(root, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch (error) {
    return "";
  }
}

const gitSha = process.env.REACT_APP_GIT_SHA || run("git rev-parse --short=12 HEAD") || "unknown";
const builtAt = new Date().toISOString();
const version = {
  app: "n.b.",
  version: pkg.version || "0.0.0",
  gitSha,
  builtAt,
  buildId: `${pkg.version || "0.0.0"}-${gitSha}-${builtAt}`,
};

fs.writeFileSync(path.join(root, "public", "app-version.json"), JSON.stringify(version, null, 2) + "\n");
console.log(`Wrote app-version.json (${version.buildId})`);
