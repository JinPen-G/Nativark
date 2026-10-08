"use strict";
// Preload only in the short-lived Prisma CLI used by offline schema tests.
const fs = require("node:fs"), path = require("node:path"), dns = require("node:dns"), net = require("node:net"), { fileURLToPath } = require("node:url");
const append = fs.appendFileSync.bind(fs);
const audit = kind => { append(process.env.AI_OFFLINE_AUDIT, `${kind}\n`); throw new Error(`Offline Prisma refused ${kind}`); };
net.Socket.prototype.connect = () => audit("network");
globalThis.fetch = () => audit("fetch");
for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) {
  dns[name] = () => audit("dns");
  dns.promises[name] = () => audit("dns");
}
const guard = value => {
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string" && /^\.env(?:\.|$)/iu.test(path.basename(value))) audit("env-file-read");
};
const writeRoot = process.env.AI_OFFLINE_WRITE_ROOT;
const guardWrite = value => {
  if (!writeRoot || typeof value === "number") return;
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") return audit("unknown-write-target");
  let ancestor = path.resolve(value);
  while (true) {
    try { fs.lstatSync(ancestor); break; }
    catch (error) {
      if (error.code !== "ENOENT" || path.dirname(ancestor) === ancestor) return audit("unknown-write-target");
      ancestor = path.dirname(ancestor);
    }
  }
  let real;
  try { real = fs.realpathSync(ancestor); } catch { return audit("unresolved-write-target"); }
  const relative = path.relative(fs.realpathSync(writeRoot), real);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) audit(`write-outside-temp:${real}`);
};
const writingFlags = flags => typeof flags === "string" ? /[wa+]/u.test(flags)
  : typeof flags === "number" && !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
for (const name of ["readFileSync", "readFile", "openSync", "open", "createReadStream"]) {
  const original = fs[name];
  fs[name] = function(file, ...args) {
    guard(file);
    if ((name === "open" || name === "openSync") && writingFlags(args[0])) guardWrite(file);
    return original.call(this, file, ...args);
  };
}
for (const name of ["readFile", "open"]) {
  const original = fs.promises[name];
  fs.promises[name] = function(file, ...args) {
    guard(file);
    if (name === "open" && writingFlags(args[0])) guardWrite(file);
    return original.call(this, file, ...args);
  };
}
for (const owner of [fs, fs.promises]) {
  for (const name of ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "mkdir", "mkdirSync", "unlink", "unlinkSync", "rm", "rmSync", "rmdir", "rmdirSync", "createWriteStream", "chmod", "chmodSync", "utimes", "utimesSync"]) {
    if (typeof owner[name] !== "function") continue;
    const original = owner[name];
    owner[name] = function(file, ...args) { guardWrite(file); return original.call(this, file, ...args); };
  }
  for (const name of ["rename", "renameSync", "copyFile", "copyFileSync", "cp", "cpSync", "symlink", "symlinkSync", "link", "linkSync"]) {
    if (typeof owner[name] !== "function") continue;
    const original = owner[name];
    owner[name] = function(source, destination, ...args) {
      if (name.startsWith("rename") || name === "link" || name === "linkSync") guardWrite(source);
      guardWrite(destination);
      return original.call(this, source, destination, ...args);
    };
  }
}
