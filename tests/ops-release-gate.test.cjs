const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * OPS-01B 专项：发布候选清单与只读门禁的契约。
 *
 * 行为层断言纯判定（环境变量名、产物指纹、工作区状态、敏感值拦截），
 * 源码层断言「门禁默认只读」这条最容易被后续改动破坏的性质：
 * 一旦有人在门禁里顺手加上 migrate deploy 或起服务，它就不再是门禁而是发布动作。
 */

const ROOT = path.resolve(__dirname, "..");
const facts = require(path.join(ROOT, "scripts/ops/release-facts.cjs"));
const artifacts = require(path.join(ROOT, "scripts/ops/release-artifacts.cjs"));
const { verifyPreparedRental, comparePreparedRental, verifyMcpSql, compareEntries } = require("../scripts/ops/release-composition.cjs");
const { verifyPairedBuildEvidence, reviewPairedUpdate } = require("../scripts/ops/release-build-evidence.cjs");
const { buildImagePair } = require("../scripts/ops/release-image-pair.cjs");

const ok = (m) => console.log(`  ✓ ${m}`);
const buf = (text) => Buffer.from(text, "utf8");

const json = value => buf(JSON.stringify(value));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const deploymentRoot = "apps/rental-api/prisma-deployment/";
const contextFile = "rental-host.context.json";
const buildFile = "rental-host.build-provenance.json";

function packReceipt(files, context) {
  context.files = [...files].filter(([file]) => file !== contextFile).map(([file, bytes]) => ({ file, sha256: hash(bytes) }));
  files.set(contextFile, json(context));
  return files;
}

function preparedFixture({ platformSha = "a".repeat(40), rentalSha = "b".repeat(40), profile = "host", projected = "a".repeat(64),
  dataVersion = "0.1.0", publicSql = "SELECT 0;", sql = "SELECT 1;", aiSql = "SELECT 3;", extra = false, ai = false, aiRelease = "0.1.1",
  mcp = false, mcpData = true } = {}) {
  const platformSource = { repository: "https://github.com/JinPen-G/Zelo", commit: platformSha };
  const rentalSource = { repository: "https://github.com/JinPen-G/nativark-rental-core", commit: rentalSha };
  const files = new Map();
  const describe = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });
  const readable = { minInclusive: "0.1.0", maxExclusive: "0.2.0" };
  const baseSchema = buf("platform schema fixture");
  const platform = { source: platformSource, versions: { platform: "0.1.0" }, sha256: "1".repeat(64),
    data: { version: "0.1.0", readable, migrations: [] } };
  const manifest = { id: "rental", version: "0.1.14", source: rentalSource, data: { version: dataVersion, readable, migrations: [] } };
  const core = { manifest, sha256: "2".repeat(64) };
  const migrations = [];
  function addMigration({ owner, source, sha256 }, data, id, original, directory, text, root) {
    const bytes = buf(text), file = describe(`migrations/${directory}/migration.sql`, bytes);
    files.set(deploymentRoot + file.path, bytes);
    files.set(root + original, bytes);
    data.migrations.push({ id, file: original, sha256: file.sha256 });
    migrations.push({ order: migrations.length, owner, source, assetSha256: sha256, id, originalPath: original,
      originalDirectory: path.posix.dirname(original), directory,
      ledger: { table: "_prisma_migrations", migrationName: directory, checksum: file.sha256 }, file });
  }
  addMigration({ owner: "platform", ...platform }, platform.data, "platform.foundation", "prisma/migrations/001_public/migration.sql",
    "001_public", publicSql, "apps/platform-api/");
  const rentalOwner = { owner: "rental", source: rentalSource, sha256: core.sha256 };
  addMigration(rentalOwner, manifest.data, "rental.initial", "prisma/migrations/001_rental/migration.sql",
    "core.rental.rental.initial", sql, "packages/rental-core/");
  if (extra) addMigration(rentalOwner, manifest.data, "rental.later", "prisma/migrations/002_rental/migration.sql",
    "core.rental.rental.later", "SELECT 2;", "packages/rental-core/");
  const capabilities = [];
  function lockDataPackage(release, root, schemaPath, entryNames, condition, exports = {}) {
    for (const name of entryNames) {
      const runtime = `dist/${name}.js`, types = `dist/${name}.d.ts`;
      files.set(root + runtime, buf("data module fixture"));
      files.set(root + types, buf("data types fixture"));
      exports[`./${name}`] = { [condition]: `./${runtime}`, types: `./${types}` };
    }
    files.set(root + "package.json", json({ name: `@rental-os/${root.split("/")[1]}`, version: release.version, license: "MIT", exports }));
    for (const file of ["README.md", "LICENSE", schemaPath]) files.set(root + file, buf(file));
    release.files = [...files].filter(([file]) => file.startsWith(root))
      .map(([file, bytes]) => ({ file: file.slice(root.length), sha256: hash(bytes) }));
    release.schema = release.files.find(item => item.file === schemaPath);
    capabilities.push(release);
  }
  if (ai) {
    const root = "packages/ai-native-data/", legacy = aiRelease === "0.1.1";
    const data = { version: legacy ? "0.1.0" : "0.2.0", readable, migrations: [] };
    const release = { id: "ai-native", source: platformSource, sha256: "3".repeat(64), version: aiRelease, data,
      prerequisites: { platform: readable, cores: [] } };
    const id = legacy ? "ai-native.initial" : "ai-native.20261126000000-public-initial";
    const original = legacy ? "prisma/migrations/001_ai/migration.sql" : "prisma-public/20261126000000-initial.sql";
    addMigration({ owner: "ai-native", ...release }, data, id, original, `platform-capability.${id}`, aiSql, root);
    if (!legacy) files.set(root + "prisma-public/provenance.json", json({ fixture: true }));
    lockDataPackage(release, root, legacy ? "prisma/schema.prisma" : "prisma-public/schema.prisma", legacy
      ? ["data", "prisma-schema", "preparation", "data-package", "mysql-data"]
      : ["public-data", "public-data-package", "public-mysql-data"], "default");
  }
  if (mcp && mcpData) {
    const root = "packages/mcp-server/", data = { version: "0.1.0", readable, migrations: [] };
    const release = { id: "mcp", source: platformSource, sha256: "5".repeat(64), version: "0.1.0", data,
      prerequisites: { platform: readable, cores: [] } };
    const names = ["oauth", "read-budget", "catalog-goal", "catalog-intent", "catalog-adoption"];
    const mcpSql = ["oauth-schema", "read-budget-schema", "catalog-goal-schema", "catalog-goal-intent-schema", "catalog-goal-adoption-schema"];
    for (const [index, name] of names.entries()) {
      const id = `mcp.000${index + 1}-${name}`;
      addMigration({ owner: "mcp", ...release }, data, id, `mysql-${mcpSql[index]}.sql`, `platform-capability.${id}`, `SELECT ${index};`, root);
    }
    files.set(root + "data-contribution.json", json({ formatVersion: 1, capabilityId: "mcp", owner: "platform-capability:mcp", provider: "mysql",
      sql: data.migrations.map(({ file, sha256 }) => ({ file, sha256, requires: [] })) }));
    lockDataPackage(release, root, "prisma/schema.prisma", ["data-capability", "mysql-data"], "import", { "./data-contribution.json": "./data-contribution.json" });
  }
  const lock = json({ lockVersion: 1, platform, cores: [core], dataCapabilities: capabilities });
  const schema = buf("prepared schema fixture"), migrationLock = buf('provider = "mysql"\n');
  const deployment = { format: "rental-host-deployment-provenance-1", state: "prepared", deployment: "pending",
    lock: describe("core.deployment.lock.json", lock), schema: describe("schema.prisma", schema),
    migrationLock: describe("migrations/migration_lock.toml", migrationLock), data: { platform, cores: [core], capabilities }, migrations };
  deployment.files = [deployment.lock, deployment.schema, deployment.migrationLock, ...migrations.map(item => item.file)];
  files.set(deploymentRoot + deployment.lock.path, lock);
  files.set(deploymentRoot + deployment.schema.path, schema);
  files.set(deploymentRoot + deployment.migrationLock.path, migrationLock);
  files.set("rental-host.deployment-provenance.json", json(deployment));
  const source = json({ format: "nativark-core-development-source-2", mode: "release", host: "rental", profile, coreIds: ["rental"], ai, mcp,
    platform: { source: platformSource, version: "0.1.0" }, core: { source: rentalSource, version: manifest.version, tag: `v${manifest.version}` },
    npmLocks: { platform: { path: "package-lock.json", bytes: 10, sha256: "4".repeat(64) }, rental: null,
      projected: { path: "package-lock.json", bytes: 20, sha256: projected } } });
  const entry = `apps/rental-api/${mcp ? "dist-mcp/mcp-main.js" : ai ? "dist-ai/ai-main.js" : "dist/main.js"}`;
  files.set("development.workspace.json", source);
  files.set("apps/platform-api/prisma/schema.prisma", baseSchema);
  files.set("packages/rental-core/core.manifest.json", json(manifest));
  files.set("Dockerfile", buf("packaged Dockerfile fixture"));
  files.set("package.json", json({ name: "rental-host-runtime" }));
  files.set("package-lock.json", json({ lockfileVersion: 3, packages: { "": {} } }));
  files.set("verify-runtime.cjs", buf("packaged verifier fixture"));
  files.set(entry, buf("api build fixture"));
  return packReceipt(files, { format: "rental-host-context-1", host: "rental", deployment: "pending", imageBuild: "not-run", entry,
    aiMode: ai ? "enabled" : "disabled", mcpMode: mcp ? "enabled" : "disabled",
    ...(mcp ? { mcpEntry: entry } : {}),
    sourceProvenance: { file: "development.workspace.json", sha256: hash(source) },
    deploymentProvenance: "rental-host.deployment-provenance.json", deploymentLockSha256: hash(lock),
    originalNpmLockSha256: projected, platformBuild: { sourceArchiveSha256: platform.sha256 }, coreSha256: core.sha256,
    ...(ai ? { aiDataSha256: capabilities[0].sha256 } : {}),
    clients: [{ directory: "apps/platform-api/generated/client", mode: "platform", schemaSha256: hash(baseSchema) },
      { directory: "apps/rental-api/generated/client", mode: ai ? "rental-ai" : "rental", schemaSha256: hash(schema) }] });
}

