"use strict";

/** OPS-01B：构建产物收集与来源证明的共用文件系统层。 */

const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./runtime.cjs");
const { digestFiles } = require("./release-facts.cjs");

const ARTIFACT_DIR = process.env.OPS_ARTIFACT_DIR || path.join(ROOT, "artifacts", "release");
const BUILD_PROVENANCE_FILE = path.join(ARTIFACT_DIR, "build-provenance.json");
const BUILD_TARGETS = [
  { name: "@rental-os/api", dir: path.join(ROOT, "apps", "api", "dist") },
  { name: "@rental-os/admin", dir: path.join(ROOT, "apps", "admin", "dist") },
  { name: "@rental-os/shared", dir: path.join(ROOT, "packages", "shared", "dist") },
  { name: "config", dir: path.join(ROOT, "config"), files: ["environment.cjs", "environment.d.cts"] }
];

function collectFiles(dir, requiredFiles) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const paths = requiredFiles
    ? requiredFiles.map(name => path.join(dir, name))
    : fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
  if (requiredFiles && paths.some(file => !fs.existsSync(file))) return [];
  for (const full of paths) {
    files.push({ path: path.relative(ROOT, full), bytes: fs.statSync(full).size, contents: fs.readFileSync(full) });
  }
  return files;
}

function summarizeBuilds() {
  return BUILD_TARGETS.map((target) => {
    const digest = digestFiles(collectFiles(target.dir, target.files));
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
