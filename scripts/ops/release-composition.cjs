"use strict";

/** 核对正式宿主收据与实际字节，比较离线数据材料。数据库状态和发布批准由原入口另行核定。 */
const { createHash } = require("node:crypto");
const { posix } = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const CONTEXT_FILE = "rental-host.context.json";
const SOURCE_FILE = "development.workspace.json";
const DEPLOYMENT_FILE = "rental-host.deployment-provenance.json";
const BUILD_FILE = "rental-host.build-provenance.json";
const DEPLOYMENT_ROOT = "apps/rental-api/prisma-deployment/";
const verifiedCandidates = new WeakMap();
const CONTRACT_PROJECTS = ["packages/platform-contracts/tsconfig.json", "packages/rental-core/tsconfig.contracts.json",
  "packages/shared/tsconfig.json", "packages/shared/tsconfig.agent-desktop.json", "packages/rental-core/tsconfig.json"];
const PLATFORM_PROJECTS = ["packages/platform-contracts", "packages/core-contracts", "packages/core-host",
  "packages/platform-server", "packages/platform-core-host", "apps/platform-api"].map(directory => `${directory}/tsconfig.json`);
const RUNTIME_OUTPUT = /^(?:apps|packages)\/[^/]+\/dist(?:-[^/]+)?\/.*\.(?:js|cjs|json|d\.ts)$/u;
const MCP_MANIFEST = "data-contribution.json";
const MCP_SQL = /^mysql-[a-z0-9-]+\.sql$/u;
const CAPABILITY_ROOTS = { "ai-native": "packages/ai-native-data/", mcp: "packages/mcp-server/" };
const AI_RELEASES = new Map([
  ["0.1.1", { dataVersion: "0.1.0", schema: "prisma/schema.prisma", entries: ["data", "prisma-schema", "preparation", "data-package", "mysql-data"] }],
  ["0.2.0", { dataVersion: "0.2.0", schema: "prisma-public/schema.prisma", entries: ["public-data", "public-data-package", "public-mysql-data"] }],
]);
const MCP_MIGRATIONS = [
  ["mcp.0001-oauth", "mysql-oauth-schema.sql"],
  ["mcp.0002-read-budget", "mysql-read-budget-schema.sql"],
  ["mcp.0003-catalog-goal", "mysql-catalog-goal-schema.sql"],
  ["mcp.0004-catalog-intent", "mysql-catalog-goal-intent-schema.sql"],
  ["mcp.0005-catalog-adoption", "mysql-catalog-goal-adoption-schema.sql"],
];
const isFullCommit = value => typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
const isSha256 = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function requireEvidence(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(bytes, label) {
  const message = `缺少有效的 ${label}`;
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(message);
  }
  requireEvidence(value && typeof value === "object" && !Array.isArray(value), message);
  return value;
}

function isPackagePath(file) {
  return typeof file === "string" && file.length > 0 && file.length <= 240
    && !/[\\<>:"|?*#%\u0000-\u001f\u007f]/u.test(file) && !/^(?:docs|output)(?:\/|$)/iu.test(file)
    && file.split("/").every(part => part && part.trim() === part && !part.endsWith(".")
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
      && !/^(?:\.git|node_modules)$/iu.test(part) && (!/^\.env(?:\.|$)/iu.test(part) || part === ".env.example"));
}

function fixedSource(value) {
  requireEvidence(isFullCommit(value?.commit)
    && typeof value.repository === "string" && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository),
    "发布来源须含 GitHub 仓库与完整提交 SHA");
  return { repository: value.repository, commit: value.commit };
}

function describe(files, file, relative = file) {
  const bytes = files.get(file);
  requireEvidence(Buffer.isBuffer(bytes) && bytes.length > 0, `缺少正式发布材料 ${relative}`);
  return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
}

function lockDigest(entry, label, file) {
  requireEvidence(isPackagePath(entry?.path) && (!file || entry.path === file)
    && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && isSha256(entry.sha256), `缺少 ${label} 摘要`);
  return entry.sha256;
}

