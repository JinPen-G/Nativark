/** Explicit deployment grant for the opted-in SaaS AI settings. No startup or default role changes. */
import { PLATFORM_AI_MODEL_SETTINGS_PERMISSIONS } from "@rental-os/ai-native-server/public-platform-model-settings";
import type { Prisma } from "../generated/client";
import { PlatformDatabaseClient } from "./database";
import { selectPublicAiData } from "./ai-data";

type Access = "view" | "manage";
type ObserveData = (tx: Pick<Prisma.TransactionClient, "$queryRaw">) => Promise<void>;

class PublicAiGrantError extends Error {}

export async function grantPublicAiRole(database: Pick<PlatformDatabaseClient, "$transaction">,
  input: { roleId: string; access: Access }, observeData: ObserveData) {
  const { roleId, access } = input;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(roleId) || (access !== "view" && access !== "manage"))
    throw new PublicAiGrantError("用法：grant:ai -- --role <SaaS角色ID> --access view|manage");

  return database.$transaction(async tx => {
    await observeData(tx);
    // Match the original authority's tenant-before-role lock order.
    const [tenant] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE code = ${"platform"} AND status = ${"active"} FOR UPDATE`;
    if (!tenant) throw new PublicAiGrantError("须先完成公共 SaaS 初始化，且平台主体处于启用状态");
    const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`Role\` WHERE id = ${roleId} AND tenantId = ${tenant.id} FOR UPDATE`;
    if (row?.id !== roleId) throw new PublicAiGrantError("目标不是当前 SaaS 平台的角色");
    const role = await tx.role.findUnique({ where: { id: roleId }, select: { isActive: true, fixedAllPermissions: true,
      scope: true, permissions: { select: { permissionId: true } } } });
    if (!role?.isActive || role.fixedAllPermissions || role.scope !== "OPERATOR")
      throw new PublicAiGrantError("目标必须是启用的 SaaS 操作角色，且不能是固定全权角色");

    const existing = new Set(role.permissions.map(item => item.permissionId));
    const changes: { id: string; code: string }[] = [];
    const allowed = PLATFORM_AI_MODEL_SETTINGS_PERMISSIONS.filter(({ code }) => code === "system:ai-provider:view"
      || access === "manage" && code === "system:ai-provider:manage");
    for (const permission of allowed) {
      const registered = await tx.permission.upsert({ where: { code: permission.code },
        create: { ...permission, kind: "ACTION" }, update: {}, select: { id: true, code: true, kind: true } });
      if (registered.code !== permission.code || registered.kind !== "ACTION") throw new PublicAiGrantError("平台 AI 权限目录已有冲突记录");
      if (!existing.has(registered.id)) changes.push(registered);
    }
    const granted = changes.map(item => item.code);
    if (changes.length) {
      await tx.rolePermission.createMany({ data: changes.map(item => ({ roleId, permissionId: item.id })) });
      await tx.operationLog.create({ data: { tenantId: tenant.id, action: "platform.ai-role.granted",
        detail: { operator: "deployment", targetType: "role", targetId: roleId, permissions: granted } } });
    }
    return { roleId, access, granted };
  }, { isolationLevel: "Serializable" });
}

async function main(args: string[]) {
  const [roleFlag, roleId, accessFlag, access] = args;
  if (args.length !== 4 || roleFlag !== "--role" || accessFlag !== "--access" || (access !== "view" && access !== "manage"))
    throw new PublicAiGrantError("用法：grant:ai -- --role <SaaS角色ID> --access view|manage");
  if (!process.env.DATABASE_URL?.trim()) throw new PublicAiGrantError("须配置独立 DATABASE_URL");
  const observeData = await selectPublicAiData(process.env.CORE_DEPLOYMENT_LOCK_FILE ?? "", process.env.PLATFORM_AI_DATA_PACKAGE_DIR ?? "");
  const database = new PlatformDatabaseClient();
  try { console.log(JSON.stringify(await grantPublicAiRole(database, { roleId, access }, observeData))); }
  finally { await database.$disconnect(); }
}

if (require.main === module) void main(process.argv.slice(2)).catch(error => {
  // Driver errors can include connection material; only print our fixed validation messages.
  console.error(error instanceof PublicAiGrantError ? error.message : "公共 AI 角色授权未确认；请核对固定数据包、部署锁、原账和数据库配置。");
  process.exitCode = 1;
});