function verifyFixture(files) {
  return verifyPreparedRental(files, hash(files.get(contextFile)));
}

function fixedBuildFixture(edit = () => {}, { ai = false } = {}) {
  const files = preparedFixture({ ai });
  const context = JSON.parse(files.get(contextFile));
  const sourceFile = context.sourceProvenance.file;
  const source = JSON.parse(files.get(sourceFile));
  const lock = JSON.parse(files.get(deploymentRoot + "core.deployment.lock.json"));
  const configs = ["packages/platform-contracts/tsconfig.json", "packages/rental-core/tsconfig.contracts.json",
    "packages/shared/tsconfig.json", "packages/shared/tsconfig.agent-desktop.json", "packages/rental-core/tsconfig.json",
    ...(ai ? ["packages/ai-native-data/tsconfig.json"] : []), "apps/rental-api/tsconfig.json",
    ...(ai ? ["packages/ai-native-server/tsconfig.json", "apps/rental-api/tsconfig.ai.json"] : [])];
  const publicConfigs = ["packages/platform-contracts", "packages/core-contracts", "packages/core-host", "packages/platform-server",
    "packages/platform-core-host", "apps/platform-api"].map(directory => `${directory}/tsconfig.json`);
  const compiler = { version: "5.9.3", sha256: hash(buf("compiler fixture")) };
  const clients = context.clients.map(({ directory, mode, schemaSha256 }) => ({ host: directory.split("/")[1].replace("-api", ""),
    mode, schemaSha256, declarationsSha256: hash(buf(`declarations for ${mode}`)) }));
  source.files = [source.npmLocks.projected, ...[...new Set([...configs, ...publicConfigs])].map(path => ({ path, bytes: 2, sha256: hash(buf("{}")) }))];
  if (ai) source.files.push({ path: "packages/ai-native-data/package.json", bytes: 2, sha256: hash(buf("{}")) });
  files.set(sourceFile, json(source));
  context.sourceProvenance.sha256 = hash(files.get(sourceFile));
  const platformOutput = "apps/platform-api/dist/main.js";
  files.set(platformOutput, buf("public build fixture"));
  context.platformBuild = { ...context.platformBuild, release: lock.platform, compiler: { name: "typescript", ...compiler },
    client: { ...clients[0], generatedSchemaSha256: clients[0].schemaSha256 },
    projects: publicConfigs.map(project => ({ project, inputsSha256: hash(buf(`inputs for ${project}`)) })) };
  const proof = { format: "rental-host-fixed-build-1", sourceSha256: context.sourceProvenance.sha256, npmLockSha256: source.npmLocks.projected.sha256,
    platform: source.platform.source, rental: source.core.source, deploymentLockSha256: context.deploymentLockSha256, compiler, clients,
    projects: configs.map(config => ({ config, roots: 1, sourceFiles: 1, outputs: 2, diagnostics: 0 })),
    files: [platformOutput, context.entry].map(file => ({ file, sha256: hash(files.get(file)) })) };
  edit(proof, files);
  files.set(buildFile, json(proof));
  context.buildProvenance = { file: buildFile, sha256: hash(files.get(buildFile)) };
  return packReceipt(files, context);
}

