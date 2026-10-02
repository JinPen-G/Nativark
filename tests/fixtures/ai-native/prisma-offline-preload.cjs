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
for (const name of ["readFileSync", "readFile", "openSync", "open", "createReadStream"]) {
  const original = fs[name];
  fs[name] = function(file, ...args) { guard(file); return original.call(this, file, ...args); };
}
for (const name of ["readFile", "open"]) {
  const original = fs.promises[name];
  fs.promises[name] = function(file, ...args) { guard(file); return original.call(this, file, ...args); };
}
