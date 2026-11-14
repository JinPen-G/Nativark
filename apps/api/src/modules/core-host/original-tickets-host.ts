/**
 * 非租赁工单示范使用原平台身份、Core授权/成员分配及注册的业务权限。
 * 新工单沿原订阅期限准入，旧工单处理和原收据按当前对象权限读取与执行。
 */
import type { Prisma } from "@prisma/client";
import type { CoreScopeRequest } from "@rental-os/core-contracts";
import type { CoreDeploymentAvailability } from "@rental-os/core-host";
import { TicketsService, TicketError, TICKETS_CORE_ID, TICKETS_DATA_VERSION, createTicketsServer } from "@rental-os/example-tickets-core";
import { createMysqlTicketsExecution } from "@rental-os/example-tickets-core/mysql";
import type { SystemUserRow } from "@rental-os/shared";
import type { OperationLogService } from "../../common/operation-log.service";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import { OriginalCorePrincipalAuthority } from "./original-core-principal";
import { OriginalCoreAccess } from "./original-core-access";

const hasPermission = (user: SystemUserRow, action: string) => user.permissions.includes("*")
  || user.permissions.includes(`${TICKETS_CORE_ID}:ticket:${action}`);

export function composeOriginalTicketsHost(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  audit: Pick<OperationLogService, "recordCoreBusinessReceipt">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  deployment: CoreDeploymentAvailability;
}) {
  const principals = new OriginalCorePrincipalAuthority(input.users);
  const access = new OriginalCoreAccess(input.subscription, input.deployment);
  const execution = createMysqlTicketsExecution<Prisma.TransactionClient>(input.database, {
    async authorize(transaction, request) {
      const lease = await principals.lock(transaction, request.principal, request.principal.tenantId, request.assigneeId);
      const scope = { coreId: TICKETS_CORE_ID, tenantId: lease.principal.tenantId };
      const authorize = async () => {
        const user = await lease.revalidate();
        if (user.isSaasAdmin || !hasPermission(user, request.permission)) throw new TicketError("denied", "当前账号缺少该工单操作权限");
        if (request.purpose === "business") {
          await access.requireMember(transaction, user, TICKETS_CORE_ID);
          if (request.permission === "create") await access.requireNewBusiness(transaction, user.tenantId);
        } else if (request.permission !== "read") throw new TicketError("denied", "原操作查询只允许工单读取权限");
        const binding = await access.binding(transaction, scope);
        if (!binding || binding.dataVersion !== TICKETS_DATA_VERSION) throw new TicketError("denied", "工单Core尚未完成当前数据版本绑定");
        return user;
      };
      const user = await authorize();
      if (request.assigneeId) {
        const assignee = await input.users.findUserById(request.assigneeId, transaction);
        if (!assignee || assignee.tenantId !== user.tenantId || assignee.isSaasAdmin)
          throw new TicketError("denied", "受派成员不是当前租户的有效工单成员");
        await access.requireMember(transaction, assignee, TICKETS_CORE_ID);
      }
      return { tenantId: user.tenantId, userId: user.id, readAll: hasPermission(user, "read.all"),
        canAssign: hasPermission(user, "assign"), authorizedAssigneeId: request.assigneeId,
        revalidate: async () => { await authorize(); } };
    },
    audit: (transaction, receipt) => input.audit.recordCoreBusinessReceipt(transaction, {
      tenantId: receipt.ticket.tenantId,
      userId: receipt.actorId,
      coreId: TICKETS_CORE_ID,
      targetType: "example-ticket",
      targetId: receipt.ticket.id,
      operationId: receipt.operationId,
      revision: receipt.ticket.revision,
      fingerprint: receipt.fingerprint,
      state: receipt.ticket.state
    })
  });
  const resolveAuthorizedBinding = (request: CoreScopeRequest) => input.database.$transaction(async transaction => {
    const lease = await principals.lock(transaction, request.principal, request.scope.tenantId);
    if (lease.user.isSaasAdmin || request.scope.coreId !== TICKETS_CORE_ID || request.scope.container)
      throw new TicketError("denied", "工单Core范围不符合当前主体");
    await access.requireMember(transaction, lease.user, TICKETS_CORE_ID);
    const binding = await access.binding(transaction, request.scope);
    await lease.revalidate();
    return binding;
  }, { isolationLevel: "ReadCommitted" });
  return { service: new TicketsService(execution), principals, server: createTicketsServer({ resolveAuthorizedBinding }) };
}
