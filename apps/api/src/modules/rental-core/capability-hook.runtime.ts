/**
 * 原 Nest 能力 provider，实例、审计和可选候选表沿原依赖注入组合。
 * 实际执行与历史判定由 Rental Core 正式出口承担，审计沿原 Prisma 事务。
 */
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RENTAL_CAPABILITY_MODULES, type RentalCapabilityDefinition } from "@rental-os/shared";
import {
  CapabilityHookRuntime as RentalCapabilityHookRuntime,
  type CapabilityHookEvaluateInput as RentalCapabilityHookEvaluateInput
} from "@rental-os/rental-core/capability-runtime";
import { CapabilityHookRepository } from "./capability-hook.repository";
import { WorkspaceCapabilityService } from "./workspace-capability.service";

export {
  CapabilityBlockedException,
  assertCapabilityHookRuntimeAvailable,
  requiresCapabilityHookRuntime,
  type CapabilityHookRunInput
} from "@rental-os/rental-core/capability-runtime";

export type CapabilityHookEvaluateInput<TSubject> = RentalCapabilityHookEvaluateInput<TSubject, Prisma.TransactionClient>;

@Injectable()
export class CapabilityHookRuntime extends RentalCapabilityHookRuntime<Prisma.TransactionClient> {
  constructor(
    capabilities: WorkspaceCapabilityService,
    @Optional() audits?: CapabilityHookRepository,
    // 数组是可选装配参数，Nest 传入 undefined 时使用正式注册表。
    @Optional() registry: RentalCapabilityDefinition[] = RENTAL_CAPABILITY_MODULES
  ) {
    super(
      { enabledInstances: (tenantId, workspaceId) => capabilities.enabledInstances(tenantId, workspaceId) },
      audits ? { recordOutcome: (...args) => audits.recordOutcome(...args) } : undefined,
      registry
    );
  }
}
