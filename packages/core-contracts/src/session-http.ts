/** 当前登录成员的Core使用目录与租户管理候选；仅投影授权事实，不代替业务范围/就绪核验。 */
import { z } from "zod";
import { CoreRegisteredSummarySchema } from "./management-http";
import { MemberCoreAssignmentSchema, TenantCoreGrantSchema } from "./lifecycle";
import { coreOpenApiSchema } from "./schema";
import type { CoreOpenApiContribution } from "./openapi";

export const CoreSessionSummarySchema = CoreRegisteredSummarySchema.pick({ id: true, name: true, description: true, version: true, scope: true });
export const CoreSessionEntrySchema = z.object({
  core: CoreSessionSummarySchema,
  grant: TenantCoreGrantSchema,
  assignment: MemberCoreAssignmentSchema,
  /** 当前角色持有的本Core精确权限码，不返回平台通配符或其他Core权限。 */
  permissions: z.array(z.string().min(1))
}).strict();
export const CoreSessionContextSchema = z.object({
  tenantId: TenantCoreGrantSchema.shape.tenantId,
  subjectId: MemberCoreAssignmentSchema.shape.userId,
  tenantHasRegisteredGrant: z.boolean(),
  canManageMembers: z.boolean(),
  cores: z.array(CoreSessionEntrySchema),
  /** 只有当前租户管理者读取获开通且已登记的Core候选，候选不授予本人业务使用权。 */
  assignable: z.array(CoreSessionSummarySchema)
}).strict().superRefine((context, issues) => {
  const ids = new Set<string>();
  context.cores.forEach((entry, index) => {
    if (ids.has(entry.core.id) || entry.grant.coreId !== entry.core.id || entry.assignment.coreId !== entry.core.id
      || entry.grant.tenantId !== context.tenantId || entry.assignment.tenantId !== context.tenantId
      || entry.assignment.userId !== context.subjectId || entry.grant.state !== "enabled" || entry.assignment.state !== "assigned"
      || entry.permissions.some(code => !code.startsWith(`${entry.core.id}:`)))
      issues.addIssue({ code: "custom", path: ["cores", index], message: "Core目录与当前租户、成员及授权不一致" });
    ids.add(entry.core.id);
  });
  if (!context.canManageMembers && context.assignable.length)
    issues.addIssue({ code: "custom", path: ["assignable"], message: "非租户管理者不能读取成员分配候选" });
  if (!context.tenantHasRegisteredGrant && (context.cores.length || context.assignable.length))
    issues.addIssue({ code: "custom", path: ["tenantHasRegisteredGrant"], message: "没有已登记Core的租户授权时不能提供使用或分配候选" });
  if (new Set(context.assignable.map(core => core.id)).size !== context.assignable.length)
    issues.addIssue({ code: "custom", path: ["assignable"], message: "Core分配候选不能重复" });
});
export type CoreSessionContext = z.infer<typeof CoreSessionContextSchema>;
export const CORE_SESSION_HTTP = { method: "GET", path: "platform/core-host/session-context",
  summary: "读取当前登录成员的Core使用目录", response: CoreSessionContextSchema } as const;

/** 页面只按当前目录过滤已登记的操作，最终授权与对象范围仍由原服务端执行。 */
export function canUseCorePage(context: CoreSessionContext, coreId: string, permissions: readonly { resource: string; action: string }[]): boolean {
  const entry = context.cores.find(item => item.core.id === coreId);
  return Boolean(entry && permissions.every(permission => entry.permissions.includes(`${coreId}:${permission.resource}:${permission.action}`)));
}

export function createCoreSessionOpenApi(): CoreOpenApiContribution {
  return { paths: { [`/api/${CORE_SESSION_HTTP.path}`]: { get: {
    operationId: "platformCore_sessionContext", summary: CORE_SESSION_HTTP.summary, tags: ["Platform Core"], security: [{ bearerAuth: [] }],
    description: "需要当前operator签名会话。仅返回本人获分配且租户已开通的Core；本租户管理者另读可分配候选。注册、分配、业务角色、数据范围及就绪各自核验。",
    responses: { 200: { description: "当前主体的授权目录，空集合是合法结果", content: { "application/json": {
      schema: { $ref: "#/components/schemas/PlatformCore.Session.Response" } } } },
      401: { description: "原会话不存在、撤销、切换或到期" }, 403: { description: "当前主体不可用" },
      500: { description: "实际存储读取失败，不能当作空目录" } }
  } } }, schemas: { "PlatformCore.Session.Response": { type: "object", required: ["data", "requestId"], properties: {
    data: coreOpenApiSchema(CoreSessionContextSchema.innerType()), requestId: { type: "string" }
  } } } };
}