function verifyIndependentRelease() {
  const files = preparedFixture(), before = verifyFixture(files);
  assert.deepEqual(before.identity.selection, { host: "rental", profile: "host", coreIds: ["rental"], ai: false, mcp: false });
  assert.equal(before.identity.platform.commit, "a".repeat(40));
  assert.equal(before.identity.rental.commit, "b".repeat(40));
  for (const options of [{ platformSha: "c".repeat(40) }, { rentalSha: "c".repeat(40) }, { profile: "full" }, { projected: "d".repeat(64) }]) {
    const candidate = verifyFixture(preparedFixture(options));
    assert.notEqual(candidate.identitySha256, before.identitySha256);
    assert.equal(comparePreparedRental(before, candidate).different, false);
  }
  assert.deepEqual(comparePreparedRental(before, before).entries, { added: [], removed: [], changed: [], reordered: false, different: false });
  const newer = verifyFixture(preparedFixture({ sql: "SELECT 9;", extra: true, dataVersion: "0.1.1" }));
  assert.notEqual(newer.identity.deploymentLockSha256, before.identity.deploymentLockSha256);
  const changes = comparePreparedRental(before, newer);
  assert.deepEqual(changes.entries.added, ["rental/rental.later"]);
  assert.deepEqual(changes.entries.changed, ["rental/rental.initial"]);
  assert.equal(changes.dataChanged, true);
  assert.deepEqual(comparePreparedRental(newer, before).entries.removed, ["rental/rental.later"]);
  assert.deepEqual(comparePreparedRental(before, verifyFixture(preparedFixture({ publicSql: "SELECT 7;" }))).entries.changed,
    ["platform/platform.foundation"]);

  const aiFiles = preparedFixture({ ai: true });
  const aiCandidate = verifyFixture(aiFiles);
  const aiChange = comparePreparedRental(before, aiCandidate);
  assert.equal(aiChange.selectionChanged, true);
  assert.deepEqual(aiChange.entries.added, ["ai-native/ai-native.initial"]);
  assert.deepEqual(comparePreparedRental(aiCandidate, verifyFixture(preparedFixture({ ai: true, aiSql: "SELECT 8;" }))).entries.changed,
    ["ai-native/ai-native.initial"]);
  const publicFiles = preparedFixture({ ai: true, aiRelease: "0.2.0" });
  const publicAi = verifyFixture(publicFiles);
  const publicInitial = "ai-native/ai-native.20261126000000-public-initial";
  const publicUpgrade = comparePreparedRental(aiCandidate, publicAi);
  assert.deepEqual(publicUpgrade.entries.added, [publicInitial]);
  assert.equal(publicUpgrade.requiresAiDataBridge, true);
  assert.equal(comparePreparedRental(publicAi, aiCandidate).requiresAiDataBridge, true);
  assert.equal(comparePreparedRental(publicAi, publicAi).requiresAiDataBridge, false);
  const publicContext = JSON.parse(publicFiles.get(contextFile));
  publicFiles.delete("packages/ai-native-data/dist/public-data-package.js");
  assert.throws(() => verifyFixture(packReceipt(publicFiles, publicContext)), /正式 AI 数据包文件缺失/u);
  assert.throws(() => verifyFixture(preparedFixture({ ai: true, aiRelease: "0.2.1" })), /AI 数据发行版本/u);
  const aiContext = JSON.parse(aiFiles.get(contextFile));
  aiFiles.delete("packages/ai-native-data/dist/data-package.js");
  assert.throws(() => verifyFixture(packReceipt(aiFiles, aiContext)), /正式 AI 数据包文件缺失/u);
  assert.throws(() => verifyFixture(preparedFixture({ profile: "domain" })), /domain/u);
  assert.throws(() => verifyFixture(preparedFixture({ rentalSha: "b".repeat(12) })), /完整提交 SHA/u);
  assert.throws(() => verifyFixture(preparedFixture({ ai: true, mcp: true, mcpData: false })), /正式部署材料/u);
  const mcpFiles = preparedFixture({ ai: true, mcp: true });
  const mcpCandidate = verifyFixture(mcpFiles);
  const mcpEntries = mcpCandidate.migrations.entries.filter(item => item.owner === "mcp");
  assert.equal(mcpEntries.length, 5);
  assert.equal(mcpEntries[0].ledger.migrationName, "platform-capability.mcp.0001-oauth");
  assert.equal(comparePreparedRental(aiCandidate, mcpCandidate).selectionChanged, true);
  const wrongLedger = new Map(mcpFiles);
  const provenanceFile = "rental-host.deployment-provenance.json";
  const provenance = JSON.parse(wrongLedger.get(provenanceFile));
  provenance.migrations.find(item => item.owner === "mcp").ledger.migrationName = "legacy_oauth";
  wrongLedger.set(provenanceFile, json(provenance));
  assert.throws(() => verifyFixture(packReceipt(wrongLedger, JSON.parse(wrongLedger.get(contextFile)))), /原账/u);
  const staticMcp = new Map([...mcpFiles].filter(([file]) => !file.startsWith("packages/mcp-server/dist/")));
  assert.throws(() => verifyFixture(packReceipt(staticMcp, JSON.parse(staticMcp.get(contextFile)))), /正式 MCP 数据包文件缺失/u);
  assert.throws(() => verifyPreparedRental(new Map([["development.workspace.json", files.get("development.workspace.json")]]), "0".repeat(64)), /旧组合须先核定原库桥接/u);
  assert.throws(() => verifyPreparedRental(new Map([["build-provenance.json", json({ git: { commit: before.identity.platform.commit } })]]), "0".repeat(64)), /旧组合须先核定原库桥接/u);
  assert.throws(() => verifyPreparedRental(files, "0".repeat(64)), /已核摘要不一致/u);
  const tampered = new Map(files);
  tampered.set(deploymentRoot + "migrations/core.rental.rental.initial/migration.sql", buf("SELECT 2;"));
  assert.throws(() => verifyFixture(tampered), /宿主文件摘要不一致/u);
  const missing = new Map(files);
  missing.delete(deploymentRoot + "core.deployment.lock.json");
  assert.throws(() => verifyFixture(packReceipt(missing, JSON.parse(files.get(contextFile)))), /正式部署锁缺失/u);
  const hidden = new Map(files).set(deploymentRoot + "migrations/999_extra/migration.sql", buf("SELECT 4;"));
  assert.throws(() => verifyFixture(packReceipt(hidden, JSON.parse(files.get(contextFile)))), /额外材料/u);
  ok("双仓 prepared 身份和迁移比较：双 SHA、选择、依赖锁、部署锁与实际原文；缺件和旧来源拒绝");
}

