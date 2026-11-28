/** 安装的真实只读观察和显式账号初始化。复用原迁移账、物理读取器与账号语义。
 * 不加载环境文件、不迁移或启动服务；Core 组合由所属宿主提供观察，不能套用零 Core 计划。 */
import "reflect-metadata";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CORE_CONTRACT_VERSION, CoreDeploymentLockSchema, checkPlatformDataCapabilities,
  type CoreDeploymentLock, type CoreDataObservation } from "@rental-os/core-contracts";
import { createMysqlCoreDeploymentObservation, type CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import { mysqlStructureFromMigrations, readMysqlPhysicalData } from "@rental-os/platform-core-host";
import { initializePublicPlatform, PlatformManagementRepository } from "@rental-os/platform-server";
import { Prisma, PrismaClient } from "../generated/client";
import { createPublicPlatformDataPlan } from "./platform-data";

export type InstallationProfile = "platform" | "public-ai";
type Migration = { name: string; id: string; sha256: string; sql: string };
export interface InstallationSelection {
  profile: InstallationProfile;
  platform: CoreMysqlDataPlan;
  capability?: CoreMysqlDataPlan;
  lock?: CoreDeploymentLock;
  schema: string;
  migrations: Migration[];
  sha256: string;
}
type Receipt = { name: string; checksum: string; finished: Date | null; rolledBack: Date | null; failed: number | bigint };
export interface InstallationObservation {
  checked: boolean;
  state: "unknown" | "incompatible" | "migration_incomplete" | "empty" | "migration_pending" | "ready";
  reason: string;
  selectionSha256: string;
  applied: number | null;
  pending: number | null;
  initialization: { state: "not_checked" | "uninitialized" | "initialized" | "conflict";
    receipt?: "recorded" | "not_found"; mustChangePassword?: boolean };
  interrupted?: { migration: string; sha256: string; state: "failed" | "unknown" };
  data?: CoreDataObservation;
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function grantCoversDatabase(scope: string, name: string | null | undefined): boolean {
  if (!name) return false;
  if (scope === "*.*") return true;
  // SHOW GRANTS 保留数据库模式的 \_ / \%（官方 MySQL 镜像会转义库名）。
  // 只接纳还原后恰为当前库的模式，不推测其他通配模式或特殊反斜线库名。
  const quoted = /^`((?:[^`]|``)+)`\.\*$/.exec(scope);
  return Boolean(quoted && !name.includes("\\")
    && quoted[1].replaceAll("``", "`").replace(/\\([_%])/g, "$1") === name);
}

/** AI 计划由同树正式 AI SDK 解析固定包后提供；公共构建不静态依赖可选 SDK。 */
export function selectInstallation(input: { profile: InstallationProfile; lock?: unknown; capability?: CoreMysqlDataPlan }): InstallationSelection {
  const platform = createPublicPlatformDataPlan();
  const lock = input.lock === undefined ? undefined : CoreDeploymentLockSchema.parse(input.lock);
  if (lock && (lock.cores.length || lock.platform.versions.node !== process.versions.node
    || lock.platform.versions.contract !== CORE_CONTRACT_VERSION || !isDeepStrictEqual(lock.platform.data, platform.data)
    || checkPlatformDataCapabilities(lock).length)) throw new Error("installation_selection");
  if (input.profile === "platform" ? Boolean(input.capability || lock?.dataCapabilities?.length)
    : !lock || lock.dataCapabilities?.length !== 1 || lock.dataCapabilities[0].id !== "ai-native"
      || !input.capability || !isDeepStrictEqual(input.capability.data, lock.dataCapabilities[0].data))
    throw new Error("installation_profile");
  const schema = resolve(__dirname, input.profile === "platform" ? "../prisma/schema.prisma" : "../prisma-deployment/schema.prisma");
  const directory = resolve(dirname(schema), "migrations");
  const migrations = [platform, ...(input.capability ? [input.capability] : [])].flatMap(plan =>
    plan.data.migrations.map((item, index) => {
      const name = plan.migrationNames[index];
      if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("migration_name");
      const bytes = readFileSync(resolve(directory, name, "migration.sql"));
      if (hash(bytes) !== item.sha256) throw new Error("migration_digest");
      return { name, id: item.id, sha256: item.sha256, sql: bytes.toString("utf8") };
    })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const entries = readdirSync(directory, { withFileTypes: true });
  if (new Set(migrations.map(item => item.name)).size !== migrations.length
    || entries.some(item => item.isSymbolicLink() || (item.name === "migration_lock.toml" ? !item.isFile()
      : !item.isDirectory() || !migrations.some(migration => migration.name === item.name)))
    || migrations.some(item => !entries.some(entry => entry.name === item.name))) throw new Error("migration_inventory");
  const sha256 = hash(JSON.stringify({ profile: input.profile, node: process.versions.node, lock,
    schema: hash(readFileSync(schema)), migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })) }));
  return { profile: input.profile, platform, capability: input.capability, lock, schema, migrations, sha256 };
}

