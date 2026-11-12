const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProjectEnvironment } = require("../config/environment.cjs");

const apiScript = process.argv[2];
if (!apiScript) {
  console.error("Usage: node scripts/run-api-with-root-env.cjs <api-script> [...args]");
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const loadedEnv = loadProjectEnvironment({ appDirectory: path.join(rootDir, "apps", "api"), mode: process.env.NODE_ENV });

const extraArgs = process.argv.slice(3);
const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error("Unable to locate the npm CLI entrypoint from npm_execpath.");
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [npmExecPath, "run", apiScript, "-w", "@rental-os/api", ...(extraArgs.length ? ["--", ...extraArgs] : [])],
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
