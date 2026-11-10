"use strict";
/** Build a precompiled Bundle in a new directory; never install, publish or start a Host. */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire, isBuiltin } = require("node:module");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const pluginRoot = path.resolve(__dirname, "..");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");

function packageLocation(resolver, name) {
  try { return resolver.resolve(`${name}/package.json`); }
  catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    // Read the entry's owning manifest when the dependency does not export package.json.
    let directory = path.dirname(resolver.resolve(name));
    while (true) {
      const candidate = path.join(directory, "package.json");
      if (fs.existsSync(candidate) && readJson(candidate).name === name) return candidate;
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`Missing package manifest: ${name}`);
      directory = parent;
    }
  }
}

function resolveToolchain(manifest, harnessRoot) {
  // Explicit existing-Harness mode reads installed declarations; the archive never imports that checkout.
  const anchors = harnessRoot ? [
    "apps/cli/package.json", "packages/interaction/commands/package.json",
    "packages/mcp/mcp-client/package.json", "packages/bundle/web-app/package.json",
    "packages/bundle/base/package.json",
  ].map(file => path.join(path.resolve(harnessRoot), file)) : [path.join(pluginRoot, "package.json")];
  const resolvers = anchors.map(file => createRequire(file));
  const locate = name => {
    for (const resolver of resolvers) {
      try { return packageLocation(resolver, name); }
      catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
    }
    throw new Error(`Install the declared build dependency in an authorized environment: ${name}`);
  };
  const versions = {}, paths = {};
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    const file = locate(name), dependency = readJson(file);
    if (dependency.version !== version) throw new Error(`Build dependency version mismatch: ${name}`);
    const entry = dependency.exports?.["."] ?? dependency.exports;
    const types = entry?.import?.types ?? entry?.types ?? dependency.types;
    if (typeof types !== "string" || !fs.existsSync(path.resolve(path.dirname(file), types))) {
      throw new Error(`Missing installed declarations: ${name}`);
    }
    paths[name] = [path.resolve(path.dirname(file), types)];
    versions[name] = dependency.version;
  }
  const compiler = locate("typescript"), nodeTypes = locate("@types/node");
  for (const file of [compiler, nodeTypes]) {
    const dependency = readJson(file);
    if (dependency.version !== manifest.devDependencies[dependency.name]) {
      throw new Error(`Build dependency version mismatch: ${dependency.name}`);
    }
    versions[dependency.name] = dependency.version;
  }
  return { ts: require(path.dirname(compiler)), paths, versions, typeRoots: [path.dirname(path.dirname(nodeTypes))] };
}

