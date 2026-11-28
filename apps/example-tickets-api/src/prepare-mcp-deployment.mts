/** 显式组合完整MCP数据包与工单MCP标准包，只写新的候选迁移目录。
 * 复用正式包摘要、兼容及迁移顺序检查；不安装、连库、执行DDL或授予任何业务权限。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CorePlatformReleaseSchema, CoreSourceSchema, CoreDeploymentLockSchema, coreDeploymentHostVersions } from "@rental-os/core-contracts";
import { createCoreMigrationDeployment, writeCoreMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { readCorePackageFiles } from "@rental-os/core-contracts/package";
import { packCoreDirectory } from "@rental-os/core-contracts/install";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { createMcpDataRelease, readMcpDataPackage } from "@rental-os/mcp-server/data-capability";
import { createTicketsMcpDataPlan } from "@rental-os/example-tickets-core/mcp";
import { TICKETS_MCP_MIGRATION } from "@rental-os/example-tickets-core";

const require = createRequire(import.meta.url);
export function prepareTicketsMcpDeployment(args: readonly string[]) {
  if (args.length !== 5 || args.some(arg => !isAbsolute(arg)))
    throw new Error("用法：prepare-mcp-deployment.mjs <底座发行JSON> <MCP固定来源JSON> <完整MCP包目录> <完整工单MCP包目录> <新部署目录>；均须绝对路径");
  const platform = CorePlatformReleaseSchema.parse(JSON.parse(readFileSync(args[0], "utf8")));
  const source = CoreSourceSchema.parse(JSON.parse(readFileSync(args[1], "utf8")));
  const readFiles = (directory: string) => readCorePackageFiles(directory, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const mcpFiles = readFiles(args[2]), mcp = createMcpDataRelease({ source, files: mcpFiles });
  // 当前组合只有原公共Client，MCP持久端口使用原SQL；未来有模型的包须显式升级宿主。
  const contribution = readMcpDataPackage(mcpFiles, mcp);
  if (contribution.schema.replace(/^\s*\/\/.*$/gm, "").trim()) throw new Error("本工单MCP宿主只接受无新增Prisma模型的正式MCP材料");
  const publicPlan = createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(platform.data, publicPlan.data)) throw new Error("底座发行与当前公共数据基线不同");
  const base = CoreDeploymentLockSchema.parse({ lockVersion: 1, platform, cores: [], dataCapabilities: [mcp] });
  const host = coreDeploymentHostVersions(base), core = packCoreDirectory(args[3], host), coreFiles = readFiles(args[3]);
  if (core.manifest.id !== "example-tickets" || core.manifest.entries.ai !== "dist-mcp/index-mcp.mjs")
    throw new Error("必须提供完整工单MCP选装包");
  createTicketsMcpDataPlan({ manifest: core.manifest, sql: coreFiles.get(TICKETS_MCP_MIGRATION.file)! });
  const lock = CoreDeploymentLockSchema.parse({ ...base, cores: [{ manifest: core.manifest, sha256: core.sha256 }] });
  const platformRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), ".."), target = resolve(args[4]);
  if (dirname(target) !== platformRoot) throw new Error("部署新目录须位于当前apps/platform-api下，与唯一公共Client同属一个宿主");
  const files = new Map(createCoreMigrationDeployment({ lock, cores: new Map([[core.manifest.id, coreFiles]]),
    dataCapabilities: new Map([[mcp.id, mcpFiles]]), platform: publicPlan.migrationNames.map((name, index) => ({ name,
      sql: readFileSync(resolve(platformRoot, publicPlan.data.migrations[index].file)) })) }));
  files.set("schema.prisma", readFileSync(resolve(platformRoot, "prisma/schema.prisma")));
  files.set("mcp.release.json", Buffer.from(JSON.stringify(mcp, null, 2) + "\n"));
  writeCoreMigrationDeployment(target, files);
  return { status: "prepared" as const, deployment: "pending" as const, directory: target,
    lock: resolve(target, "core.deployment.lock.json"), coreSha256: core.sha256, mcpSha256: mcp.sha256, coreDataVersion: core.manifest.data.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(prepareTicketsMcpDeployment(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : "工单MCP部署准备失败") + "\n"); process.exitCode = 1; }
}