/** 只读账号投影复用原仓储的启用/租户/角色规则；既有管理员不可用不会被诊断修复。 */
async function initialization(database: PrismaClient, transaction: Prisma.TransactionClient): Promise<InstallationObservation["initialization"]> {
  const tenant = await transaction.tenant.findUnique({ where: { code: "platform" } });
  if (!tenant) {
    const remnants = await Promise.all([
      transaction.user.findUnique({ where: { id: "user_saas_admin" }, select: { id: true } }),
      transaction.role.findUnique({ where: { id: "role_saas_admin" }, select: { id: true } }),
      transaction.organizationUnit.findUnique({ where: { id: "org_saas_platform" }, select: { id: true } }),
      transaction.tenant.findUnique({ where: { id: "tenant_platform" }, select: { id: true } })
    ]);
    return { state: remnants.some(Boolean) ? "conflict" : "uninitialized" };
  }
  const admin = await new PlatformManagementRepository(database).findUserById("user_saas_admin", transaction);
  if (!admin?.isSaasAdmin || admin.tenantId !== tenant.id || !admin.permissions.includes("system:tenant:manage")
    || !admin.permissions.includes("system:tenant:bootstrap")) return { state: "conflict" };
  const receipt = await transaction.operationLog.findFirst({ where: { tenantId: tenant.id,
    userId: "user_saas_admin", action: "platform.initialized" }, select: { id: true } });
  return { state: "initialized", receipt: receipt ? "recorded" : "not_found", mustChangePassword: admin.mustChangePassword };
}

