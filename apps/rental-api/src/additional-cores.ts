/** Rental 宿主显式选择额外租户 Core 的固定包、数据及 HTTP 接点。
 * 准备只读完整发行字节；不加载包代码、构造 Client、观察数据库或授予业务权限。
 * 服务由宿主静态导入，在原 Rental 实例创建后绑定一次；首期不接容器或公共外键扩展。 */
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CoreDeploymentLockSchema, CoreHttpContributionSchema, CoreOpenApiContributionSchema,
  checkCoreCombination, checkPlatformDataCapabilities, coreDeploymentHostVersions,
  registerCoreHttpRoutes, registerCoreServers,
  type CoreDeploymentLock, type CoreHttpContribution, type CoreManifest,
  type CoreOpenApiContribution, type CoreServerContribution
} from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, createCoreArchive } from "@rental-os/core-contracts/archive";
import { corePrismaMigrationName } from "@rental-os/core-contracts/deployment";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { readCorePackageFiles } from "@rental-os/core-contracts/package";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import type { PlatformCoreApplicationInput, PlatformCoreBusinessAudit, PlatformCoreTermPolicy } from "@rental-os/platform-core-host";
import { mysqlMigrationStatements } from "@rental-os/platform-core-host/mysql-structure";
import type { RentalAuthenticationSource } from "@rental-os/rental-core/auth-source";
import type { RentalDatabaseClient, RentalDatabaseTransaction } from "./database";

export interface RentalHostCoreContext {
  readonly database: RentalDatabaseClient;
  readonly users: RentalAuthenticationSource;
  readonly audit: PlatformCoreBusinessAudit<RentalDatabaseTransaction>;
  readonly term: PlatformCoreTermPolicy<RentalDatabaseTransaction>;
  readonly deployment: CoreDeploymentAvailability;
  /** 复用当前业务事务观察部署，避免持锁后另取根连接等待同一锁。 */
  readonly deploymentForTransaction?: (transaction: RentalDatabaseTransaction) => CoreDeploymentAvailability;
}

export interface RentalHostCoreBinding<Binding = unknown> {
  readonly server: CoreServerContribution;
  readonly binding: Binding;
  /** 保留正式宿主合同的类型；本期租户级组合明确拒绝此接点。 */
  readonly authorizeContainer?: PlatformCoreApplicationInput<RentalDatabaseTransaction>["authorizeContainer"];
}

export interface RentalHostCoreSetup<Binding = unknown> {
  readonly coreId: string;
  /** 宿主静态 require.resolve 正式 server 出口所得的绝对实际路径，不从请求或清单加载代码。 */
  readonly entry: string;
  readonly dataPlan: CoreMysqlDataPlan;
  readonly http: CoreHttpContribution;
  bind(context: RentalHostCoreContext): RentalHostCoreBinding<Binding>;
}

export interface RentalAdditionalCoreDescription<Binding = unknown> {
  readonly coreId: string;
  readonly entry: string;
  readonly root: string;
  readonly manifest: CoreManifest;
  readonly sha256: string;
  readonly dataPlan: CoreMysqlDataPlan;
  readonly http: CoreHttpContribution;
  readonly openapi: CoreOpenApiContribution;
  bind(context: RentalHostCoreContext): RentalHostCoreBinding<Binding>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// 只接受本期静态 CJS 宿主可解析的精确出口；不把 types/import 或通配源码当实际 server。
function requireTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!object(value)) return;
  for (const [condition, target] of Object.entries(value)) {
    if (!["node", "require", "default", "node-addons"].includes(condition)) continue;
    const selected = requireTarget(target);
    if (selected !== undefined) return selected;
    if (target === null) return;
  }
}

function requireServerExport(files: ReadonlyMap<string, Uint8Array>, manifest: CoreManifest): void {
  const bytes = files.get("package.json");
  if (!bytes) throw new Error("额外 Core 须在固定包中声明正式 package.json 出口");
  const metadata: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!object(metadata) || typeof metadata.name !== "string" || !metadata.name
    || metadata.version !== manifest.version)
    throw new Error("额外 Core 的正式包名称或版本与清单不一致");
  const exports = metadata.exports;
  const entries = object(exports) && Object.keys(exports).some(key => key.startsWith("."))
    ? Object.entries(exports).filter(([key]) => key === "." || /^\.\/[a-zA-Z0-9_./-]+$/.test(key))
      .map(([, value]) => value) : [exports];
  if (!entries.some(value => requireTarget(value) === `./${manifest.entries.server}`))
    throw new Error("额外 Core 的实际 server 不是固定包声明的精确运行出口");
}

