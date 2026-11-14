/**
 * 平台持有的授权/绑定事实与 Core 生命周期的公共投影。
 * 解析这些对象不授予权限；写入者须复用原身份、当前授权与同事务审计。
 */
import { z } from "zod";
import { CoreIdSchema } from "./manifest";
import { CoreObjectReferenceSchema } from "./reference";
import { CoreReleaseVersionSchema } from "./version";

const id = z.string().min(1).max(200);
const revision = z.number().int().safe().positive();
const expectedRevision = z.number().int().safe().nonnegative();

export const CoreScopeReferenceSchema = CoreObjectReferenceSchema.pick({
  coreId: true, tenantId: true, container: true
});
export type CoreScopeReference = z.infer<typeof CoreScopeReferenceSchema>;

export const TenantCoreGrantSchema = z.object({
  tenantId: id,
  coreId: CoreIdSchema,
  state: z.enum(["enabled", "disabled"]),
  revision,
  operationId: id
}).strict();
export type TenantCoreGrant = z.infer<typeof TenantCoreGrantSchema>;

export const MemberCoreAssignmentSchema = z.object({
  tenantId: id,
  coreId: CoreIdSchema,
  userId: id,
  state: z.enum(["assigned", "revoked"]),
  revision,
  operationId: id
}).strict();
export type MemberCoreAssignment = z.infer<typeof MemberCoreAssignmentSchema>;

/** 首次初始化提交后才存在绑定；业务就绪另由 Core 读取当前事实判断。 */
export const CoreBindingSchema = CoreScopeReferenceSchema.extend({
  bindingId: id,
  revision,
  dataVersion: CoreReleaseVersionSchema
}).strict();
export type CoreBinding = z.infer<typeof CoreBindingSchema>;

export const CoreReadinessSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready") }).strict(),
  z.object({
    status: z.literal("configuration_required"),
    missing: z.array(z.object({
      code: id,
      message: z.string().min(1).max(500)
    }).strict()).min(1)
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    code: id,
    message: z.string().min(1).max(500)
  }).strict()
]);
export type CoreReadiness = z.infer<typeof CoreReadinessSchema>;

/** 只定位原操作；不表达未提交或可重做，unknown 仍须原执行者核对。 */
export const CoreOperationReferenceSchema = CoreScopeReferenceSchema.extend({
  operationId: id,
  action: id,
  implementationVersion: CoreReleaseVersionSchema
}).strict();
export type CoreOperationReference = z.infer<typeof CoreOperationReferenceSchema>;

export const CoreRemovalBlockerSchema = z.object({
  kind: z.enum(["in_flight", "unknown", "callback", "job", "history"]),
  code: id,
  message: z.string().min(1).max(500),
  operation: CoreOperationReferenceSchema.optional()
}).strict();
export const CoreRemovalAssessmentSchema = z.object({
  blockers: z.array(CoreRemovalBlockerSchema)
}).strict();
export type CoreRemovalAssessment = z.infer<typeof CoreRemovalAssessmentSchema>;

/** 完整平台依赖读取由原任务/回调/历史所有者供给；缺证据不能视为排空完成。 */
export const CorePlatformRemovalObservationSchema = z.object({
  admission: z.enum(["stopped", "accepting", "unknown"]),
  complete: z.boolean(),
  blockers: z.array(CoreRemovalBlockerSchema)
}).strict();
export type CorePlatformRemovalObservation = z.infer<typeof CorePlatformRemovalObservationSchema>;
export const CoreRemovalQuerySchema = z.object({ coreId: CoreIdSchema }).strict();
export const CoreRemovalObservationSchema = z.object({
  scope: z.literal("removal-preflight"),
  coreId: CoreIdSchema,
  implementationVersion: CoreReleaseVersionSchema,
  checkedAt: z.string().datetime(),
  status: z.enum(["blocked", "clear"]),
  blockers: z.array(CoreRemovalBlockerSchema)
}).strict().superRefine((result, context) => {
  if ((result.status === "clear") !== (result.blockers.length === 0))
    context.addIssue({ code: "custom", path: ["status"], message: "移除预检状态须与依赖阻碍一致" });
  if (result.blockers.some(blocker => blocker.operation && blocker.operation.coreId !== result.coreId))
    context.addIssue({ code: "custom", path: ["blockers"], message: "移除阻碍的原操作须属于当前Core" });
});
export type CoreRemovalObservation = z.infer<typeof CoreRemovalObservationSchema>;

/** 授权入口使用原操作键和当前修订；0 仅表示当前记录尚不存在。 */
export const ChangeTenantCoreGrantSchema = z.object({
  tenantId: id,
  coreId: CoreIdSchema,
  state: TenantCoreGrantSchema.shape.state,
  expectedRevision,
  operationId: id
}).strict();
export type ChangeTenantCoreGrant = z.infer<typeof ChangeTenantCoreGrantSchema>;

export const ChangeMemberCoreAssignmentSchema = z.object({
  coreId: CoreIdSchema,
  userId: id,
  state: MemberCoreAssignmentSchema.shape.state,
  expectedRevision,
  operationId: id
}).strict();
export type ChangeMemberCoreAssignment = z.infer<typeof ChangeMemberCoreAssignmentSchema>;

/** 初始化目标租户由原主体确定，配置交所属Core的唯一schema解析。 */
export const BindCoreScopeSchema = CoreScopeReferenceSchema.omit({ tenantId: true }).extend({
  operationId: id,
  expectedRevision,
  configuration: z.unknown().optional()
}).strict();
export type BindCoreScope = z.infer<typeof BindCoreScopeSchema>;

export const CoreBindingOperationQuerySchema = BindCoreScopeSchema.pick({ coreId: true, container: true, operationId: true });
export type CoreBindingOperationQuery = z.infer<typeof CoreBindingOperationQuerySchema>;