function verifyContextFiles(files, context) {
  requireEvidence(Array.isArray(context.files) && context.files.length + 1 === files.size, "宿主收据和实际文件集合不一致");
  const paths = new Set([CONTEXT_FILE]);
  const digests = new Map();
  for (const item of context.files) {
    requireEvidence(isPackagePath(item?.file) && !paths.has(item.file.toLowerCase()), "宿主收据路径无效或重复");
    paths.add(item.file.toLowerCase());
    const bytes = files.get(item.file);
    requireEvidence(Buffer.isBuffer(bytes) && isSha256(item.sha256) && sha256(bytes) === item.sha256,
      `宿主文件摘要不一致 ${item.file}`);
    digests.set(item.file, item.sha256);
  }
  return digests;
}

function verifyCapabilityFiles(capability, files, digests, schema, label) {
  requireEvidence(isSha256(capability.sha256) && capability.prerequisites?.platform && Array.isArray(capability.prerequisites.cores)
    && Array.isArray(capability.files) && Array.isArray(capability.data?.migrations) && capability.schema?.file === schema,
    `缺少正式锁定的 ${label} 数据包及前置`);
  const prefix = CAPABILITY_ROOTS[capability.id];
  const declared = new Map();
  for (const item of capability.files) {
    requireEvidence(isPackagePath(item?.file) && !declared.has(item.file) && isSha256(item.sha256)
      && digests.get(prefix + item.file) === item.sha256 && files.get(prefix + item.file)?.length > 0,
      `正式 ${label} 数据包文件缺失或摘要不一致`);
    declared.set(item.file, item.sha256);
  }
  requireEvidence([...digests.keys()].filter(file => file.startsWith(prefix)).length === declared.size,
    `正式 ${label} 数据包含锁外文件`);
  for (const item of [capability.schema, ...capability.data.migrations]) {
    requireEvidence(isSha256(item?.sha256) && declared.get(item.file) === item.sha256, `正式 ${label} 数据包缺少 schema 或原 SQL`);
  }
  requireEvidence(["package.json", "LICENSE", "README.md"].every(file => declared.has(file)), `正式 ${label} 数据包缺少包清单、许可或说明`);
  const metadata = readJson(files.get(prefix + "package.json"), `正式 ${label} 数据包清单`);
  requireEvidence(metadata.name === `@rental-os/${prefix.split("/")[1]}` && metadata.version === capability.version && metadata.license === "MIT",
    `正式 ${label} 数据包身份或版本不一致`);
  return { declared, metadata };
}

function verifyCapabilityExports({ declared, metadata }, entries, condition, label) {
  for (const name of entries) {
    const target = metadata.exports?.[`./${name}`];
    const runtime = `dist/${name}.js`, types = `dist/${name}.d.ts`;
    requireEvidence(target?.[condition] === `./${runtime}` && target?.types === `./${types}` && declared.has(runtime) && declared.has(types),
      `缺少正式 ${label} 数据包运行入口 ${runtime}`);
  }
}

function verifyAiData(capability, context, files, digests) {
  const variant = AI_RELEASES.get(capability.version);
  requireEvidence(variant && capability.data?.version === variant.dataVersion && capability.sha256 === context.aiDataSha256,
    "AI 数据发行版本、数据版本或宿主摘要不一致");
  const material = verifyCapabilityFiles(capability, files, digests, variant.schema, "AI");
  verifyCapabilityExports(material, variant.entries, "default", "AI");
  if (capability.version === "0.2.0") {
    const [initial] = capability.data.migrations;
    requireEvidence(material.declared.size === 12 && material.declared.has("prisma-public/provenance.json")
      && capability.data.migrations.length === 1 && initial.id === "ai-native.20261126000000-public-initial"
      && initial.file === "prisma-public/20261126000000-initial.sql" && capability.prerequisites.cores.length === 0,
      "公共 AI 数据包的新装迁移、来源材料或前置不一致");
  } else {
    requireEvidence(capability.data.migrations.every(item => /^prisma\/migrations\/[^/]+\/migration\.sql$/u.test(item.file)),
      "旧 AI 数据包须保留原迁移目录");
  }
}

