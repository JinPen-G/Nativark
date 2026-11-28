/** 分阶段安装的只读 HTTP 封套，供宿主与诊断工具共用。
 * 复用原锁、迁移与物理观察；不计算业务状态、不执行初始化，也不扩展 v1 升级权限。
 * 生产者须在原 SaaS 身份/权限复核边界读取真实材料，缺依据返回 null/not_checked。
 */
import { z } from "zod";
import { CoreArtifactHashSchema, CoreIdSchema, CoreMigrationSchema } from "./manifest";
import { CorePhasedMigrationLockSchema } from "./deployment";
import { CoreRegisteredSummarySchema } from "./management-http";
import { CorePlatformDataCapabilityReleaseSchema } from "./data-capability";
import {
  CoreDataObservationSchema, CoreMigrationExecutionSchema, CorePackagePinSchema,
  CorePhysicalDataObservationSchema, CorePlatformReleaseSchema
} from "./update";

/** path 相对宿主的 /api 前缀；无查询/动作参数，沿 operator/SaaS/system:tenant:manage 只读。 */
export const PHASED_INSTALLATION_HTTP = Object.freeze({
  method: "GET", path: "platform/core-installation/status", format: "zelo-phased-installation-observation-1"
} as const);

export const CORE_PHASED_INSTALLATION_ISSUE_CODES = [
  "materials_unavailable", "runtime_identity_unverified", "deployment_changed",
  "ledger_unavailable", "ledger_incomplete", "ledger_mismatch", "physical_unavailable", "physical_mismatch",
  "initialization_unchecked", "initialization_required", "initialization_conflict", "observation_unavailable"
] as const;

export const CoreInstallationInitializationSchema = z.object({
  state: z.enum(["not_checked", "uninitialized", "initialized", "conflict"]),
  receipt: z.enum(["not_checked", "not_found", "recorded"]),
  mustChangePassword: z.boolean().optional()
}).strict();
export type CoreInstallationInitialization = z.infer<typeof CoreInstallationInitializationSchema>;

const issue = z.object({
  scope: z.enum(["materials", "database", "initialization"]),
  // 新原因可保持不可用；消费者只显示自身认识的代码，不显示异常原文或凭据。
  code: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/u)
}).strict();
const header = {
  format: z.literal(PHASED_INSTALLATION_HTTP.format),
  observedAt: CorePhysicalDataObservationSchema.shape.observedAt
};
const postCapability = z.object({
  coreId: CoreIdSchema,
  migrationId: CoreMigrationSchema.shape.id,
  appliedMigration: CoreMigrationSchema.pick({ id: true, sha256: true }).nullable(),
  execution: CoreMigrationExecutionSchema.nullable(),
  physical: CorePhysicalDataObservationSchema.nullable()
}).strict();

/** installed/registered/Client 须来自实际运行包核验；database 须来自同次原账和物理读取。 */
export const CorePhasedInstallationObservationSchema = z.discriminatedUnion("status", [
  z.object({ ...header, status: z.literal("unavailable"), issues: issue.array().min(1).max(100) }).strict(),
  z.object({
    ...header, status: z.literal("observed"), lock: CorePhasedMigrationLockSchema,
    preparation: z.object({ status: z.literal("prepared"), deployment: z.literal("pending") }).strict().nullable(),
    installed: z.object({
      platform: CorePlatformReleaseSchema.nullable(), cores: CorePackagePinSchema.array().max(100),
      dataCapabilities: CorePlatformDataCapabilityReleaseSchema.array().max(100),
      postCapability: CorePhasedMigrationLockSchema.shape.postCapability.element.array().max(100)
    }).strict().nullable(),
    registered: CoreRegisteredSummarySchema.array().max(100),
    runtimeClient: z.object({ schemaSha256: CoreArtifactHashSchema }).strict().nullable(),
    database: z.object({ base: CoreDataObservationSchema.nullable(), postCapability: postCapability.array().max(100) }).strict(),
    initialization: z.object({ platform: CoreInstallationInitializationSchema,
      cores: CoreInstallationInitializationSchema.extend({ coreId: CoreIdSchema }).array().max(100) }).strict(),
    issues: issue.array().max(100)
  }).strict()
]);
export type CorePhasedInstallationObservation = z.infer<typeof CorePhasedInstallationObservationSchema>;