/** Build and pack current sources without scripts; failures retain diagnostics and partial output. */
async function buildBundle({ outputDir, harnessRoot, npmCli }) {
  if (!outputDir || !npmCli) throw new Error("Bundle build requires outputDir and the installed npm CLI path");
  const manifest = readJson(path.join(pluginRoot, "package.json"));
  const tools = resolveToolchain(manifest, harnessRoot), { ts } = tools;
  const sourceNames = ["package.json", "tsconfig.json", "cordis.patch.yml", "README.md", "scripts/build-bundle.cjs",
    ...fs.readdirSync(path.join(pluginRoot, "src")).filter(name => name.endsWith(".ts")).sort().map(name => `src/${name}`)];
  const before = Object.fromEntries(sourceNames.map(name => [name, hash(fs.readFileSync(path.join(pluginRoot, name)))]));
  outputDir = path.resolve(outputDir);
  fs.mkdirSync(outputDir); // Exclusive ownership: never reuse or overwrite an existing delivery directory.
  const staged = path.join(outputDir, "package");
  fs.mkdirSync(staged);
  for (const file of ["package.json", "cordis.patch.yml", "README.md"]) {
    fs.copyFileSync(path.join(pluginRoot, file), path.join(staged, file));
  }
  const parsed = ts.readConfigFile(path.join(pluginRoot, "tsconfig.json"), ts.sys.readFile);
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, pluginRoot);
  const program = ts.createProgram(config.fileNames, {
    ...config.options, outDir: path.join(staged, "dist"), noEmitOnError: true,
    paths: tools.paths, typeRoots: tools.typeRoots,
  });
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw new Error(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => pluginRoot, getNewLine: () => "\n",
  }));
  const emitted = program.emit();
  if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error("Bundle compilation did not finish");
  const emittedFiles = fs.readdirSync(path.join(staged, "dist")).sort();
  const declared = new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.peerDependencies)]);
  for (const name of emittedFiles) {
    const file = path.join(staged, "dist", name);
    if (!fs.statSync(file).isFile() || !/\.(?:js|d\.ts)$/.test(name)) throw new Error(`Unexpected emitted file: ${name}`);
    for (const imported of ts.preProcessFile(fs.readFileSync(file, "utf8"), true, true).importedFiles) {
      const specifier = imported.fileName;
      if (isBuiltin(specifier)) continue;
      if (specifier.startsWith("./")) {
        if (specifier.includes("..") || !/\.js$/.test(specifier)) throw new Error(`Non-package import in ${name}`);
        const target = specifier.slice(2).replace(/\.js$/, name.endsWith(".d.ts") ? ".d.ts" : ".js");
        if (!emittedFiles.includes(target)) throw new Error(`Missing bundled import in ${name}: ${specifier}`);
      } else if (!declared.has(specifier)) throw new Error(`Undeclared external import in ${name}: ${specifier}`);
    }
  }
  for (const [name, expected] of Object.entries(before)) {
    if (hash(fs.readFileSync(path.join(pluginRoot, name))) !== expected) throw new Error(`Source changed during compilation: ${name}`);
  }
  const packed = spawnSync(process.execPath, [path.resolve(npmCli), "pack", staged,
    "--offline", "--ignore-scripts", "--json", "--workspaces=false", "--audit=false", "--fund=false",
    "--pack-destination", outputDir], { cwd: outputDir, encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576 });
  fs.writeFileSync(path.join(outputDir, "pack.log"), JSON.stringify({
    status: packed.status, signal: packed.signal, error: packed.error?.message,
    stdout: packed.stdout, stderr: packed.stderr,
  }, null, 2) + "\n", { flag: "wx" });
  if (packed.error || packed.signal || packed.status !== 0) throw new Error("Bundle pack failed; inspect pack.log");
  const reports = JSON.parse(packed.stdout);
  if (!Array.isArray(reports) || reports.length !== 1) throw new Error("Unexpected npm pack report");
  const report = reports[0];
  const expectedName = `${manifest.name.replace(/^@/, "").replace(/\//g, "-")}-${manifest.version}.tgz`;
  if (report.filename !== expectedName) throw new Error("Unexpected Bundle archive name");
  const files = ["package.json", "cordis.patch.yml", "README.md", ...emittedFiles.map(name => `dist/${name}`)].sort();
  const packedFiles = report.files.map(file => file.path).sort();
  if (JSON.stringify(packedFiles) !== JSON.stringify(files)) throw new Error("Bundle archive file set does not match the precompiled package");
  const exportFiles = value => typeof value === "string" ? [value] : Object.values(value).flatMap(exportFiles);
  for (const file of [manifest.main, manifest.types, manifest.dsh.bundle.patch, ...exportFiles(manifest.exports)]) {
    if (!file.startsWith("./") || !files.includes(file.slice(2))) throw new Error(`Missing published entry: ${file}`);
  }
  const tarball = path.join(outputDir, expectedName), archive = fs.readFileSync(tarball);
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (report.integrity !== integrity) throw new Error("Bundle archive integrity does not match npm pack");
  const result = {
    name: manifest.name, version: manifest.version, hostVersion: manifest.engines.dsh,
    tarball: expectedName, sha256: hash(archive), integrity,
    sourceHashes: before, buildDependencies: tools.versions, files,
    verification: "strict compilation and npm pack only; no profile installation or real service verification",
  };
  fs.writeFileSync(path.join(outputDir, "bundle-manifest.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  return { ...result, tarball };
}

module.exports = { buildBundle };
if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  const fields = { "--out": "outputDir", "--harness-root": "harnessRoot", "--npm-cli": "npmCli" };
  for (let index = 0; index < args.length; index += 2) {
    const field = fields[args[index]];
    if (!field || !args[index + 1] || options[field]) throw new Error("Use --out <new-directory> [--harness-root <existing-checkout>] --npm-cli <installed-npm-cli.js>");
    options[field] = args[index + 1];
  }
  buildBundle(options).then(result => console.log(JSON.stringify(result)), error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