function verifyBuildEvidence() {
  const archive = fixedBuildFixture();
  const candidate = verifyPreparedRental(archive, hash(archive.get(contextFile)), { requireFixedBuild: true });
  assert.equal(candidate.identity.buildProvenanceSha256, hash(archive.get(buildFile)));
  assert.equal(verifyFixture(fixedBuildFixture(undefined, { ai: true })).identity.selection.ai, true);
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.projects.pop(); }, { ai: true })), /编译项目/u);
  const legacy = preparedFixture();
  const comparison = verifyFixture(legacy);
  assert.equal(comparison.identity.buildProvenanceSha256, undefined);
  assert.equal(comparePreparedRental(comparison, candidate).different, false);
  assert.throws(() => verifyPreparedRental(legacy, hash(legacy.get(contextFile)), { requireFixedBuild: true }), /缺少固定宿主构建证明/u);
  for (const field of ["sourceSha256", "npmLockSha256", "deploymentLockSha256"]) {
    assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof[field] = "0".repeat(64); })), /双仓来源、投影锁或部署锁不一致/u);
  }
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.rental.commit = "c".repeat(40); })), /双仓来源/u);
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.projects.pop(); })), /编译项目/u);
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.compiler.sha256 = "0".repeat(64); })), /编译器证据/u);
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.clients[0].declarationsSha256 = "0".repeat(64); })), /Client 声明/u);
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.clients[1].schemaSha256 = "0".repeat(64); })), /Client 声明/u);
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.files[1] = proof.files[0]; })), /产物缺失、重复/u);
  assert.throws(() => verifyFixture(fixedBuildFixture(proof => { proof.files.pop(); })), /产物集合/u);
  assert.throws(() => verifyFixture(fixedBuildFixture((proof, files) => { files.set(proof.files[1].file, buf("unbound build fixture")); })), /产物缺失、重复或摘要/u);
  const wrongReference = JSON.parse(archive.get(contextFile));
  wrongReference.buildProvenance.sha256 = "0".repeat(64);
  assert.throws(() => verifyFixture(packReceipt(new Map(archive), wrongReference)), /构建证明引用/u);
  const policy = { origin: "automatic", headSource: "platform", repositoryId: 10, workflowId: 37,
    workflowPath: ".github/workflows/fixture.yml", runId: 5, runAttempt: 2, buildRecordSha256: hash(buf("build record fixture")) };
  const run = { id: 5, run_attempt: 2, workflow_id: 37, path: policy.workflowPath, repository: { id: 10 }, head_repository: { id: 10 },
    event: "push", head_branch: "main", head_sha: candidate.identity.platform.commit, status: "completed", conclusion: "success" };
  const imageIds = { api: `sha256:${"1".repeat(64)}`, web: `sha256:${"2".repeat(64)}` };
  const verifiedBuild = { sha256: policy.buildRecordSha256, identitySha256: candidate.identitySha256,
    platformCommit: candidate.identity.platform.commit, rentalCommit: candidate.identity.rental.commit, runId: 5, runAttempt: 2, imageIds };
  const evidence = { run, verifiedBuild, inspectedImageIds: { ...imageIds } };
  const checked = verifyPairedBuildEvidence(candidate, policy, evidence);
  assert.equal(checked.origin, "automatic");
  assert.equal(checked.buildProvenanceSha256, candidate.identity.buildProvenanceSha256);
  assert.equal(checked.releaseApproved, false);
  assert.equal(checked.databaseChecked, false);
  assert.throws(() => verifyPairedBuildEvidence(comparison, policy, evidence), /固定构建证明/u);
  assert.throws(() => verifyPairedBuildEvidence(structuredClone(candidate), policy, evidence), /固定构建证明/u);
  const manual = { ...policy, origin: "manual", headSource: "rental" };
  assert.equal(verifyPairedBuildEvidence(candidate, manual, { ...evidence,
    run: { ...run, event: "workflow_dispatch", head_sha: candidate.identity.rental.commit } }).origin, "manual");
  for (const change of [{ event: "workflow_dispatch" }, { event: "pull_request" }, { run_attempt: 1 }, { head_branch: "test" },
    { head_repository: { id: 11 } }, { workflow_id: 38 }, { status: "in_progress" }, { conclusion: "failure" }, { head_sha: candidate.identity.rental.commit }]) {
    assert.throws(() => verifyPairedBuildEvidence(candidate, policy, { ...evidence, run: { ...run, ...change } }), /CI 仓库/u);
  }
  for (const change of [{ rentalCommit: undefined }, { platformCommit: "a".repeat(12) }, { runAttempt: 1 },
    { sha256: hash(buf("different build")) }, { identitySha256: hash(buf("different identity")) }]) {
    assert.throws(() => verifyPairedBuildEvidence(candidate, policy, { ...evidence, verifiedBuild: { ...verifiedBuild, ...change } }), /双仓构建记录/u);
  }
  assert.throws(() => verifyPairedBuildEvidence(candidate, policy, { run }), /双仓构建记录/u);
  assert.throws(() => verifyPairedBuildEvidence(candidate, { ...policy, buildRecordSha256: undefined }, evidence), /锚点/u);
  assert.throws(() => verifyPairedBuildEvidence(candidate, policy, { ...evidence, inspectedImageIds: { api: imageIds.api } }), /镜像 ID/u);
  assert.throws(() => verifyPairedBuildEvidence(candidate, policy, { ...evidence, inspectedImageIds: { api: imageIds.web, web: imageIds.api } }), /镜像 ID/u);
  assert.throws(() => verifyPairedBuildEvidence({ ...candidate, identity: { ...candidate.identity, deploymentLockSha256: undefined } }, policy, evidence), /候选身份/u);
  verifyImagePair(archive, candidate, policy, run, imageIds);
  ok("双仓 CI 和镜像证明夹具：核同运行及触发来源，双镜像必须对应同一构建记录，结果仅为离线一致性");
}

