"use strict";
// Development-only: generate a worktree-owned client without .env, DB, network or shared writes.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = fs.realpathSync(path.resolve(__dirname, ".."));
const markerName = ".rental-ai-client-owner.json";
const requiredFiles = ["index.js", "index.d.ts", "default.js", "default.d.ts", "package.json", "schema.prisma"];
const completeClient = directory => requiredFiles.every(file => fs.existsSync(path.join(directory, file)));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const inside = (base, candidate) => { const rel = path.relative(base, candidate); return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
function requireOwnedPath(target) {
  let existing = target;
  while (!fs.existsSync(existing)) {
    if (path.dirname(existing) === existing) throw new Error("No owned ancestor for client path");
    existing = path.dirname(existing);
  }
  if (!inside(root, fs.realpathSync(existing))) throw new Error("Refusing a shared client path");
}
function fingerprints(directory) {
  const result = {};
  const visit = (current, prefix) => {
    for (const name of fs.readdirSync(current).sort()) {
      if (name === markerName) continue;
      if (/^\.env(?:\.|$)/iu.test(name)) throw new Error("Unexpected env file in generated client");
      const file = path.join(current, name), key = `${prefix}${name}`, stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) result[key] = `link:${fs.readlinkSync(file)}`;
      else if (stat.isDirectory()) visit(file, `${key}/`);
      else if (stat.isFile()) result[key] = hash(fs.readFileSync(file));
      else throw new Error("Unexpected generated client file type");
    }
  };
  visit(directory, "");
  return result;
}
function removeOwnedDirectory(directory) {
  if (fs.lstatSync(directory).isSymbolicLink()) return false;
  let retained = false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    // The unchanged write guard resolves junction targets, so leave links in place.
    if (entry.isSymbolicLink()) retained = true;
    else if (entry.isDirectory()) { if (!removeOwnedDirectory(file)) retained = true; }
    else fs.unlinkSync(file);
  }
  if (retained) return false;
  fs.rmdirSync(directory);
  if (fs.existsSync(directory)) throw new Error("Owned directory cleanup failed");
  return true;
}
function copyClientContents(source, destination, top = true) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (top && entry.name === "runtime") continue;
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Unexpected symlink inside generated client");
    const stat = fs.statSync(from);
    if (stat.isDirectory()) { fs.mkdirSync(to); copyClientContents(from, to, false); }
    else if (stat.isFile()) fs.copyFileSync(from, to);
    else throw new Error("Unsupported generated client entry");
  }
}
function generateLocalAiPrismaClient() {
  if (!fs.lstatSync(path.join(root, ".git")).isFile()) throw new Error("Run only in an isolated git worktree");
  const schema = fs.readFileSync(path.join(root, "apps/api/prisma/schema.prisma"), "utf8");
  const sourceHash = hash(schema.replace(/\r\n/gu, "\n"));
  const version = require("prisma/package.json").version;
  const sharedModules = path.dirname(path.dirname(require.resolve("prisma/package.json")));
  const runtime = fs.realpathSync(path.join(sharedModules, "@prisma/client/runtime"));
  const target = path.join(root, "apps/api/node_modules/@prisma/client"), parent = path.dirname(target);
  requireOwnedPath(parent); fs.mkdirSync(parent, { recursive: true }); requireOwnedPath(parent);
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error("Refusing to replace a client symlink");
    requireOwnedPath(target);
    const ownerFile = path.join(target, markerName);
    if (!fs.existsSync(ownerFile)) throw new Error("Existing client is not owned by this generator");
    const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    if (owner.worktree !== root || JSON.stringify(owner.files) !== JSON.stringify(fingerprints(target))) throw new Error("Owned client has external modifications; preserving it");
    if (owner.generatorFormat === 2 && owner.schemaHash === sourceHash && owner.generatorVersion === version && completeClient(target)) return { generated: false, target, schemaHash: sourceHash };
  }
  const lock = path.join(parent, ".ai-client-generation.lock"), token = crypto.randomUUID();
  const fd = fs.openSync(lock, "wx"); fs.writeFileSync(fd, token); fs.closeSync(fd);
  let temporary, staged, backup;
  const cleanupRetained = [];
  try {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "rental-os-ai-client-"));
    const generated = path.join(temporary, "generated"), audit = path.join(temporary, "audit.log");
    const match = schema.match(/^generator client \{[\s\S]*?^\}/mu);
    if (!match || !/provider\s*=\s*"prisma-client-js"/u.test(match[0]) || /\boutput\s*=/u.test(match[0])) throw new Error("Unexpected client generator definition");
    const isolated = schema.replace(match[0], match[0].replace(/\}$/u, '  output = "./generated"\n}'));
    fs.writeFileSync(path.join(temporary, "schema.prisma"), isolated);
    fs.writeFileSync(path.join(temporary, "package.json"), JSON.stringify({ private: true, dependencies: { "@prisma/client": version } }));
    fs.writeFileSync(audit, "");
    // Prisma writes generator cache beside its package. Copy its toolchain rather than
    // pointing a mutable node_modules/.cache at the shared checkout.
    const modules = path.join(temporary, "node_modules"); fs.mkdirSync(modules);
    for (const name of ["prisma", "@prisma"]) fs.cpSync(path.join(sharedModules, name), path.join(modules, name), {
      recursive: true, dereference: true, filter: file => !/^\.env(?:\.|$)/iu.test(path.basename(file))
    });
    for (const entry of fs.readdirSync(sharedModules, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "prisma" || entry.name === "@prisma" || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      fs.symlinkSync(path.join(sharedModules, entry.name), path.join(modules, entry.name), "junction");
    }
    const cli = path.join(modules, "prisma/build/index.js");
    const sharedFiles = [path.join(sharedModules, "@prisma/client/package.json"), path.join(sharedModules, ".prisma/client/index.js"), path.join(sharedModules, ".prisma/client/index.d.ts"), path.join(sharedModules, ".prisma/client/schema.prisma")];
    const sharedBefore = sharedFiles.map(file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null);
    const env = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]) if (process.env[key]) env[key] = process.env[key];
    const preload = path.join(root, "tests/fixtures/ai-native/prisma-offline-preload.cjs").replace(/\\/gu, "/");
    const childTemp = path.join(temporary, "tmp"); fs.mkdirSync(childTemp);
    Object.assign(env, { DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline", AI_OFFLINE_AUDIT: audit, AI_OFFLINE_WRITE_ROOT: temporary,
      HOME: temporary, USERPROFILE: temporary, APPDATA: temporary, LOCALAPPDATA: temporary, TEMP: childTemp, TMP: childTemp,
      NODE_OPTIONS: `--require "${preload}"`, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", PRISMA_DISABLE_TELEMETRY: "1", PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", NO_COLOR: "1" });
    const child = spawnSync(process.execPath, [cli, "generate", "--generator", "client", "--schema", "schema.prisma"], { cwd: temporary, env, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    const violations = fs.readFileSync(audit, "utf8");
    const sharedAfter = sharedFiles.map(file => fs.existsSync(file) ? hash(fs.readFileSync(file)) : null);
    if (JSON.stringify(sharedBefore) !== JSON.stringify(sharedAfter)) throw new Error("Shared Prisma artifacts changed; no client installed");
    if (violations || child.error || child.status !== 0) throw new Error(`Isolated generation failed: ${violations}\n${child.error?.message || child.stderr || child.stdout}`);
    if (/Environment variables loaded/iu.test(child.stdout)) throw new Error("Unexpected env loading");
    if (!completeClient(generated)) throw new Error(`Generator produced an incomplete client: ${fs.readdirSync(generated).join(",")}`);
    staged = fs.mkdtempSync(path.join(parent, ".ai-client-stage-"));
    // Materialize contents before linking runtime; never preserve a generator cache link.
    copyClientContents(generated, staged);
    if (!completeClient(staged)) throw new Error(`Client copy incomplete; source=${fs.readdirSync(generated).join(",")}; staged=${fs.readdirSync(staged).join(",")}`);
    const stagedRuntime = path.join(staged, "runtime");
    fs.symlinkSync(runtime, stagedRuntime, "junction");
    if (!completeClient(staged)) throw new Error("Runtime link changed client contents");
    const declarations = fs.readFileSync(path.join(staged, "index.d.ts"), "utf8");
    if (!["AiTaskDelegate", "AiRunDelegate", "AiApprovalDelegate", "RentalCategoryVersionDelegate"].every(name => declarations.includes(name))) throw new Error("Generated model declarations are incomplete");
    fs.writeFileSync(path.join(staged, markerName), JSON.stringify({ worktree: root, schemaHash: sourceHash, generatorVersion: version, generatorFormat: 2, files: fingerprints(staged) }, null, 2));
    if (fs.existsSync(target)) {
      const owner = JSON.parse(fs.readFileSync(path.join(target, markerName), "utf8"));
      if (owner.worktree !== root || JSON.stringify(owner.files) !== JSON.stringify(fingerprints(target))) throw new Error("Client changed during generation");
      backup = `${target}.previous-${token}`; fs.renameSync(target, backup);
    }
    fs.renameSync(staged, target); staged = undefined;
    if (!completeClient(target)) throw new Error("Installed client is incomplete");
    if (backup) { if (!removeOwnedDirectory(backup)) cleanupRetained.push(backup); backup = undefined; }
    return { generated: true, target, schemaHash: sourceHash, guardViolations: 0, sharedArtifactsUnchanged: true, cleanupRetained };
  } catch (error) {
    if (backup && !fs.existsSync(target)) { fs.renameSync(backup, target); backup = undefined; }
    throw error;
  } finally {
    try {
      if (staged && !removeOwnedDirectory(staged)) cleanupRetained.push(staged);
      if (temporary && !removeOwnedDirectory(temporary)) cleanupRetained.push(temporary);
    } finally {
      if (fs.existsSync(lock) && fs.readFileSync(lock, "utf8") === token) fs.unlinkSync(lock);
    }
  }
}
if (require.main === module) {
  try { console.log(JSON.stringify(generateLocalAiPrismaClient(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { generateLocalAiPrismaClient };
