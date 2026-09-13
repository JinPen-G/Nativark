import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CustomerAccount,
  CustomerAccountStatus,
  CustomerMembershipStatus,
  CustomerSensitiveAccessAuditEntry,
  CustomerStatusAction,
  CustomerStatusHistoryEntry,
  CustomerStatusScope
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";

export type CustomerTx = Prisma.TransactionClient;

/** 写状态历史所需的最小信息。`at` 由服务层统一给，保证一次动作内时间一致。 */
export interface CustomerStatusHistoryInput {
  customerId: string;
  scope: CustomerStatusScope;
  workspaceId?: string;
  action: CustomerStatusAction;
  fromStatus?: string;
  toStatus: string;
  reason: string;
  operator?: string;
  approver?: string;
  at: string;
}

export interface CustomerSensitiveAccessInput {
  workspaceId?: string;
  customerId: string;
  field: string;
  action: CustomerSensitiveAccessAuditEntry["action"];
  revealed: boolean;
  operator?: string;
  permission?: string;
  reason?: string;
  at: string;
}

/**
 * CUSTOMER-01B：客户账号、空间会员状态、状态历史与访问审计的持久化。
 *
 * 与既有 `SharedCustomerRepository` 分工：那一层负责主档与空间关系的读写，
 * 本层负责 01A 新增的账号、状态历史、风险与访问审计。刻意不合并成一个巨型仓储——
 * 主档读写在几乎每个业务流程里都会用到，而状态变更与审计只在治理路径上用，
 * 混在一起会让「查客户」和「改客户状态」共享同一份依赖面。
 *
 * 两条不变量由本层保证：
 *   1. 状态变更与其历史记录**同事务**落库。历史留在一个被回滚的变更上
 *      （或反之）比没有历史更难排查。
 *   2. 所有查询都带 `tenantId`；空间级实体额外带 `workspaceId`。
 *      主档按租户共享是设计，业务关系按空间隔离是要求，两者不可互相套用。
 */
