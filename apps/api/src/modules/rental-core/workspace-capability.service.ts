/** 原 Nest 空间能力 provider，Rental 状态/版本实现通过原仓储和调用方事务运行。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceCapabilityService as RentalWorkspaceCapabilityService } from "@rental-os/rental-core/workspace-capabilities";
import { WorkspaceCapabilityRepository } from "./workspace-capability.repository";

@Injectable()
export class WorkspaceCapabilityService extends RentalWorkspaceCapabilityService<Prisma.TransactionClient> {
  constructor(repository: WorkspaceCapabilityRepository) {
    super({
      currentWorkspaceId: (tenantId) => repository.currentWorkspaceId(tenantId),
      workspaceScope: (tenantId, workspaceId, transaction) => repository.workspaceScope(tenantId, workspaceId, transaction),
      workspaceRunMode: (tenantId, workspaceId) => repository.workspaceRunMode(tenantId, workspaceId),
      listInstances: (tenantId, workspaceId) => repository.listInstances(tenantId, workspaceId),
      listInstancesInTx: (tenantId, workspaceId, transaction) => repository.listInstancesInTx(tenantId, workspaceId, transaction),
      findInstance: (tenantId, workspaceId, code) => repository.findInstance(tenantId, workspaceId, code),
      listAudits: (tenantId, workspaceId, code) => repository.listAudits(tenantId, workspaceId, code),
      initializeInstances: (instances, audits, transaction) => repository.initializeInstances(instances, audits, transaction),
      saveInstance: (instance, audit, expectedRevision, binding) => repository.saveInstance(instance, audit, expectedRevision, binding),
      runInTransaction: (run) => repository.runInTransaction(run)
    });
  }
}
