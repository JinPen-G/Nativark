/**
 * 平台Core管理HTTP的单源路径与输入输出，Controller和接口资料消费同一声明。
 * 本合同描述平台/租户管理权限，业务范围与当前授权仍由原服务端核验。
 */
import { z } from "zod";
import { CoreManifestSchema } from "./manifest";
import {
  BindCoreScopeSchema, ChangeMemberCoreAssignmentSchema, ChangeTenantCoreGrantSchema,
  CoreBindingOperationQuerySchema, CoreBindingSchema, CoreOperationReferenceSchema,
  MemberCoreAssignmentSchema, TenantCoreGrantSchema, CoreRemovalQuerySchema, CoreRemovalObservationSchema
} from "./lifecycle";

export const CORE_MANAGEMENT_HTTP_BASE = "platform/core-host";
export const CoreRegisteredSummarySchema = CoreManifestSchema.innerType().pick({
  id: true, name: true, description: true, version: true, source: true, license: true, compatibility: true, scope: true
});
export type CoreRegisteredSummary = z.infer<typeof CoreRegisteredSummarySchema>;

/** 从已登记清单投影公共显示字段，完整发布清单继续由原注册维护。 */
export function coreRegisteredSummary(manifest: z.infer<typeof CoreManifestSchema>): CoreRegisteredSummary {
  const { id, name, description, version, source, license, compatibility, scope } = manifest;
  return CoreRegisteredSummarySchema.parse({ id, name, description, version, source, license, compatibility, scope });
}
export const CoreBindingObservationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), operation: CoreOperationReferenceSchema, binding: CoreBindingSchema }).strict(),
  z.object({ status: z.literal("unavailable") }).strict()
]);
export const CoreTenantAccessQuerySchema = ChangeTenantCoreGrantSchema.pick({ tenantId: true, coreId: true });
export const CoreMemberAccessQuerySchema = ChangeMemberCoreAssignmentSchema.pick({ coreId: true, userId: true });
export const CoreTenantGrantOperationQuerySchema = ChangeTenantCoreGrantSchema.pick({ tenantId: true, coreId: true, operationId: true });
export const CoreMemberAssignmentOperationQuerySchema = ChangeMemberCoreAssignmentSchema.pick({ coreId: true, userId: true, operationId: true });
export const CoreScopeBindingQuerySchema = BindCoreScopeSchema.pick({ coreId: true, container: true });
export const CoreTenantGrantObservationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), grant: TenantCoreGrantSchema }).strict(),
  z.object({ status: z.literal("unavailable") }).strict()
]);
export const CoreMemberAssignmentObservationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), assignment: MemberCoreAssignmentSchema }).strict(),
  z.object({ status: z.literal("unavailable") }).strict()
]);
export const CoreScopeBindingObservationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("recorded"), binding: CoreBindingSchema }).strict(),
  z.object({ status: z.literal("unavailable") }).strict()
]);

export const CORE_MANAGEMENT_HTTP = {
  registered: { method: "GET", path: "registered", summary: "读取当前受控部署登记的Core", permission: "system:tenant:manage",
    audience: "saas", response: z.array(CoreRegisteredSummarySchema) },
  tenantGrant: { method: "POST", path: "tenant-grants", summary: "开通或停用指定租户的Core", permission: "system:tenant:manage",
    audience: "saas", request: ChangeTenantCoreGrantSchema, response: TenantCoreGrantSchema },
  memberAssignment: { method: "POST", path: "member-assignments", summary: "分配或撤回本租户成员的Core", permission: "system:user:manage",
    audience: "tenant", request: ChangeMemberCoreAssignmentSchema, response: MemberCoreAssignmentSchema },
  bind: { method: "POST", path: "bindings", summary: "首次绑定Core或复用已有绑定", permission: "system:user:manage",
    audience: "tenant", request: BindCoreScopeSchema, response: CoreBindingSchema },
  bindingOperation: { method: "POST", path: "binding-operations/read", summary: "只读核对本人的原Core初始化操作", permission: "system:user:manage",
    audience: "tenant", request: CoreBindingOperationQuerySchema, response: CoreBindingObservationSchema },
  readTenantGrant: { method: "POST", path: "tenant-grants/read", summary: "读取指定租户的当前Core授权及修订", permission: "system:tenant:manage",
    audience: "saas", request: CoreTenantAccessQuerySchema, response: CoreTenantGrantObservationSchema },
  readMemberAssignment: { method: "POST", path: "member-assignments/read", summary: "读取本租户成员的当前Core分配及修订", permission: "system:user:manage",
    audience: "tenant", request: CoreMemberAccessQuerySchema, response: CoreMemberAssignmentObservationSchema },
  readBinding: { method: "POST", path: "bindings/read", summary: "读取本租户Core范围的当前绑定及修订", permission: "system:user:manage",
    audience: "tenant", request: CoreScopeBindingQuerySchema, response: CoreScopeBindingObservationSchema },
  readTenantGrantOperation: { method: "POST", path: "tenant-grant-operations/read", summary: "只读核对本人的原租户Core授权操作", permission: "system:tenant:manage",
    audience: "saas", request: CoreTenantGrantOperationQuerySchema, response: CoreTenantGrantObservationSchema },
  readMemberAssignmentOperation: { method: "POST", path: "member-assignment-operations/read", summary: "只读核对本人的原成员Core分配操作", permission: "system:user:manage",
    audience: "tenant", request: CoreMemberAssignmentOperationQuerySchema, response: CoreMemberAssignmentObservationSchema },
  assessRemoval: { method: "POST", path: "removal/read", summary: "只读核对当前Core移除阻碍", permission: "system:tenant:manage",
    audience: "saas", request: CoreRemovalQuerySchema, response: CoreRemovalObservationSchema }
} as const;

export type CoreManagementHttpOperation = keyof typeof CORE_MANAGEMENT_HTTP;

/** 原Guard的租户公共策略可消费该映射，未知方法/路径继续由其原未映射规则处理。 */
export function coreManagementHttpPolicy(method: string, path: string): {
  audience: "saas" | "tenant";
  permission: "system:tenant:manage" | "system:user:manage";
} | undefined {
  const operation = Object.values(CORE_MANAGEMENT_HTTP).find(item => item.method === method.toUpperCase()
    && path === `/${CORE_MANAGEMENT_HTTP_BASE}/${item.path}`);
  return operation && { audience: operation.audience, permission: operation.permission };
}