function verifyImagePair(archive, candidate, initialPolicy, run, imageIds) {
  const root = path.join(ROOT, "output", ".tmp", "rental-image-pair-fixture");
  assert.equal(fs.existsSync(root), false);
  const manifestPath = path.join(root, "input.json"), indexPath = path.join(root, "web", "index.html");
  const web = buf("<html>fixture</html>");
  const disk = new Map([...archive].map(([file, bytes]) => [path.join(root, "api", file), bytes]));
  const manifest = { format: "rental-image-input-1", sourceMode: "release", releaseApproved: false, serverUpdateEligible: false,
    contextSha256: candidate.identity.contextSha256, identitySha256: candidate.identitySha256, platformCommit: candidate.identity.platform.commit,
    rentalCommit: candidate.identity.rental.commit, toolCommit: candidate.identity.platform.commit,
    deploymentLockSha256: candidate.identity.deploymentLockSha256, npmLockSha256: candidate.identity.npmLocks.projected,
    webFilesSha256: facts.digestFiles([{ path: "index.html", contents: web, bytes: web.length }]).digest };
  disk.set(manifestPath, json(manifest));
  disk.set(indexPath, web);
  const directories = new Set();
  for (const file of disk.keys()) for (let dir = path.dirname(file); !directories.has(dir); dir = path.dirname(dir)) directories.add(dir);
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_REPOSITORY: "JinPen-G/Zelo", GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "push", GITHUB_RUN_ID: "5", GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: candidate.identity.platform.commit, ZELO_COMMIT: candidate.identity.platform.commit, RENTAL_COMMIT: candidate.identity.rental.commit };
  const stored = new Map(), preflight = [];
  let wrongTag = false;
  function simulate(command, args) {
    if (command === "git") {
      assert.deepEqual(args.slice(0, 3), ["ls-remote", "--exit-code", "--tags"]);
      const role = args[3].endsWith("/Zelo.git") ? "platform" : "rental";
      assert.equal(args[4], `refs/tags/v${candidate.versions[role]}`);
      const commit = candidate.identity[role].commit;
      return `${"d".repeat(40)}\t${args[4]}\n${wrongTag ? "e".repeat(40) : commit}\t${args[5]}\n`;
    }
    assert.equal(command, "docker");
    if (args[0] === "build") {
      const tag = args[args.indexOf("--tag") + 1], role = tag.includes("-api:") ? "api" : "web";
      const Labels = Object.fromEntries(args.flatMap((item, index) => item === "--label" ? [args[index + 1].split("=")] : []));
      assert.equal(Labels["pro.zelo.release.ci"], "5/2");
      assert.equal(Labels["pro.zelo.release.identity"], candidate.identitySha256);
      assert.equal(Labels["pro.zelo.release.role"], role);
      stored.set(tag, { Id: imageIds[role], Config: { Labels, User: "node" } });
    } else if (args[0] === "image") {
      assert.equal(args[1], "inspect");
      return JSON.stringify([stored.get(args[2])]);
    } else {
      assert.deepEqual(args.slice(0, 5), ["run", "--rm", "--network", "none", "--entrypoint"]);
      preflight.push(args[6]);
    }
  }
  const originalFs = { lstatSync: fs.lstatSync, readdirSync: fs.readdirSync, readFileSync: fs.readFileSync };
  const nodeType = file => {
    if (!disk.has(file) && !directories.has(file)) throw Object.assign(new Error("missing fixture"), { code: "ENOENT" });
    return { isFile: () => disk.has(file), isDirectory: () => directories.has(file), isSymbolicLink: () => false, size: disk.get(file)?.length ?? 0 };
  };
  let record;
  try {
    fs.lstatSync = nodeType;
    fs.readFileSync = file => disk.get(file);
    fs.readdirSync = dir => [...disk.keys(), ...directories].filter(file => file !== dir && path.dirname(file) === dir)
      .map(file => ({ name: path.basename(file), ...nodeType(file) }));
    const build = () => buildImagePair(root, hash(disk.get(manifestPath)), env, simulate);
    assert.throws(() => buildImagePair(root, "0".repeat(64), env, simulate), /交接清单/u);
    disk.set(manifestPath, json({ ...manifest, format: "rental-development-build-1" }));
    assert.throws(build, /缺少正式宿主/u);
    disk.set(manifestPath, json({ ...manifest, npmLockSha256: "0".repeat(64) }));
    assert.throws(build, /候选身份不一致/u);
    disk.set(manifestPath, json(manifest));
    wrongTag = true;
    assert.throws(build, /正式 Tag/u);
    wrongTag = false;
    disk.set(indexPath, buf("<html>changed</html>"));
    assert.throws(build, /Web 文件集合/u);
    disk.set(indexPath, web);
    assert.equal(stored.size, 0);
    record = json(build());
  } finally {
    Object.assign(fs, originalFs);
  }
  assert.equal(stored.size, 2);
  assert.deepEqual(preflight, [imageIds.api, imageIds.web]);
  assert.equal(JSON.parse(record).serverUpdateEligible, false);
  const policy = { ...initialPolicy, buildRecordSha256: hash(record) };
  const observed = { run, buildRecord: record, inspectedImageIds: imageIds };
  assert.equal(reviewPairedUpdate(candidate, candidate, policy, observed).status, "awaiting-release-approval");
  assert.equal(reviewPairedUpdate("legacy-combined", candidate, policy, observed).status, "awaiting-migration-bridge");
  assert.equal(reviewPairedUpdate(verifyFixture(preparedFixture({ extra: true })), candidate, policy, observed).status, "awaiting-migration-approval");
  assert.throws(() => reviewPairedUpdate(candidate, candidate, policy, { ...observed, buildRecord: json({}) }), /记录原文/u);
  assert.throws(() => reviewPairedUpdate(candidate, candidate, policy, { ...observed, run: { ...run, conclusion: "failure" } }), /CI 仓库/u);
  const changedSelection = json({ ...JSON.parse(record), selection: { ...candidate.identity.selection, profile: "full" } });
  assert.throws(() => reviewPairedUpdate(candidate, candidate, { ...policy, buildRecordSha256: hash(changedSelection) },
    { ...observed, buildRecord: changedSelection }), /候选选择/u);
  assert.equal(fs.existsSync(root), false);
  ok("同次 API／Web 镜像构建边界夹具通过，缺材料、错 Tag、开发报告与未通过 CI 均拒绝");
}

function verifyMcpContribution() {
  const first = "mysql-first.sql", second = "mysql-second.sql";
  const sql = new Map([[first, buf("SELECT 1;")], [second, buf("SELECT 2;")]]);
  const raw = (entries, files = sql) => verifyMcpSql(new Map([...files, ["data-contribution.json", json({ formatVersion: 1,
    capabilityId: "mcp", owner: "platform-capability:mcp", provider: "mysql", sql: entries })]]));
  const entries = [...sql].map(([file, bytes]) => ({ file, sha256: hash(bytes), requires: [] }));
  const before = raw(entries);
  assert.equal(compareEntries(before, raw(entries.slice().reverse())).reordered, true);
  assert.throws(() => raw([entries[1], { ...entries[0], requires: ["mysql-missing.sql"] }]), /依赖/u);
  assert.throws(() => raw(entries.slice(1)), /文件集合/u);
  const edited = new Map(sql).set(first, buf("SELECT 3;"));
  assert.throws(() => raw(entries, edited), /摘要不一致/u);
  const after = raw([{ ...entries[0], sha256: hash(edited.get(first)) }, entries[1]], edited);
  assert.deepEqual(compareEntries(before, after).changed, [`platform-capability:mcp/${first}`]);
  ok("MCP 原 SQL 核验：完整集合、内容与依赖次序参与差异比较");
}

