"use strict";

/** OPS-01B：构建产物收集与来源证明的共用文件系统层。 */

const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./runtime.cjs");
const { digestFiles } = require("./release-facts.cjs");

const ARTIFACT_DIR = process.env.OPS_ARTIFACT_DIR || path.join(ROOT, "artifacts", "release");
const BUILD_PROVENANCE_FILE = path.join(ARTIFACT_DIR, "build-provenance.json");
const BUILD_TARGETS = [
  { name: "@store-rental/api", dir: path.join(ROOT, "apps", "api", "dist") },
  { name: "@store-rental/admin", dir: path.join(ROOT, "apps", "admin", "dist") },
  { name: "@store-rental/shared", dir: path.join(ROOT, "packages", "shared", "dist") }
];

function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    files.push({ path: path.relative(ROOT, full), bytes: fs.statSync(full).size, contents: fs.readFileSync(full) });
  }
  return files;
}

function summarizeBuilds() {
  return BUILD_TARGETS.map((target) => {
    const digest = digestFiles(collectFiles(target.dir));
    return { name: target.name, dir: path.relative(ROOT, target.dir), ...digest };
  });
}

function readBuildProvenance() {
  if (!fs.existsSync(BUILD_PROVENANCE_FILE)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(BUILD_PROVENANCE_FILE, "utf8"));
  } catch {
    return undefined;
  }
}

module.exports = {
  ARTIFACT_DIR,
  BUILD_PROVENANCE_FILE,
  BUILD_TARGETS,
  collectFiles,
  summarizeBuilds,
  readBuildProvenance
};