/** 必须由显式命令传入 Client。无法读取不是空库；未结束原收据不自动重放。 */
export async function observeInstallation(database: PrismaClient, selected: InstallationSelection): Promise<InstallationObservation> {
  const result: InstallationObservation = { checked: false, state: "unknown", reason: "database_unavailable",
    selectionSha256: selected.sha256, applied: null, pending: null, initialization: { state: "not_checked" } };
  let stage = "metadata_visibility";
  try {
    return await database.$transaction(async (tx): Promise<InstallationObservation> => {
      // information_schema 只显示本账号可见对象。没有库级可见性不能把零行断言为空库。
      // 不输出 SHOW GRANTS 内容；角色/部分撤权等未覆盖形式保持 unknown。
      const databases = await tx.$queryRaw<Array<{ name: string | null }>>`SELECT DATABASE() AS name`;
      const grants = await tx.$queryRaw<Array<Record<string, string>>>`SHOW GRANTS FOR CURRENT_USER`;
      const name = databases[0]?.name;
      const permissions = new Set<string>();
      let routineVisible = false, revoked = false;
      for (const row of grants) for (const text of Object.values(row)) {
        if (/^REVOKE\b/.test(text)) revoked = true;
        const match = /^GRANT (.+) ON (.+) TO /.exec(text);
        if (!match || !grantCoversDatabase(match[2], name)) continue;
        const values = match[1].split(", ");
        if (values.includes("ALL PRIVILEGES")) {
          for (const permission of ["SELECT", "SHOW VIEW", "TRIGGER", "EVENT"]) permissions.add(permission);
          // schema ALL 含 CREATE/ALTER ROUTINE，MySQL 对该库原过程提供元数据。
          routineVisible = true;
        } else {
          for (const permission of values) permissions.add(permission);
          if (match[2] === "*.*" && values.includes("SHOW_ROUTINE")) routineVisible = true;
          if (values.includes("CREATE ROUTINE") || values.includes("ALTER ROUTINE")) routineVisible = true;
        }
      }
      if (!name || revoked || !routineVisible || ["SELECT", "SHOW VIEW", "TRIGGER", "EVENT"].some(value => !permissions.has(value)))
        return { ...result, reason: "metadata_visibility_unverified" };
      stage = "database_inventory";
      const objects = await tx.$queryRaw<Array<{ name: string; kind: string }>>`
        SELECT TABLE_NAME AS name, TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
        UNION ALL SELECT ROUTINE_NAME, 'ROUTINE' FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()
        UNION ALL SELECT EVENT_NAME, 'EVENT' FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()
        UNION ALL SELECT TRIGGER_NAME, 'TRIGGER' FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()`;
      result.checked = true;
      if (!objects.length) return { ...result, state: "empty", reason: "no_database_objects", applied: 0, pending: selected.migrations.length };
      if (!objects.some(row => row.name === "_prisma_migrations" && row.kind === "BASE TABLE"))
        return { ...result, state: "incompatible", reason: "original_ledger_missing" };
      stage = "original_ledger";
      const receipts = await tx.$queryRaw<Receipt[]>`
        SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS rolledBack,
          (logs IS NOT NULL AND logs <> '') AS failed FROM _prisma_migrations ORDER BY started_at, id
        LIMIT ${selected.migrations.length + 1}`;
      result.applied = 0;
      result.pending = selected.migrations.length;
      for (const [index, row] of receipts.entries()) {
        const expected = selected.migrations[index];
        if (!expected || row.name !== expected.name || row.checksum !== expected.sha256 || row.rolledBack)
          return { ...result, state: "incompatible", reason: "original_ledger_conflict" };
        if (!row.finished || Number(row.failed)) return { ...result, state: "migration_incomplete", reason: "original_migration_unfinished",
          interrupted: { migration: expected.id, sha256: expected.sha256, state: Number(row.failed) ? "failed" : "unknown" } };
        result.applied++;
        result.pending--;
      }
      const applied = selected.migrations.slice(0, result.applied);
      stage = "physical_observation";
      if (result.pending) {
        // 公共 AI 的回填由 AI 数据所有者核定；未完成 AI 链不能用通用 DDL 解析器补出成功。
        if (applied.some(item => !selected.platform.migrationNames.includes(item.name)))
          return { ...result, state: "unknown", reason: "capability_partial_requires_owner" };
        const expected = applied.length ? mysqlStructureFromMigrations(applied.map(item => item.sql)) : [];
        const names = new Set(["_prisma_migrations", ...expected.map(table => table.name)]);
        if (objects.length !== names.size || objects.some(row => row.kind !== "BASE TABLE" || !names.has(row.name))
          || expected.length && !await readMysqlPhysicalData(tx, expected, selected.platform.data.version))
          return { ...result, state: "incompatible", reason: "physical_prefix_conflict" };
        return { ...result, state: "migration_pending", reason: "verified_platform_prefix" };
      }
      const names = new Set(["_prisma_migrations", ...Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name)]);
      if (objects.length !== names.size || objects.some(row => row.kind !== "BASE TABLE" || !names.has(row.name)))
        return { ...result, state: "incompatible", reason: "unexpected_database_objects" };
      const data = await createMysqlCoreDeploymentObservation({ database: tx, platform: selected.platform, cores: [],
        ...(selected.capability ? { dataCapabilities: [{ ...selected.capability, capabilityId: "ai-native" }] } : {}) }).read();
      if (data.platform.execution?.state !== "ready" || selected.capability && data.dataCapabilities?.[0]?.execution.state !== "ready")
        return { ...result, state: "unknown", reason: "physical_observation_unavailable" };
      stage = "initialization_observation";
      return { ...result, state: "ready", reason: "original_ledger_and_physical_match", data,
        initialization: await initialization(database, tx) };
    }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
  } catch {
    // Prisma/SQL 错误可能包含连接串或行内容，只公布固定原因。
    return { ...result, state: "unknown", reason: stage + "_unavailable" };
  }
}

export async function initializeInstallation(database: PrismaClient, selected: InstallationSelection, password: string) {
  const before = await observeInstallation(database, selected);
  if (before.state !== "ready" || !["uninitialized", "initialized"].includes(before.initialization.state))
    throw new Error("installation_not_ready");
  // 原服务在写入事务重新核账号；不复制账号、权限目录或授予逻辑。
  const result = await initializePublicPlatform(database, password);
  const after = await observeInstallation(database, selected);
  return { result, observation: after };
}