function requireTenantData(files: ReadonlyMap<string, Uint8Array>, manifest: CoreManifest, plan: CoreMysqlDataPlan): void {
  if (manifest.scope.kind !== "tenant") throw new Error("本 Rental 宿主只接受额外租户级 Core，容器 Core 尚未接入");
  if ("publicForeignKeys" in plan && (!Array.isArray(plan.publicForeignKeys) || plan.publicForeignKeys.length))
    throw new Error("额外 Core 本期不能扩展公共外键");
  const metadata: unknown = JSON.parse(Buffer.from(files.get("package.json")!).toString("utf8"));
  if ([...files.keys()].some(file => /\.prisma$|(?:^|\/)\.prisma\/|(?:^|\/)prisma\.config\.[cm]?[jt]s$|(?:^|\/)generated\/client\//iu.test(file))
    || object(metadata) && "prisma" in metadata)
    throw new Error("额外 Core 本期只支持原 raw SQL，未注册的 Prisma 贡献或 Client 不能静默省略");
  // 声明为空不能掩盖原 SQL 给公共表追加的关系。这里只检查归属，不执行或重写迁移。
  const statements = manifest.data.migrations.flatMap(migration =>
    mysqlMigrationStatements(Buffer.from(files.get(migration.file)!).toString("utf8")));
  const owned = new Set(statements.flatMap(statement => {
    const name = /^CREATE\s+TABLE\s+`([^`]+)`\s*\(/i.exec(statement)?.[1];
    return name ? [name] : [];
  }));
  for (const statement of statements) {
    if (!/^ALTER\s+TABLE\b/i.test(statement) || !/\bFOREIGN\s+KEY\b/i.test(statement)) continue;
    const name = /^ALTER\s+TABLE\s+`([^`]+)`\s+/i.exec(statement)?.[1];
    if (!name || !owned.has(name)) throw new Error("额外 Core 迁移含未接入的公共或外部表外键扩展");
  }
}

function requireHttp(manifest: CoreManifest, http: CoreHttpContribution, openapi: CoreOpenApiContribution): void {
  const registered = registerCoreHttpRoutes([{ manifest, contribution: http }]);
  if (!registered.ok) throw new Error(registered.issues.map(issue => `${issue.coreId}:${issue.field} ${issue.message}`).join("\n"));
  const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
  const documented = Object.values(openapi.paths).reduce((count, item) =>
    count + Object.keys(item).filter(method => methods.has(method)).length, 0);
  if (documented !== registered.registry.entries.length) throw new Error("额外 Core HTTP 与固定包 OpenAPI 操作集合不一致");
  for (const route of registered.registry.entries) {
    const path = `/api${route.fullPath.replace(/:([a-z][a-zA-Z0-9]*)/g, "{$1}")}`;
    const operation = openapi.paths[path]?.[route.method.toLowerCase()];
    if (!object(operation) || operation.operationId !== `${manifest.id}.${route.id}`
      || !isDeepStrictEqual(operation["x-core-permissions"], route.permissionCodes)
      || !isDeepStrictEqual(operation["x-core-audiences"], route.audiences)
      || operation["x-core-purpose"] !== route.purpose
      || operation["x-core-starts-new-business"] !== route.startsNewBusiness)
      throw new Error(`额外 Core HTTP 政策与固定包原合同不一致：${route.method} ${path}`);
  }
}

/** 返回不可变的完整候选描述；任何缺项拒绝整组，不返回部分注册或假部署就绪。 */
export function prepareRentalAdditionalCores<Binding = unknown>(
  input: CoreDeploymentLock, setups: readonly RentalHostCoreSetup<Binding>[]
): readonly RentalAdditionalCoreDescription<Binding>[] {
  const lock = CoreDeploymentLockSchema.parse(input), host = coreDeploymentHostVersions(lock);
  if (lock.cores.filter(pin => pin.manifest.id === "rental").length !== 1)
    throw new Error("本 Rental 宿主部署锁须且仅须包含一个 Rental Core");
  const issues = [...checkCoreCombination(lock.cores.map(pin => pin.manifest), host).issues,
    ...checkPlatformDataCapabilities(lock)];
  if (issues.length) throw new Error(issues.map(issue => `${issue.field} ${issue.message}`).join("\n"));
  const pins = lock.cores.filter(pin => pin.manifest.id !== "rental");
  if (!Array.isArray(setups) || setups.length !== pins.length
    || new Set(setups.map(setup => setup?.coreId)).size !== setups.length
    || setups.some(setup => !setup || !pins.some(pin => pin.manifest.id === setup.coreId) || typeof setup.bind !== "function"))
    throw new Error("额外 Core setup 集合须逐项等于部署锁中的非 Rental 固定包，不能缺失、重复或替代 Rental");

  const descriptions = pins.map(pin => {
    const setup = setups.find(candidate => candidate.coreId === pin.manifest.id)!;
    if (typeof setup.entry !== "string" || !isAbsolute(setup.entry)
      || resolve(setup.entry).split(/[\\/]/).join("/") !== setup.entry.split(/[\\/]/).join("/")
      || !/\.(?:c?js|mjs)$/.test(pin.manifest.entries.server)
      || pin.manifest.entries.server.split("/").some(part => part.toLowerCase() === "src"))
      throw new Error("额外 Core entry 须为正式已构建 server 的绝对实际路径，不能使用源码或推测 dist");
    const entry = resolve(setup.entry), entryInfo = lstatSync(entry);
    if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) throw new Error("额外 Core server 须为无链接的普通文件");
    let directory = entry;
    for (const _part of pin.manifest.entries.server.split("/")) directory = dirname(directory);
    const actual = requireCorePackagePin(directory, pin, host);
    if (resolve(actual.root, pin.manifest.entries.server) !== entry || !isDeepStrictEqual(actual.manifest, pin.manifest))
      throw new Error("额外 Core entry 或完整清单与固定发行不一致");
    // 第二次读取所消费的 JSON/迁移时仍核整包摘要，避免首查后换字节混用两份发行。
    const files = readCorePackageFiles(actual.root, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
    if (createCoreArchive(files).sha256 !== pin.sha256) throw new Error("额外 Core 固定包在准备期间发生变化");
    const manifest = freeze(actual.manifest);
    requireServerExport(files, manifest);
    if (!setup.dataPlan || !isDeepStrictEqual(setup.dataPlan.data, manifest.data)
      || !isDeepStrictEqual(setup.dataPlan.migrationNames, manifest.data.migrations.map(migration => corePrismaMigrationName(manifest.id, migration.id)))
      || typeof setup.dataPlan.readPhysical !== "function")
      throw new Error("额外 Core 数据计划须与固定清单、原迁移名称及实际物理观察逐项对应");
    requireTenantData(files, manifest, setup.dataPlan);
    if (!manifest.entries.openapi) throw new Error("额外 Core HTTP 缺少固定包 OpenAPI 原合同");
    const openapi = freeze(CoreOpenApiContributionSchema.parse(JSON.parse(Buffer.from(files.get(manifest.entries.openapi)!).toString("utf8"))));
    const http = freeze(CoreHttpContributionSchema.parse(setup.http));
    requireHttp(manifest, http, openapi);
    const dataPlan: CoreMysqlDataPlan = Object.freeze({ data: manifest.data,
      migrationNames: Object.freeze([...setup.dataPlan.migrationNames]), readPhysical: setup.dataPlan.readPhysical.bind(setup.dataPlan) });
    const bind = setup.bind.bind(setup);
    let bound = false;
    return Object.freeze({ coreId: manifest.id, entry, root: actual.root, manifest, sha256: pin.sha256, dataPlan, http, openapi,
      bind(context: RentalHostCoreContext): RentalHostCoreBinding<Binding> {
        if (bound) throw new Error("同一额外 Core 候选只能绑定一次，失败不能重建另一服务图");
        bound = true;
        const result = bind(Object.freeze({ database: context.database, users: context.users, audit: context.audit,
          term: context.term, deployment: context.deployment,
          deploymentForTransaction: context.deploymentForTransaction }));
        if (!result || !Object.hasOwn(result, "binding") || result.binding == null || result.authorizeContainer !== undefined)
          throw new Error("额外租户 Core 须返回实际 binding，不能提供容器授权或替代 Rental 图");
        const registered = registerCoreServers([{ manifest, server: result.server }], host);
        if (!registered.ok) throw new Error(registered.issues.map(issue => `${issue.coreId}:${issue.field} ${issue.message}`).join("\n"));
        return Object.freeze({ server: result.server, binding: result.binding });
      }
    });
  });
  return Object.freeze(descriptions);
}