void (() => {
  // ============ 1. 环境变量只校验存在性，且只回名字 ============
  const complete = { NODE_ENV: "production", RENTAL_DEPLOYMENT_PROFILE: "production", DATABASE_URL: "mysql://u:p@h:3306/rental_os_claude", AUTH_TOKEN_SECRET: "x".repeat(40), INTEGRATION_ENCRYPTION_KEY: "y".repeat(40) };
  const result = facts.inspectEnvNames(complete);
  assert.deepEqual(result.missing, [], "必需变量齐备时不应报缺失");
  assert.ok(result.present.includes("DATABASE_URL"), "已配置的变量名应出现在 present");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("mysql://"), false, "结果里不得出现连接串");
  assert.equal(serialized.includes("x".repeat(40)), false, "结果里不得出现密钥值");
  ok("环境变量检查只回名字，连接串与密钥值都不进结果");

  // 空串与纯空白比「没写」更危险：看起来像配过了。必须判为缺失。
  for (const value of ["", "   ", "\t"]) {
    const partial = facts.inspectEnvNames({ ...complete, AUTH_TOKEN_SECRET: value });
    assert.deepEqual(partial.missing, ["AUTH_TOKEN_SECRET"], `AUTH_TOKEN_SECRET=「${value}」必须判为缺失`);
  }
  const none = facts.inspectEnvNames({});
  assert.deepEqual(none.missing.sort(), ["AUTH_TOKEN_SECRET", "DATABASE_URL", "INTEGRATION_ENCRYPTION_KEY", "NODE_ENV", "RENTAL_DEPLOYMENT_PROFILE"], "必需变量缺失时都要列出");
  assert.ok(none.optionalMissing.includes("API_PORT"), "可选变量缺失应单独列出，不混进必需缺失");
  ok("空串/空白视为缺失；必需与可选缺失分开列出");

  const crypto = require("node:crypto");
  const environment = require("../config/environment.cjs");
  const valid = { ...complete, AUTH_TOKEN_SECRET: crypto.randomBytes(32).toString("hex"), INTEGRATION_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") };
  const memoryEnvironment = { NODE_ENV: "development", PLATFORM_DATA_SOURCE: "memory", RENTAL_OS_DATA_SOURCE: "memory" };
  assert.equal(environment.validateApiEnvironment(memoryEnvironment).INFRA_DATA_SOURCE, "memory", "省略基础设施数据源时继承租赁数据源");
  assert.equal(environment.validateApiEnvironment({ ...memoryEnvironment, INFRA_DATA_SOURCE: "mysql" }).INFRA_DATA_SOURCE, "mysql", "显式基础设施数据源优先");
  assert.equal(environment.validateApiEnvironment({}).INFRA_DATA_SOURCE, "mysql", "数据源均省略时回落 MySQL");
  assert.throws(() => environment.validateApiEnvironment({ ...memoryEnvironment, INFRA_DATA_SOURCE: "invalid" }), /INFRA_DATA_SOURCE/);
  assert.equal(facts.inspectReleaseEnvironment({ ...valid, RENTAL_OS_DATA_SOURCE: "memory" }).ok, false, "生产发布继续拒绝继承的内存数据源");
  assert.equal(facts.inspectReleaseEnvironment(valid).ok, true);
  for (const change of [{ NODE_ENV: "development" }, { RENTAL_DEPLOYMENT_PROFILE: "demo" }, { RENTAL_DEPLOYMENT_PROFILE: "development" }, { INFRA_DATA_SOURCE: "memory" }, { AUTH_TOKEN_SECRET: "x".repeat(40) }, { LOCAL_DEMO_PASSWORD_RESET_ENABLED: "true" }, { API_PORT: "3000bad" }]) {
    const rejected = facts.inspectReleaseEnvironment({ ...valid, ...change });
    assert.equal(rejected.ok, false, "发布必须拒绝无效配置值");
    assert.equal(JSON.stringify(rejected).includes(valid.AUTH_TOKEN_SECRET), false);
    assert.equal(JSON.stringify(rejected).includes(valid.DATABASE_URL), false);
  }
  const personalDemo = { ...valid, RENTAL_DEPLOYMENT_PROFILE: "personal-demo", LOCAL_DEMO_PASSWORD_RESET_ENABLED: "true" };
  assert.equal(facts.inspectReleaseEnvironment(personalDemo).ok, true, "显式个人演示可在生产运行模式保留登录前重置");
  assert.equal(facts.inspectReleaseEnvironment({ ...personalDemo, NODE_ENV: "development" }).ok, true);
  assert.equal(facts.inspectReleaseEnvironment({ ...personalDemo, NODE_ENV: "test" }).ok, false);
  const publicValues = { ...valid, VITE_API_BASE_URL: "/api", VITE_SHOW_ACCOUNT_SHORTCUTS: "true", VITE_API_BASE: "", VITE_ENTERPRISE_PUBLIC_HOSTS: "example.test", VITE_UNREGISTERED_SECRET: "private-fixture" };
  for (const [application, expected] of [["admin", ["VITE_API_BASE_URL", "VITE_SHOW_ACCOUNT_SHORTCUTS"]], ["tenantWebsite", ["VITE_API_BASE"]], ["enterprisePortal", ["VITE_ENTERPRISE_PUBLIC_HOSTS"]]]) {
    const projected = environment.publicEnvironmentDefinitions(application, publicValues);
    assert.deepEqual(Object.keys(projected).sort(), expected.map(name => `import.meta.env.${name}`).sort());
    assert.equal(JSON.stringify(projected).includes("private-fixture"), false);
    assert.equal(JSON.stringify(projected).includes(valid.AUTH_TOKEN_SECRET), false);
  }
  assert.equal(environment.publicEnvironmentDefinitions("tenantWebsite", publicValues)["import.meta.env.VITE_API_BASE"], '""', "租户网站的同源空基址必须保留到公开配置");
  ok("发布配置值经过统一校验，公开字段按各端清单投影");

  // ============ 2. 产物指纹：可比对、与顺序无关、随内容变 ============
  const files = [
    { path: "apps/api/dist/main.js", bytes: 3, contents: buf("abc") },
    { path: "apps/api/dist/a/b.js", bytes: 2, contents: buf("de") }
  ];
  const first = facts.digestFiles(files);
  const reordered = facts.digestFiles([files[1], files[0]]);
  assert.equal(first.digest, reordered.digest, "同一组文件换顺序必须得到同一指纹——目录遍历顺序跨平台不稳定");
  assert.equal(first.fileCount, 2);
  assert.equal(first.totalBytes, 5);
  const mutated = facts.digestFiles([{ path: "apps/api/dist/main.js", bytes: 3, contents: buf("abd") }, files[1]]);
  assert.notEqual(first.digest, mutated.digest, "内容变了指纹必须变，否则证明不了「测过的就是要发的」");
  const renamed = facts.digestFiles([{ path: "apps/api/dist/main2.js", bytes: 3, contents: buf("abc") }, files[1]]);
  assert.notEqual(first.digest, renamed.digest, "路径变了指纹也必须变");
  assert.equal(facts.digestFiles([]).digest, undefined, "产物缺失时不得伪造一个指纹");
  assert.equal(facts.digestFiles([]).fileCount, 0);
  // Windows 反斜杠路径要归一，否则同一份产物在两台机器上指纹不同。
  const windows = facts.digestFiles([{ path: "apps\\api\\dist\\main.js", bytes: 3, contents: buf("abc") }, files[1]]);
  assert.equal(windows.digest, first.digest, "路径分隔符必须归一化后再摘要");
  ok("产物指纹：与顺序无关、随内容与路径变化、缺失不伪造、分隔符归一");

  const currentBuilds = [{ name: "api", fileCount: 2, totalBytes: 5, digest: first.digest }];
  const proof = { kind: "release-build-provenance", git: { commit: "abc" }, builds: currentBuilds };
  assert.equal(facts.inspectBuildProvenance(proof, "abc", currentBuilds).ok, true, "同提交同摘要应通过");
  assert.equal(facts.inspectBuildProvenance(proof, "def", currentBuilds).ok, false, "旧提交产物必须失败");
  assert.equal(
    facts.inspectBuildProvenance(proof, "abc", [{ ...currentBuilds[0], digest: "changed" }]).ok,
    false,
    "产物在构建后被改写必须失败"
  );
  assert.equal(facts.inspectBuildProvenance(undefined, "abc", currentBuilds).ok, false, "没有来源证明的旧 dist 必须失败");
  ok("构建来源证明：当前提交和当前产物摘要必须同时匹配");

  // 使用原产物收集入口和内存文件系统，验证 MCP 确实参与完整发布摘要。
  // 夹具不读取部署目录，所有文件系统方法都在 finally 中恢复。
  assert.deepEqual(artifacts.BUILD_TARGETS.map(target => target.name), [
    "@rental-os/api", "@rental-os/admin", "@rental-os/shared", "@rental-os/mcp-server", "config"
  ], "MCP 与原四个目标必须同时纳入发布来源");
  const mcpDirectory = path.join(ROOT, "packages", "mcp-server", "dist");
  assert.equal(artifacts.BUILD_TARGETS.find(target => target.name === "@rental-os/mcp-server").dir, mcpDirectory);
  const mcpEntry = path.join(mcpDirectory, "index.js");
  const mcpTypes = path.join(mcpDirectory, "index.d.ts");
  const fixtureFiles = new Map([
    [path.join(ROOT, "apps", "api", "dist", "main.js"), buf("api")],
    [path.join(ROOT, "apps", "admin", "dist", "index.html"), buf("admin")],
    [path.join(ROOT, "packages", "shared", "dist", "index.js"), buf("shared")],
    [mcpEntry, buf("mcp")], [mcpTypes, buf("types")],
    [path.join(ROOT, "config", "environment.cjs"), buf("config")],
    [path.join(ROOT, "config", "environment.d.cts"), buf("types")]
  ]);
  const fixtureDirectories = new Set(artifacts.BUILD_TARGETS.map(target => target.dir));
  const originalFs = { existsSync: fs.existsSync, readdirSync: fs.readdirSync, statSync: fs.statSync, readFileSync: fs.readFileSync };
  try {
    fs.existsSync = file => fixtureDirectories.has(file) || fixtureFiles.has(file);
    fs.readdirSync = directory => [...fixtureFiles.keys()]
      .filter(file => file.startsWith(directory + path.sep))
      .map(file => ({ name: path.basename(file), parentPath: path.dirname(file), isFile: () => true }));
    fs.statSync = file => ({ size: fixtureFiles.get(file).length });
    fs.readFileSync = file => fixtureFiles.get(file);
    const completeBuilds = artifacts.summarizeBuilds();
    const completeProof = { kind: "release-build-provenance", git: { commit: "mcp-fixture" }, builds: completeBuilds };
    assert.equal(completeBuilds.length, 5);
    assert.ok(completeBuilds.every(build => build.fileCount > 0 && build.digest), "原完整目标均应有有效摘要");
    assert.equal(completeBuilds.find(build => build.name === "@rental-os/mcp-server").fileCount, 2);
    assert.equal(facts.inspectBuildProvenance(completeProof, "mcp-fixture", completeBuilds).ok, true);
    assert.equal(facts.assertNoSecrets({ builds: completeBuilds }, [valid.AUTH_TOKEN_SECRET, valid.DATABASE_URL]), true);
    const omittedProof = { ...completeProof, builds: completeBuilds.filter(build => build.name !== "@rental-os/mcp-server") };
    assert.equal(facts.inspectBuildProvenance(omittedProof, "mcp-fixture", completeBuilds).ok, false,
      "旧来源证明未记录 MCP 时必须拒绝");

    fixtureFiles.delete(mcpEntry);
    fixtureFiles.delete(mcpTypes);
    const missingBuilds = artifacts.summarizeBuilds();
    const missingMcp = missingBuilds.find(build => build.name === "@rental-os/mcp-server");
    assert.equal(missingMcp.fileCount, 0, "缺少 MCP dist 时必须在正常摘要入口暴露缺件");
    assert.equal(missingMcp.digest, undefined);
    assert.equal(facts.inspectBuildProvenance(completeProof, "mcp-fixture", missingBuilds).ok, false);

    fixtureFiles.set(mcpEntry, buf("MCP"));
    fixtureFiles.set(mcpTypes, buf("types"));
    const changedBuilds = artifacts.summarizeBuilds();
    const originalMcp = completeBuilds.find(build => build.name === "@rental-os/mcp-server");
    const changedMcp = changedBuilds.find(build => build.name === "@rental-os/mcp-server");
    assert.equal(changedMcp.totalBytes, originalMcp.totalBytes);
    assert.notEqual(changedMcp.digest, originalMcp.digest, "同长度的 MCP 内容变化也必须改变来源指纹");
    assert.equal(facts.inspectBuildProvenance(completeProof, "mcp-fixture", changedBuilds).ok, false);
  } finally {
    Object.assign(fs, originalFs);
  }
  ok("MCP 纳入原完整发布摘要，缺件、来源遗漏和内容变化均可被原门禁识别");

  // ============ 3. 工作区状态 ============
  assert.equal(facts.summarizeWorktree("").clean, true, "空 porcelain 表示干净");
  assert.equal(facts.summarizeWorktree("   \n\n").clean, true, "只有空行同样算干净");
  const dirty = facts.summarizeWorktree(" M apps/api/src/main.ts\n?? scripts/new.cjs");
  assert.equal(dirty.clean, false, "有改动即为脏——清单里的提交号必须名副其实");
  assert.equal(dirty.changedCount, 2, "未跟踪文件同样计数：它们不在提交里，却可能被打进产物");
  assert.deepEqual(dirty.changed, ["apps/api/src/main.ts", "scripts/new.cjs"], "只回文件名，不回内容");
  ok("工作区状态：未跟踪文件也算脏，只回文件名不回内容");

  // ============ 4. 敏感值拦截 ============
  const password = "rental_os";
  // 关键回归：库名恰好以口令为前缀。这**不是**泄露，必须放行——
  // 一个总在误报的检查很快会被关掉，那比没有检查更糟。
  assert.equal(
    facts.assertNoSecrets({ database: { database: "rental_os_claude" } }, [password]),
    true,
    "库名包含口令子串不构成泄露，不得误报"
  );
  const rejects = (manifest, secrets, pattern, label) => {
    assert.throws(() => facts.assertNoSecrets(manifest, secrets), (error) => {
      assert.match(error.message, pattern, `${label}：实际「${error.message}」`);
      return true;
    }, label);
  };
  rejects({ note: password }, [password], /整体等于一个已知秘密/u, "字符串值整体等于口令");
  rejects({ url: "mysql://svc:s3cr3t@db:3306/x_claude" }, [], /连接串明文/u, "连接串明文");
  rejects({ db: { url: "mysql://svc:rental_os@db:3306/x_claude" } }, [password], /连接串明文|含已知秘密/u, "连接串里含口令");
  rejects({ auth: { secret: "abc123" } }, [], /敏感字段/u, "sensitive 键名未掩码");
  rejects({ items: [{ token: "abc" }] }, [], /敏感字段/u, "数组内的敏感键名也要拦");
  assert.equal(facts.assertNoSecrets({ auth: { secret: "***" } }, []), true, "已掩码的敏感字段应放行");
  ok("敏感值拦截：整值等于秘密/连接串/敏感键名被拒，库名前缀重合与已掩码值放行");

  // ============ 5. 门禁必须默认只读 ============
  const gate = fs.readFileSync(path.join(ROOT, "scripts/ops/release-gate.cjs"), "utf8");
  assert.match(gate, /migrate", "status"/u, "门禁必须做只读迁移状态检查");
  assert.equal(
    /"deploy"|migrate deploy|migrate", "dev"/u.test(gate),
    false,
    "门禁不得自动应用迁移——发布前最该知道的是差什么，而不是已经替你改了"
  );
  for (const forbidden of ["app.listen", "nest start", "dist/main.js", "docker compose up", "docker start", "docker restart"]) {
    assert.equal(gate.includes(forbidden), false, `门禁不得启动或替换服务：命中 ${forbidden}`);
  }
  // 唯一允许的写盘动作是显式 --emit 落清单。
  const writes = gate.match(/fs\.(writeFileSync|mkdirSync|rmSync|unlinkSync|appendFileSync)/gu) ?? [];
  assert.deepEqual(
    [...new Set(writes)].sort(),
    ["fs.mkdirSync", "fs.writeFileSync"],
    `门禁只应有建目录与写清单两种写盘动作，实际 ${[...new Set(writes)].join(",")}`
  );
  assert.match(gate, /if \(flag\("emit"\)\) \{[\s\S]{0,200}mkdirSync/u, "落盘必须在 --emit 分支内");
  assert.match(gate, /dry-run/u, "默认模式必须标明 dry-run");
  assert.match(gate, /assertNoSecrets\(manifest, secrets\)/u, "清单落盘前必须过敏感值闸门");
  assert.match(gate, /inspectReleaseEnvironment\(env\)/u, "发布入口必须执行配置值校验");
  assert.match(gate, /assertContainerEndpoint\(requireTarget\(\)\)/u, "目标库必须过专用库与端点守卫");
  assert.match(gate, /inspectBuildProvenance\(readBuildProvenance\(\), head, buildSummary\)/u,
    "只读门禁必须把现有产物绑定到当前提交，不能只认旧 dist 摘要");
  const builder = fs.readFileSync(path.join(ROOT, "scripts/ops/release-build.cjs"), "utf8");
  assert.match(builder, /run\("npm", \["run", "build"\]/u, "显式发布构建必须真的执行完整 build");
  assert.match(builder, /runPackageCommand\("npm"/u, "Windows 构建不得依赖直接 spawn npm.cmd");
  assert.match(builder, /worktree\.clean/u, "发布构建前必须拒绝脏工作区");
  assert.match(builder, /BUILD_PROVENANCE_FILE/u, "发布构建必须写出当前提交的来源证明");
  ok("门禁默认只读：只查迁移状态不 deploy、不起服务、只有 --emit 才写清单");

  // ============ 6. 清单字段齐备（发布要固定的东西一个都不能少） ============
  for (const field of ["commit", "shortCommit", "branch", "worktreeClean"]) {
    assert.ok(gate.includes(field), `清单缺少 git 字段 ${field}`);
  }
  assert.match(gate, /toolchain: versions/u, "清单必须固定工具链版本");
  assert.match(gate, /builds: buildSummary/u, "清单必须固定产物摘要");
  assert.match(gate, /healthEntrypoints: HEALTH_ENTRYPOINTS/u, "清单必须登记健康检查入口");
  assert.match(gate, /notCovered/u, "清单必须写明未覆盖边界，不得暗示完整 OPS-01 已完成");
  assert.ok(facts.HEALTH_ENTRYPOINTS.some((row) => row.path === "/api/health"), "健康入口必须包含 /api/health");
  assert.ok(
    facts.RELEASE_ENV_VARS.filter((row) => row.required).map((row) => row.name).includes("AUTH_TOKEN_SECRET"),
    "AUTH_TOKEN_SECRET 必须是必需项：缺失时非生产会回落到仓库里公开的开发密钥"
  );
  ok("清单字段：提交、工具链、产物摘要、健康入口与未覆盖边界齐备");

  verifyIndependentRelease();
  verifyMcpContribution();
  verifyBuildEvidence();
  console.log("\nOPS-01B 发布候选门禁专项：全部通过");
})();
