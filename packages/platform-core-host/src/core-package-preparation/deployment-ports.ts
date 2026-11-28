/** 可信宿主静态注入的有界部署接点。候选文件与一次派发意图由原存储保留，
 * 执行、许可批准、实际运行观察及恢复由目标宿主负责，不接受路径或终端命令。 */
import { z } from "zod";
import { CoreArtifactHashSchema, CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import type { PlatformCoreTransaction } from "../ports";
import type { CorePackagePreparationRecord, CorePackagePreparationUnavailable } from "./ports";

const reference = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$(?![\s\S])/);
export const CorePackageDeploymentRequestSchema = z.object({
  sha256: CoreArtifactHashSchema, dispatchId: z.string().length(36).uuid(), approvalReference: reference
}).strict();
export const CorePackageDeploymentQuerySchema = CorePackageDeploymentRequestSchema.pick({ sha256: true, dispatchId: true });
export const CorePackageDeploymentOperationSchema = CorePackageDeploymentRequestSchema.extend({
  format: z.literal("core-deployment-dispatch-1"), executorId: reference,
  actor: z.object({ tenantId: reference, userId: reference }).strict(), requestedAt: z.string().datetime()
}).strict();
export type CorePackageDeploymentRequest = z.infer<typeof CorePackageDeploymentRequestSchema>;
export type CorePackageDeploymentOperation = z.infer<typeof CorePackageDeploymentOperationSchema>;

export const CorePackageDeploymentObservationSchema = z.discriminatedUnion("status", [
  CorePackageDeploymentQuerySchema.extend({ status: z.literal("pending") }).strict(),
  CorePackageDeploymentQuerySchema.extend({ status: z.literal("unknown") }).strict(),
  CorePackageDeploymentQuerySchema.extend({ status: z.literal("succeeded"), receipt: reference, current: CoreDeploymentLockSchema }).strict(),
  CorePackageDeploymentQuerySchema.extend({ status: z.literal("failed"), receipt: reference, current: CoreDeploymentLockSchema }).strict()
]);
export type CorePackageDeploymentObservation = z.infer<typeof CorePackageDeploymentObservationSchema>;
export type CorePackageDeploymentResult = CorePackagePreparationUnavailable | CorePackageDeploymentObservation;

export interface CorePackageDeploymentExecutor {
  /** 稳定目标标识，变更执行器后不能将旧意图转给新目标。 */
  readonly id: string;
  /** 必须核实际目标的当前部署权和许可/维护批准；持有原身份/来源事务时调用。 */
  authorize(transaction: PlatformCoreTransaction, operation: CorePackageDeploymentOperation,
    record: CorePackagePreparationRecord): Promise<void>;
  /** 仅提交真实有界动作。此方法不会自动重试；长任务及失败恢复沿宿主原执行生命周期。 */
  submit(operation: CorePackageDeploymentOperation, record: CorePackagePreparationRecord): Promise<void>;
  /** 沿同一派发 ID 只读原执行结果及真实锁。来源失权不阻止恢复原结果。 */
  observe(operation: CorePackageDeploymentOperation): Promise<CorePackageDeploymentObservation>;
}
export interface CorePackageDeploymentOperationStore {
  /** 原候选摘要与派发 ID 双向唯一绑定；崩溃后不能换 ID 或候选再次执行。 */
  claimDeployment(operation: CorePackageDeploymentOperation): { claimed: boolean; operation: CorePackageDeploymentOperation };
  readDeployment(sha256: string): CorePackageDeploymentOperation | undefined;
}
export interface CorePackageDeploymentApplication {
  dispatch(value: unknown): Promise<CorePackageDeploymentResult>;
  receipt(value: unknown): Promise<CorePackageDeploymentResult>;
}
