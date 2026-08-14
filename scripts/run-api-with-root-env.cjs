const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const apiScript = process.argv[2];
if (!apiScript) {
  console.error("Usage: node scripts/run-api-with-root-env.cjs <api-script> [...args]");
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");
const loadedEnv = {};

if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) loadedEnv[key] = value;
  }
}

const extraArgs = process.argv.slice(3);
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error("Unable to locate the npm CLI entrypoint from npm_execpath.");
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [npmExecPath, "run", apiScript, "-w", "@store-rental/api", ...(extraArgs.length ? ["--", ...extraArgs] : [])],
  {
    cwd: rootDir,
    env: { ...loadedEnv, ...process.env },
    stdio: "inherit"
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
