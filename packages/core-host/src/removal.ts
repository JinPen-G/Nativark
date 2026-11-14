/** 只读汇合Core与平台的移除阻碍；clear只是当前预检，没有删除、停用、排空执行或部署许可。 */
import { CorePlatformRemovalObservationSchema, CoreRemovalAssessmentSchema, CoreRemovalObservationSchema, CoreRemovalQuerySchema,
  type CorePlatformRemovalObservation, type CoreRemovalObservation, type CoreRemovalAssessment } from "@rental-os/core-contracts";
import { CoreAccessError } from "./access";
import type { CoreDeployedCatalogue } from "./deployment";

export interface CorePlatformRemovalSource {
  /** 从实际准入、任务、回调/作业和历史读取依赖获取观察，不从已停用租户推断已排空。 */
  read(coreId: string): Promise<CorePlatformRemovalObservation>;
}

export class CoreRemovalService {
  constructor(private readonly catalogue: CoreDeployedCatalogue, private readonly platform: CorePlatformRemovalSource,
    private readonly clock: () => Date = () => new Date()) {}

  async inspect(input: unknown): Promise<CoreRemovalObservation> {
    const { coreId } = CoreRemovalQuerySchema.parse(input), registration = this.catalogue.registrations.get(coreId);
    if (!registration) throw new CoreAccessError("core_unavailable", "移除预检的Core未在当前部署登记");
    const blockers: CoreRemovalAssessment["blockers"] = [];
    if (registration.server.assessRemoval) {
      const assessed = CoreRemovalAssessmentSchema.safeParse(await registration.server.assessRemoval());
      if (!assessed.success) throw new CoreAccessError("core_unavailable", "Core移除检查返回不符合正式合同");
      blockers.push(...assessed.data.blockers);
    } else blockers.push({ kind: "history", code: "core_removal_checker_missing", message: "Core尚未提供移除检查器，必须保留其业务和历史读取依赖" });
    // Core检查可能等待异步记录；最后读取平台当前准入及依赖，不能沿用调用前的空状态。
    const observed = CorePlatformRemovalObservationSchema.safeParse(await this.platform.read(coreId));
    if (!observed.success) throw new CoreAccessError("core_unavailable", "平台移除依赖读取不符合正式合同");
    const platform = observed.data;
    blockers.push(...platform.blockers);
    if (platform.admission !== "stopped") blockers.push({ kind: platform.admission === "unknown" ? "unknown" : "in_flight",
      code: "core_admission_not_stopped", message: "当前部署尚未确认停止该Core新准入，不能移除代码" });
    if (!platform.complete) blockers.push({ kind: "history", code: "platform_dependencies_incomplete",
      message: "平台任务、回调、作业或历史读取依赖尚未完整核对，不能视为排空完成" });
    const result = CoreRemovalObservationSchema.safeParse({ scope: "removal-preflight", coreId,
      implementationVersion: registration.manifest.version, checkedAt: this.clock().toISOString(),
      status: blockers.length ? "blocked" : "clear", blockers });
    if (!result.success) throw new CoreAccessError("core_unavailable", "移除预检中的原操作归属或结果不符合当前Core");
    return result.data;
  }
}