function verifyMcpData(capability, files, digests) {
  requireEvidence(capability.version === "0.1.0" && capability.data?.version === "0.1.0", "MCP 数据包发行版本不一致");
  const material = verifyCapabilityFiles(capability, files, digests, "prisma/schema.prisma", "MCP");
  verifyCapabilityExports(material, ["data-capability", "mysql-data"], "import", "MCP");
  requireEvidence(material.metadata.exports?.["./data-contribution.json"] === `./${MCP_MANIFEST}`, "MCP 缺少正式包内数据清单出口");
  const raw = new Map([...material.declared.keys()].filter(file => file === MCP_MANIFEST || file.endsWith(".sql"))
    .map(file => [file, files.get(CAPABILITY_ROOTS.mcp + file)]));
  const sql = verifyMcpSql(raw);
  const migrations = capability.data.migrations;
  requireEvidence(sql.length === MCP_MIGRATIONS.length && migrations.length === MCP_MIGRATIONS.length
    && MCP_MIGRATIONS.every(([id, file], index) => sql[index].id === file
      && isDeepStrictEqual(migrations[index], { id, file, sha256: sql[index].sha256 })),
    "正式 MCP 迁移身份、五份原 SQL 或顺序不一致");
}

function verifyDeployment(files, deployment, lock, capabilities, digests) {
  const prepared = file => describe(files, DEPLOYMENT_ROOT + file, file);
  const metadata = {
    lock: prepared("core.deployment.lock.json"),
    schema: prepared("schema.prisma"),
    migrationLock: prepared("migrations/migration_lock.toml"),
  };
  requireEvidence(Object.entries(metadata).every(([key, item]) => isDeepStrictEqual(deployment[key], item)),
    "部署锁、schema 或 migration_lock 摘要不一致");
  requireEvidence(isDeepStrictEqual(deployment.data, { platform: lock.platform, cores: lock.cores, capabilities }),
    "部署收据的数据合同与部署锁不一致");
  const owners = [
    { owner: "platform", release: lock.platform, root: "apps/platform-api/", prefix: "" },
    ...lock.cores.map(pin => ({ owner: pin.manifest.id, release: { ...pin.manifest, sha256: pin.sha256 },
      root: "packages/rental-core/", prefix: `core.${pin.manifest.id}.` })),
    ...capabilities.map(release => ({ owner: release.id, release, root: CAPABILITY_ROOTS[release.id], prefix: "platform-capability." })),
  ];
  const expected = [];
  const data = {};
  const directories = new Set();
  for (const { owner, release, root, prefix } of owners) {
    const source = fixedSource(release.source);
    const contract = release.data;
    requireEvidence(isSha256(release.sha256) && typeof contract?.version === "string" && contract.readable
      && Array.isArray(contract.migrations) && contract.migrations.length > 0, "缺少所选所有者的正式迁移合同");
    data[owner] = { version: contract.version, readable: contract.readable, schema: release.schema, prerequisites: release.prerequisites };
    const ids = new Set();
    let previousDirectory = "";
    for (const migration of contract.migrations) {
      requireEvidence(typeof migration?.id === "string" && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(migration.id)
        && !ids.has(migration.id) && isPackagePath(migration.file) && migration.file.endsWith(".sql")
        && isSha256(migration.sha256), "部署锁迁移条目无效或重复");
      ids.add(migration.id);
      const directory = prefix ? prefix + migration.id : /^prisma\/migrations\/([a-z0-9_]+)\/migration\.sql$/u.exec(migration.file)?.[1];
      requireEvidence(directory && directory > previousDirectory && !directories.has(directory)
        && (prefix !== "platform-capability." || migration.id.startsWith(`${owner}.`)), "部署迁移目录、能力归属或顺序不一致");
      previousDirectory = directory;
      directories.add(directory);
      const file = prepared(`migrations/${directory}/migration.sql`);
      requireEvidence(file.sha256 === migration.sha256 && digests.get(root + migration.file) === migration.sha256,
        `部署 SQL 与锁定原文不一致 ${directory}`);
      expected.push({ owner, source, assetSha256: release.sha256, id: migration.id, originalPath: migration.file,
        originalDirectory: posix.dirname(migration.file), directory,
        ledger: { table: "_prisma_migrations", migrationName: directory, checksum: file.sha256 }, file });
    }
  }
  expected.sort((left, right) => left.directory < right.directory ? -1 : 1);
  requireEvidence(isDeepStrictEqual(deployment.migrations, expected.map((entry, order) => ({ order, ...entry }))),
    "部署收据的迁移归属、顺序、原账或原文不一致");
  const expectedFiles = [...Object.values(metadata), ...expected.map(item => item.file)];
  requireEvidence(Array.isArray(deployment.files), "缺少 prepared 文件清单");
  const reported = new Map(deployment.files.map(item => [item?.path, item]));
  const actualFiles = [...digests.keys()].filter(file => file.startsWith(DEPLOYMENT_ROOT));
  requireEvidence(deployment.files.length === expectedFiles.length && reported.size === expectedFiles.length
    && actualFiles.length === expectedFiles.length && expectedFiles.every(item => isDeepStrictEqual(reported.get(item.path), item)),
  "prepared 迁移目录存在遗漏或额外材料");
  return { data, schemaSha256: metadata.schema.sha256, migrationLockSha256: metadata.migrationLock.sha256,
    entries: expected.map(({ owner, id, originalPath, directory, file, ledger }) => ({ owner, id, originalPath, directory, sha256: file.sha256, ledger })) };
}

