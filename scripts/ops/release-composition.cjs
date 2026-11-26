"use strict";

/** 核对正式宿主收据与实际字节，比较离线数据材料。数据库状态和发布批准由原入口另行核定。 */
const { createHash } = require("node:crypto");
const { posix } = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const CONTEXT_FILE = "rental-host.context.json";
const SOURCE_FILE = "development.workspace.json";
const DEPLOYMENT_FILE = "rental-host.deployment-provenance.json";
const DEPLOYMENT_ROOT = "apps/rental-api/prisma-deployment/";
const MCP_MANIFEST = "data-contribution.json";
const MCP_SQL = /^mysql-[a-z0-9-]+\.sql$/u;
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

function verifyAiData(capability, context, files, digests) {
  requireEvidence(isSha256(capability.sha256) && capability.sha256 === context.aiDataSha256
    && capability.prerequisites && Array.isArray(capability.files) && Array.isArray(capability.data?.migrations) && capability.schema,
    "缺少正式锁定的 AI 数据包及前置");
  const prefix = "packages/ai-native-data/";
  const declared = new Map();
  for (const item of capability.files) {
    requireEvidence(isPackagePath(item?.file) && !declared.has(item.file) && isSha256(item.sha256)
      && digests.get(prefix + item.file) === item.sha256, "正式 AI 数据包文件缺失或摘要不一致");
    declared.set(item.file, item.sha256);
  }
  for (const item of [capability.schema, ...capability.data.migrations]) {
    requireEvidence(isSha256(item?.sha256) && declared.get(item.file) === item.sha256, "正式 AI 数据包缺少 schema 或原 SQL");
  }
  const metadata = readJson(files.get(prefix + "package.json"), "正式 AI 数据包清单");
  requireEvidence(declared.has("package.json") && metadata.name === "@rental-os/ai-native-data" && metadata.version === capability.version
    && declared.has("dist/data-package.js") && files.get(prefix + "dist/data-package.js")?.length > 0, "缺少正式 AI 数据包运行入口或版本不一致");
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
    ...capabilities.map(release => ({ owner: release.id, release, root: "packages/ai-native-data/", prefix: "platform-capability." })),
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
        && (owner !== "ai-native" || migration.id.startsWith("ai-native.")), "部署迁移目录重复或顺序不一致");
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

function verifyPreparedRental(files, expectedContextSha256) {
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
  requireEvidence(!source.mcp && context.mcpMode === "disabled" && context.mcpEntry === undefined,
    "缺少正式 MCP 能力部署包和原账适配，原 SQL 清单仅供比较");
  requireEvidence(context.aiMode === (source.ai ? "enabled" : "disabled"), "AI 选择与宿主收据不一致");
  const entry = `apps/rental-api/${source.ai ? "dist-ai/ai-main.js" : "dist/main.js"}`;
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
  requireEvidence(Array.isArray(capabilities) && isDeepStrictEqual(capabilities.map(capability => capability?.id), source.ai ? ["ai-native"] : []),
    "缺少所选能力的正式部署材料，或部署锁能力与选择不一致");
  if (source.ai) verifyAiData(capabilities[0], context, files, digests);
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
  return { identity, identitySha256: sha256(JSON.stringify(identity)), migrations };
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
  const { ai: beforeAi, mcp: beforeMcp, coreIds: beforeCores } = previous.identity.selection;
  const { ai, mcp, coreIds } = candidate.identity.selection;
  const selectionChanged = beforeAi !== ai || beforeMcp !== mcp || !isDeepStrictEqual(beforeCores, coreIds);
  return { entries, schemaChanged, migrationLockChanged, dataChanged, selectionChanged,
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

module.exports = { isFullCommit, isSha256, CONTEXT_FILE, MCP_MANIFEST, MCP_SQL, isPackagePath, sha256,
  verifyPreparedRental, comparePreparedRental, verifyMcpSql, compareEntries };
