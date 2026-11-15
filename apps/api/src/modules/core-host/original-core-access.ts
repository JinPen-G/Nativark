/**
 * 原主体事务内读取Core授权、成员分配及绑定，复用原订阅对新业务的期限规则。
 * Core的动作权限与对象范围由调用方继续检查，数据查询始终带当前租户/Core。
 */
import type { Prisma } from "@prisma/client";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import { PlatformCoreAccess } from "@rental-os/platform-core-host/access";
import type { SubscriptionService } from "../subscription/subscription.service";
import { originalCoreTermPolicy } from "./original-core-term";

export class OriginalCoreAccess extends PlatformCoreAccess<Prisma.TransactionClient> {
  constructor(subscription: Pick<SubscriptionService, "readCategoryCommercialContext">, deployment: CoreDeploymentAvailability) {
    super(originalCoreTermPolicy(subscription), deployment);
  }
}
