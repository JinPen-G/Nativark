/** 原 Nest 能力存储适配，实例/审计使用原数据库，范围与品类锁保持原Auth/ALS和事务接点。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceCapabilityRepository as RentalWorkspaceCapabilityRepository } from "@rental-os/rental-core/workspace-capability-repository";
import { PrismaService } from "../database/prisma.service";
import { RentalCategoryResolver } from "./rental-category-resolver.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { lockActiveCategoryBinding } from "./category-active-write";

@Injectable()
export class WorkspaceCapabilityRepository extends RentalWorkspaceCapabilityRepository<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, categoryResolver?: RentalCategoryResolver) {
    super({
      workspaceCapabilityInstance: {
        findMany: (input) => prisma.workspaceCapabilityInstance.findMany(input),
        findFirst: (input) => prisma.workspaceCapabilityInstance.findFirst(input),
        createMany: (input) => prisma.workspaceCapabilityInstance.createMany(input),
        create: (input) => prisma.workspaceCapabilityInstance.create(input),
        updateMany: (input) => prisma.workspaceCapabilityInstance.updateMany(input)
      },
      workspaceCapabilityAuditEntry: {
        findMany: (input) => prisma.workspaceCapabilityAuditEntry.findMany(input),
        createMany: (input) => prisma.workspaceCapabilityAuditEntry.createMany(input),
        create: (input) => prisma.workspaceCapabilityAuditEntry.create(input)
      },
      $transaction: (run) => prisma.$transaction(run)
    }, {
      currentWorkspaceId: (tenantId) => resolveScopeWorkspaceId(prisma, tenantId),
      readWorkspaceScope: (tenantId, workspaceId, transaction) => (transaction ?? prisma).businessWorkspace.findFirst({
        where: { tenantId, id: workspaceId },
        include: { category: { select: { defaultCapabilities: true } } }
      }),
      readWorkspaceRunMode: (tenantId, workspaceId) => prisma.businessWorkspace.findFirst({
        where: { tenantId, id: workspaceId }, select: { runMode: true }
      }),
      resolveCategory: categoryResolver ? (tenantId, workspaceId) => categoryResolver.forWorkspace(tenantId, workspaceId) : undefined,
      lockCategoryBinding: (transaction, tenantId, workspaceId, expected) => lockActiveCategoryBinding(transaction, tenantId, workspaceId, expected)
    });
  }
}