function verifyBuildProvenance(files, context, source, identity, lock, migrations, digests, requireFixedBuild) {
  const reference = context.buildProvenance;
  if (reference === undefined && !digests.has(BUILD_FILE) && !requireFixedBuild) return;
  requireEvidence(reference?.file === BUILD_FILE && isSha256(reference.sha256) && digests.get(BUILD_FILE) === reference.sha256,
    "缺少固定宿主构建证明引用、文件或对应摘要");
  const proof = readJson(files.get(BUILD_FILE), BUILD_FILE);
  requireEvidence(proof.format === "rental-host-fixed-build-1" && proof.sourceSha256 === digests.get(SOURCE_FILE)
    && proof.npmLockSha256 === identity.npmLocks.projected && proof.deploymentLockSha256 === identity.deploymentLockSha256
    && isDeepStrictEqual(proof.platform, identity.platform) && isDeepStrictEqual(proof.rental, identity.rental),
    "固定宿主构建证明的双仓来源、投影锁或部署锁不一致");

  const platformBuild = context.platformBuild;
  const { version, sha256: compilerSha256 } = proof.compiler ?? {};
  requireEvidence(isDeepStrictEqual(platformBuild.release, lock.platform) && typeof version === "string"
    && version.length > 0 && isSha256(compilerSha256)
    && isDeepStrictEqual(platformBuild.compiler, { name: "typescript", version, sha256: compilerSha256 }),
    "固定宿主构建的底座发行或编译器证据不一致");
  requireEvidence(Array.isArray(source.files), "缺少固定构建的双仓源码文件表");
  const sourceFiles = new Map(source.files.map(item => [item?.path, item]));
  const hasSource = file => {
    const item = sourceFiles.get(file);
    return isSha256(item?.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0;
  };
  const projected = sourceFiles.get("package-lock.json");
  requireEvidence(sourceFiles.size === source.files.length && projected?.sha256 === proof.npmLockSha256
    && projected.bytes === source.npmLocks.projected.bytes, "固定宿主构建与来源文件表的投影锁不一致");
  const projects = [...CONTRACT_PROJECTS,
    ...(sourceFiles.has("packages/ai-native-data/package.json") ? ["packages/ai-native-data/tsconfig.json"] : []),
    "apps/rental-api/tsconfig.json",
    ...(source.ai ? ["packages/ai-native-server/tsconfig.json", "apps/rental-api/tsconfig.ai.json"] : [])];
  requireEvidence(!source.mcp, "当前固定构建合同尚无正式 MCP 宿主编译证明");
  requireEvidence(Array.isArray(proof.projects) && isDeepStrictEqual(proof.projects.map(item => item?.config), projects)
    && proof.projects.every(item => hasSource(item.config) && item.diagnostics === 0
      && [item.roots, item.sourceFiles, item.outputs].every(value => Number.isSafeInteger(value) && value > 0))
    && Array.isArray(platformBuild.projects) && isDeepStrictEqual(platformBuild.projects.map(item => item?.project), PLATFORM_PROJECTS)
    && platformBuild.projects.every(item => hasSource(item.project) && isSha256(item.inputsSha256)),
    "固定宿主构建的编译项目、源码配置或诊断不一致");

  const platformClient = platformBuild.client;
  requireEvidence(Array.isArray(proof.clients) && proof.clients.length === 2 && proof.clients.every(item => isSha256(item?.declarationsSha256))
    && proof.clients.some(item => item.host === "platform" && item.mode === "platform" && item.schemaSha256 === migrations.platformSchemaSha256
      && platformClient?.mode === item.mode && platformClient.schemaSha256 === item.schemaSha256
      && platformClient.generatedSchemaSha256 === item.schemaSha256 && platformClient.declarationsSha256 === item.declarationsSha256)
    && proof.clients.some(item => item.host === "rental" && item.mode === (source.ai ? "rental-ai" : "rental")
      && item.schemaSha256 === migrations.schemaSha256), "固定宿主构建的 Client 声明、schema 或选择不一致");

  const expectedOutputs = new Map([...digests].filter(([file]) => RUNTIME_OUTPUT.test(file)
    && !file.startsWith("packages/rental-core/") && !(source.ai && file.startsWith(CAPABILITY_ROOTS["ai-native"]))));
  requireEvidence(Array.isArray(proof.files) && proof.files.length === expectedOutputs.size && expectedOutputs.has(context.entry),
    "固定宿主构建证明与实际入包产物集合不一致");
  for (const item of proof.files) {
    requireEvidence(isSha256(item?.sha256) && expectedOutputs.get(item.file) === item.sha256,
      "固定宿主构建的入包产物缺失、重复或摘要不一致");
    expectedOutputs.delete(item.file);
  }
  return reference.sha256;
}

function verifyPreparedRental(files, expectedContextSha256, { requireFixedBuild = false } = {}) {
  const contextBytes = files.get(CONTEXT_FILE);
  requireEvidence(Buffer.isBuffer(contextBytes), "缺少正式 prepared 宿主收据，旧组合须先核定原库桥接");
  requireEvidence(isSha256(expectedContextSha256) && sha256(contextBytes) === expectedContextSha256, "宿主收据与已核摘要不一致");
  const context = readJson(contextBytes, CONTEXT_FILE);
  requireEvidence(context.format === "rental-host-context-1" && context.host === "rental" && context.deployment === "pending"
    && context.imageBuild === "not-run" && context.deploymentProvenance === DEPLOYMENT_FILE, "须使用正式 Rental prepared 宿主材料");
  const digests = verifyContextFiles(files, context);
  requireEvidence(context.sourceProvenance?.file === SOURCE_FILE && digests.has(SOURCE_FILE)
    && context.sourceProvenance.sha256 === digests.get(SOURCE_FILE), "宿主缺少正式双来源证明");
  const source = readJson(files.get(SOURCE_FILE), SOURCE_FILE);
  requireEvidence(source.format === "nativark-core-development-source-2" && source.mode === "release" && source.host === "rental"
    && ["host", "full"].includes(source.profile) && isDeepStrictEqual(source.coreIds, ["rental"])
    && typeof source.ai === "boolean" && typeof source.mcp === "boolean", "需要 release 模式的 Rental 宿主双来源，domain 源码不能作为候选");
  requireEvidence(source.mcp ? source.ai && context.mcpMode === "enabled" && typeof context.mcpEntry === "string"
    && /^apps\/rental-api\/dist-mcp\/[a-z0-9][a-z0-9-]*\.js$/u.test(context.mcpEntry)
    : context.mcpMode === "disabled" && context.mcpEntry === undefined, "缺少正式 MCP 宿主入口或选择不一致");
  requireEvidence(context.aiMode === (source.ai ? "enabled" : "disabled"), "AI 选择与宿主收据不一致");
  const entry = source.mcp ? context.mcpEntry : `apps/rental-api/${source.ai ? "dist-ai/ai-main.js" : "dist/main.js"}`;
  requireEvidence(context.entry === entry && files.get(entry)?.length > 0, "宿主缺少所选运行入口");
  for (const file of ["Dockerfile", "package.json", "verify-runtime.cjs"]) {
    requireEvidence(files.get(file)?.length > 0, `缺少正式宿主材料 ${file}`);
  }

  const deployment = readJson(files.get(DEPLOYMENT_FILE), DEPLOYMENT_FILE);
  requireEvidence(deployment.format === "rental-host-deployment-provenance-1" && deployment.state === "prepared" && deployment.deployment === "pending",
    "缺少正式 prepared 部署来源");
  const lockFile = DEPLOYMENT_ROOT + "core.deployment.lock.json";
  const deploymentLockSha256 = digests.get(lockFile);
  requireEvidence(deploymentLockSha256 && deploymentLockSha256 === context.deploymentLockSha256, "正式部署锁缺失或与宿主收据不一致");
  const lock = readJson(files.get(lockFile), "core.deployment.lock.json");
  const pin = lock.cores?.[0];
  requireEvidence(lock.lockVersion === 1 && Array.isArray(lock.cores) && lock.cores.length === 1 && pin?.manifest?.id === "rental"
    && isSha256(pin.sha256) && pin.sha256 === context.coreSha256 && isSha256(lock.platform?.sha256)
    && context.platformBuild?.sourceArchiveSha256 === lock.platform.sha256, "部署锁与宿主的固定底座或 Rental 包不一致");
  const platform = fixedSource(source.platform?.source);
  const rental = fixedSource(source.core?.source);
  requireEvidence(platform.repository.toLowerCase() !== rental.repository.toLowerCase()
    && isDeepStrictEqual(platform, lock.platform.source) && isDeepStrictEqual(rental, pin.manifest.source)
    && typeof source.platform.version === "string" && source.platform.version === lock.platform.versions?.platform
    && typeof source.core.version === "string" && source.core.version === pin.manifest.version && source.core.tag === `v${source.core.version}`,
    "双仓源码与部署锁中的正式发行身份不一致");
  requireEvidence(isDeepStrictEqual(readJson(files.get("packages/rental-core/core.manifest.json"), "Rental 固定包清单"), pin.manifest),
    "部署锁和实际 Rental 包清单不一致");

  const capabilities = lock.dataCapabilities === undefined ? [] : lock.dataCapabilities;
  const selectedCapabilities = source.mcp ? ["ai-native", "mcp"] : source.ai ? ["ai-native"] : [];
  requireEvidence(Array.isArray(capabilities) && isDeepStrictEqual(capabilities.map(capability => capability?.id).sort(), selectedCapabilities),
    "缺少所选 AI/MCP 能力的正式部署材料，或部署锁与选择不一致");
  if (source.ai) verifyAiData(capabilities.find(item => item.id === "ai-native"), context, files, digests);
  if (source.mcp) verifyMcpData(capabilities.find(item => item.id === "mcp"), files, digests);
  const npm = source.npmLocks;
  const npmLocks = {
    platform: lockDigest(npm?.platform, "底座原 npm 锁", "package-lock.json"),
    rental: npm?.rental === null ? null : lockDigest(npm?.rental, "Rental 原 npm 锁"),
    projected: lockDigest(npm?.projected, "组合 npm 投影锁", "package-lock.json"),
    runtime: describe(files, "package-lock.json").sha256,
  };
  requireEvidence(npmLocks.projected === context.originalNpmLockSha256 && readJson(files.get("package-lock.json"), "运行 npm 锁").lockfileVersion === 3,
    "组合 npm 投影锁与宿主收据不一致，或运行锁缺少 npm v3 格式");
  const migrations = verifyDeployment(files, deployment, lock, capabilities, digests);
  migrations.platformSchemaSha256 = describe(files, "apps/platform-api/prisma/schema.prisma").sha256;
  requireEvidence(Array.isArray(context.clients) && context.clients.length === 2
    && context.clients.some(item => item?.directory === "apps/platform-api/generated/client" && item.mode === "platform"
      && item.schemaSha256 === migrations.platformSchemaSha256)
    && context.clients.some(item => item?.directory === "apps/rental-api/generated/client" && item.mode === (source.ai ? "rental-ai" : "rental")
      && item.schemaSha256 === migrations.schemaSha256), "所选 Client 收据与锁定 schema 不一致");
  const identity = { format: "rental-release-identity-1", platform, rental,
    selection: { host: source.host, profile: source.profile, coreIds: source.coreIds, ai: source.ai, mcp: source.mcp },
    npmLocks, deploymentLockSha256, contextSha256: expectedContextSha256 };
  const buildProvenanceSha256 = verifyBuildProvenance(files, context, source, identity, lock, migrations, digests, requireFixedBuild);
  if (buildProvenanceSha256) identity.buildProvenanceSha256 = buildProvenanceSha256;
  const result = { identity, identitySha256: sha256(JSON.stringify(identity)), migrations,
    versions: { platform: source.platform.version, rental: source.core.version } };
  if (buildProvenanceSha256) verifiedCandidates.set(result, result.identitySha256);
  return result;
}

function isVerifiedFixedBuildCandidate(candidate) {
  const digest = verifiedCandidates.get(candidate);
  return digest !== undefined && digest === candidate.identitySha256 && digest === sha256(JSON.stringify(candidate.identity));
}

function compareEntries(previous, candidate) {
  const index = entries => new Map(entries.map(entry => [`${entry.owner}/${entry.id}`, entry]));
  const before = index(previous), after = index(candidate);
  const shared = [...before.keys()].filter(key => after.has(key));
  const changes = {
    added: [...after.keys()].filter(key => !before.has(key)),
    removed: [...before.keys()].filter(key => !after.has(key)),
    changed: shared.filter(key => !isDeepStrictEqual(before.get(key), after.get(key))),
    reordered: !isDeepStrictEqual(shared, [...after.keys()].filter(key => before.has(key))),
  };
  return { ...changes, different: Boolean(changes.added.length || changes.removed.length || changes.changed.length || changes.reordered) };
}

function comparePreparedRental(previous, candidate) {
  const before = previous.migrations, after = candidate.migrations;
  const entries = compareEntries(before.entries, after.entries);
  const schemaChanged = before.schemaSha256 !== after.schemaSha256 || before.platformSchemaSha256 !== after.platformSchemaSha256;
  const migrationLockChanged = before.migrationLockSha256 !== after.migrationLockSha256;
  const dataChanged = !isDeepStrictEqual(before.data, after.data);
  const aiVersions = [before.data["ai-native"]?.version, after.data["ai-native"]?.version];
  const requiresAiDataBridge = aiVersions.includes("0.1.0") && aiVersions.includes("0.2.0");
  const { ai: beforeAi, mcp: beforeMcp, coreIds: beforeCores } = previous.identity.selection;
  const { ai, mcp, coreIds } = candidate.identity.selection;
  const selectionChanged = beforeAi !== ai || beforeMcp !== mcp || !isDeepStrictEqual(beforeCores, coreIds);
  return { entries, schemaChanged, migrationLockChanged, dataChanged, selectionChanged, requiresAiDataBridge,
    different: entries.different || schemaChanged || migrationLockChanged || dataChanged || selectionChanged };
}

function verifyMcpSql(files) {
  const manifest = readJson(files.get(MCP_MANIFEST), "固定 MCP 原始数据清单");
  requireEvidence(manifest.formatVersion === 1 && manifest.capabilityId === "mcp" && manifest.owner === "platform-capability:mcp"
    && manifest.provider === "mysql" && Array.isArray(manifest.sql) && manifest.sql.length > 0
    && files.size === manifest.sql.length + 1, "MCP SQL 清单与固定文件集合不一致");
  const seen = new Set();
  return manifest.sql.map(item => {
    requireEvidence(typeof item?.file === "string" && MCP_SQL.test(item.file) && !seen.has(item.file) && isSha256(item.sha256)
      && Array.isArray(item.requires) && new Set(item.requires).size === item.requires.length
      && item.requires.every(file => seen.has(file)), "MCP SQL 文件、依赖或原定顺序不一致");
    requireEvidence(describe(files, item.file).sha256 === item.sha256, `MCP SQL 摘要不一致 ${item.file}`);
    seen.add(item.file);
    return { owner: manifest.owner, id: item.file, sha256: item.sha256, requires: [...item.requires].sort() };
  });
}

module.exports = { isFullCommit, isSha256, CONTEXT_FILE, MCP_MANIFEST, MCP_SQL, isPackagePath, readJson, sha256,
  verifyPreparedRental, isVerifiedFixedBuildCandidate, comparePreparedRental, verifyMcpSql, compareEntries };