@Injectable()
export class CustomerOperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: CustomerTx) {
    return tx ?? this.prisma;
  }

  /**
   * 串行化“客户状态变化”与“开展新业务”。所有会改变可交易性的动作，
   * 以及订单创建的最终门禁，都必须先锁同一条主档记录。
   */
  async lockCustomerBusinessGate(tenantId: string, customerId: string, tx: CustomerTx): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\`
      FROM \`customer_profiles\`
      WHERE \`tenantId\` = ${tenantId} AND \`id\` = ${customerId}
      FOR UPDATE
    `);
    return rows.length > 0;
  }

  async findAccountByCustomer(
    tenantId: string,
    customerId: string,
    tx?: CustomerTx
  ): Promise<CustomerAccount | undefined> {
    const row = await this.db(tx).customerAccount.findFirst({ where: { tenantId, customerId } });
    return row ? this.toAccount(row) : undefined;
  }

  async findAccountByLoginPhone(tenantId: string, loginPhone: string): Promise<CustomerAccount | undefined> {
    const row = await this.prisma.customerAccount.findFirst({ where: { tenantId, loginPhone: loginPhone.trim() } });
    return row ? this.toAccount(row) : undefined;
  }

  async createAccount(
    tenantId: string,
    input: { customerId: string; loginPhone: string; loginPhoneMasked: string; operator?: string },
    tx?: CustomerTx
  ): Promise<CustomerAccount> {
    const row = await this.db(tx).customerAccount.create({
      data: {
        tenantId,
        customerId: input.customerId,
        loginPhone: input.loginPhone.trim(),
        loginPhoneMasked: input.loginPhoneMasked,
        status: "active",
        lastOperator: input.operator ?? null
      }
    });
    return this.toAccount(row);
  }

  /**
   * 改账号状态并在同一事务里追加历史。
   *
   * `expectedStatus` 让调用方表达「我基于读到的状态做的决定」：并发下两个人同时
   * 停用/恢复同一账号时，后写者不会静默覆盖，而是拿到 0 行更新并由服务层转 409。
   */
  async updateAccountStatus(
    tenantId: string,
    accountId: string,
    next: {
      status: CustomerAccountStatus;
      suspendedAt?: string | null;
      closedAt?: string | null;
      reason: string;
      operator?: string;
    },
    expectedStatus: CustomerAccountStatus,
    history: CustomerStatusHistoryInput,
    tx?: CustomerTx
  ): Promise<number> {
    const client = this.db(tx);
    const updated = await client.customerAccount.updateMany({
      where: { tenantId, id: accountId, status: expectedStatus },
      data: {
        status: next.status,
        suspendedAt: next.suspendedAt === undefined ? undefined : next.suspendedAt ? new Date(next.suspendedAt) : null,
        closedAt: next.closedAt === undefined ? undefined : next.closedAt ? new Date(next.closedAt) : null,
        lastReason: next.reason,
        lastOperator: next.operator ?? null
      }
    });
    if (updated.count === 0) return 0;
    await this.appendStatusHistory(tenantId, history, client);
    return updated.count;
  }

  /** 同上，但作用于空间会员关系。空间级变更绝不触碰账号行。 */
  async updateMembershipStatus(
    tenantId: string,
    linkId: string,
    next: {
      status: CustomerMembershipStatus;
      levelName?: string;
      suspendedAt?: string | null;
      restrictedAt?: string | null;
      exitedAt?: string | null;
      closedAt?: string | null;
    },
    expectedStatus: CustomerMembershipStatus,
    history: CustomerStatusHistoryInput,
    tx?: CustomerTx
  ): Promise<number> {
    const client = this.db(tx);
    const stamp = (value?: string | null) =>
      value === undefined ? undefined : value ? new Date(value) : null;
    const updated = await client.customerWorkspaceLink.updateMany({
      where: { tenantId, id: linkId, status: expectedStatus },
      data: {
        status: next.status,
        levelName: next.levelName,
        suspendedAt: stamp(next.suspendedAt),
        restrictedAt: stamp(next.restrictedAt),
        exitedAt: stamp(next.exitedAt),
        closedAt: stamp(next.closedAt)
      }
    });
    if (updated.count === 0) return 0;
    await this.appendStatusHistory(tenantId, history, client);
    return updated.count;
  }

  async appendStatusHistory(
    tenantId: string,
    input: CustomerStatusHistoryInput,
    tx?: CustomerTx
  ): Promise<void> {
    await this.db(tx).customerStatusHistoryEntry.create({
      data: {
        tenantId,
        customerId: input.customerId,
        scope: input.scope,
        workspaceId: input.workspaceId ?? null,
        action: input.action,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        reason: input.reason,
        operator: input.operator ?? null,
        approver: input.approver ?? null,
        at: new Date(input.at)
      }
    });
  }

  /**
   * 客户状态时间线。`workspaceId` 传入时只返回该空间事件 **加上** 账号级事件——
   * 账号级变更同样影响这个空间能不能做业务，隐去它会让时间线出现无法解释的跳变。
   */
  async listStatusHistory(
    tenantId: string,
    customerId: string,
    workspaceId?: string
  ): Promise<CustomerStatusHistoryEntry[]> {
    const rows = await this.prisma.customerStatusHistoryEntry.findMany({
      where: {
        tenantId,
        customerId,
        ...(workspaceId ? { OR: [{ workspaceId }, { scope: "account" }] } : {})
      },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      scope: row.scope as CustomerStatusScope,
      workspaceId: row.workspaceId ?? undefined,
      action: row.action as CustomerStatusAction,
      fromStatus: row.fromStatus ?? undefined,
      toStatus: row.toStatus,
      reason: row.reason,
      operator: row.operator ?? undefined,
      approver: row.approver ?? undefined,
      at: row.at.toISOString()
    }));
  }

  /** 记一条敏感资料访问。刻意**不接受事务**：读取不属于任何业务事务，
   *  跟着业务事务回滚会让「他确实看过」这件事消失。 */
  async recordSensitiveAccess(tenantId: string, input: CustomerSensitiveAccessInput): Promise<void> {
    await this.prisma.customerSensitiveAccessAudit.create({
      data: {
        tenantId,
        workspaceId: input.workspaceId ?? null,
        customerId: input.customerId,
        field: input.field,
        action: input.action,
        revealed: input.revealed,
        operator: input.operator ?? null,
        permission: input.permission ?? null,
        reason: input.reason ?? null,
        at: new Date(input.at)
      }
    });
  }

  async listSensitiveAccess(
    tenantId: string,
    customerId: string
  ): Promise<CustomerSensitiveAccessAuditEntry[]> {
    const rows = await this.prisma.customerSensitiveAccessAudit.findMany({
      where: { tenantId, customerId },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId ?? undefined,
      customerId: row.customerId,
      field: row.field,
      action: row.action as CustomerSensitiveAccessAuditEntry["action"],
      revealed: row.revealed,
      operator: row.operator ?? undefined,
      permission: row.permission ?? undefined,
      reason: row.reason ?? undefined,
      at: row.at.toISOString()
    }));
  }

  /** 该客户在本空间是否存在**未关闭**的风险记录。风险受限判定用它，不用主档上的位。 */
  async hasOpenRisk(tenantId: string, customerId: string, workspaceId?: string, tx?: CustomerTx): Promise<boolean> {
    const count = await this.db(tx).customerRiskRecord.count({
      where: {
        tenantId,
        customerId,
        status: { in: ["open", "reviewing"] },
        // 租户级风险（workspaceId 为空）对任何空间都成立；空间级只对该空间成立。
        ...(workspaceId ? { OR: [{ workspaceId: null }, { workspaceId }] } : {})
      }
    });
    return count > 0;
  }

  private toAccount(row: {
    id: string;
    tenantId: string;
    customerId: string;
    loginPhone: string;
    loginPhoneMasked: string;
    status: string;
    suspendedAt: Date | null;
    closedAt: Date | null;
    lastReason: string | null;
    lastOperator: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerAccount {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      loginPhone: row.loginPhone,
      loginPhoneMasked: row.loginPhoneMasked,
      status: row.status as CustomerAccountStatus,
      suspendedAt: row.suspendedAt?.toISOString(),
      closedAt: row.closedAt?.toISOString(),
      lastReason: row.lastReason ?? undefined,
      lastOperator: row.lastOperator ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
