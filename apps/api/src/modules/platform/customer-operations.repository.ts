import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CustomerAccount,
  CustomerAccountStatus,
  CustomerMembershipStatus,
  CustomerRiskRecordSummary,
  CustomerRiskStatus,
  CustomerRiskType,
  CustomerRiskLevel,
  CustomerSensitiveAccessAuditEntry,
  CustomerStatusAction,
  CustomerStatusHistoryEntry,
  CustomerStatusScope
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "./shared-customer.repository";

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
  /** Internal original status transaction only; never supplied by a client DTO. */
  captureEnterpriseRecipients?: boolean;
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
 * CUSTOMER-01B：客户账号、租户会员状态、状态历史与访问审计的持久化。
 *
 * 与既有 `SharedCustomerRepository` 分工：那一层是主档、账号、会员与审核四个模型的**唯一写入口**，
 * 本层负责 01A 新增的状态历史、风险与访问审计，并把账号 / 会员的状态变更与其历史
 * 组合成同事务动作（写本身委托给 SharedCustomerRepository）。刻意不合并成一个巨型仓储——
 * 主档读写在几乎每个业务流程里都会用到，而状态变更与审计只在治理路径上用，
 * 混在一起会让「查客户」和「改客户状态」共享同一份依赖面。
 *
 * 两条不变量由本层保证：
 *   1. 状态变更与其历史记录**同事务**落库。历史留在一个被回滚的变更上
 *      （或反之）比没有历史更难排查。
 *   2. 所有查询都带 `tenantId`；仅审计来源与历史空间事件保留 `workspaceId`。
 */
@Injectable()
export class CustomerOperationsRepository {
  private readonly customers: SharedCustomerRepository;

  constructor(
    private readonly prisma: PrismaService,
    // 既有测试用 `new CustomerOperationsRepository(prisma)` 构造；缺失时按同一个 prisma 自建。
    @Optional() customers?: SharedCustomerRepository
  ) {
    this.customers = customers ?? new SharedCustomerRepository(prisma);
  }

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
    const row = await this.customers.createAccount({
      tenantId,
      customerId: input.customerId,
      loginPhone: input.loginPhone,
      loginPhoneMasked: input.loginPhoneMasked,
      lastOperator: input.operator ?? null
    }, tx);
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
    const count = await this.customers.updateAccount(tenantId, { accountId }, {
      status: next.status,
      suspendedAt: next.suspendedAt === undefined ? undefined : next.suspendedAt ? new Date(next.suspendedAt) : null,
      closedAt: next.closedAt === undefined ? undefined : next.closedAt ? new Date(next.closedAt) : null,
      lastReason: next.reason,
      lastOperator: next.operator ?? null
    }, expectedStatus, tx);
    if (count === 0) return 0;
    await this.appendStatusHistory(tenantId, history, client);
    return count;
  }

  /** 同上，但作用于唯一租户会员；会员变更绝不触碰账号行。 */
  async updateMembershipStatus(
    tenantId: string,
    membershipId: string,
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
    const count = await this.customers.updateMembership(tenantId, membershipId, {
      status: next.status,
      levelName: next.levelName,
      suspendedAt: stamp(next.suspendedAt),
      restrictedAt: stamp(next.restrictedAt),
      exitedAt: stamp(next.exitedAt),
      closedAt: stamp(next.closedAt)
    }, expectedStatus, tx);
    if (count === 0) return 0;
    await this.appendStatusHistory(tenantId, history, client);
    return count;
  }

  async appendStatusHistory(
    tenantId: string,
    input: CustomerStatusHistoryInput,
    tx?: CustomerTx
  ): Promise<void> {
    const recorded = await this.db(tx).customerStatusHistoryEntry.create({
      data: {
        tenantId,
        customerId: input.customerId,
        scope: input.scope,
        workspaceId: input.scope === "membership" ? null : input.workspaceId ?? null,
        action: input.action,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus,
        reason: input.reason,
        operator: input.operator ?? null,
        approver: input.approver ?? null,
        at: new Date(input.at)
      },
      select: { id: true }
    });
    if (input.captureEnterpriseRecipients === true && input.scope === "membership" && input.action !== "merge") {
      if (!tx || tx === (this.prisma as unknown as CustomerTx) || typeof recorded?.id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(recorded.id)) {
        console.warn("Corporate status recipient capture unavailable: original transaction/history reference required");
      } else {
        await this.captureCorporateStatusRecipients(tenantId, recorded.id, tx);
      }
    }
  }

  /** One InnoDB statement captures all bounded recipients or none. Prisma/MySQL
   * cannot prepare SAVEPOINT; never emulate one with partial inserts or retries. */
  private async captureCorporateStatusRecipients(tenantId: string, historyId: string, tx: CustomerTx): Promise<void> {
    try {
      const count = await tx.$executeRaw`
        INSERT INTO enterprise_corporate_status_recipients
          (tenantId,historyId,corporateCustomerId,recipientCustomerId,membershipId,membershipUpdatedAt,capturedAt)
        SELECT batch.tenantId,batch.historyId,batch.corporateCustomerId,batch.recipientCustomerId,batch.membershipId,batch.membershipUpdatedAt,NOW(3)
        FROM (
          SELECT bounded.*,COUNT(*) OVER () AS recipientCount
          FROM (
            SELECT h.tenantId,h.id AS historyId,h.customerId AS corporateCustomerId,m.personalCustomerId AS recipientCustomerId,m.id AS membershipId,m.updatedAt AS membershipUpdatedAt
            FROM customer_status_history h
            JOIN Tenant t ON t.id=h.tenantId AND t.status='ACTIVE'
            JOIN customer_profiles c ON c.tenantId=h.tenantId AND c.id=h.customerId AND c.customerType='corporate' AND c.status='active' AND c.mergedIntoCustomerId IS NULL
            JOIN customer_corporate_memberships m ON m.tenantId=h.tenantId AND m.corporateCustomerId=h.customerId
            JOIN customer_profiles p ON p.tenantId=m.tenantId AND p.id=m.personalCustomerId AND p.customerType='personal' AND p.status='active' AND p.mergedIntoCustomerId IS NULL
            JOIN customer_accounts a ON a.tenantId=p.tenantId AND a.customerId=p.id AND a.status='active'
            JOIN customer_memberships pm ON pm.tenantId=p.tenantId AND pm.customerId=p.id AND pm.status='active'
            WHERE h.tenantId=${tenantId} AND h.id=${historyId} AND h.scope='membership' AND h.workspaceId IS NULL AND h.action<>'merge'
              AND m.role IN ('admin','employee') AND m.status='active' AND m.effectiveFrom<=NOW(3) AND (m.effectiveTo IS NULL OR m.effectiveTo>NOW(3))
              AND (EXISTS (SELECT 1 FROM enterprise_corporate_portals portal WHERE portal.tenantId=m.tenantId AND portal.corporateCustomerId=m.corporateCustomerId)
                OR EXISTS (SELECT 1 FROM enterprise_scope_policies policy WHERE policy.tenantId=m.tenantId AND policy.corporateCustomerId=m.corporateCustomerId))
            ORDER BY m.id LIMIT 201
          ) bounded
        ) batch
        WHERE batch.recipientCount<=200`;
      if (!Number.isSafeInteger(count) || count < 0 || count > 200) throw new Error("Corporate status recipient capture out of bounds");
    } catch (error) {
      // Only these InnoDB errors roll back the failed statement, not the original
      // status transaction. Deadlock, timeout, connection loss and unknown errors
      // propagate: they must never look like a committed safety action.
      const statementOnly = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" &&
        ["1146", "1054", "1452", "1062"].includes(String(error.meta?.code));
      if (!statementOnly) throw error;
      console.warn("Corporate status recipient capture unavailable; original status action continues without a message capture");
    }
  }

  /**
   * 客户状态时间线。空间筛选仍可读取历史 workspace 事件，同时始终包含全租户
   * 的账号与会员事件，避免空间页面隐藏影响本空间业务的全局状态变化。
   */
  async listStatusHistory(
    tenantId: string,
    customerId: string,
    workspaceId?: string,
    includeWorkspaceEvents = true
  ): Promise<CustomerStatusHistoryEntry[]> {
    const rows = await this.prisma.customerStatusHistoryEntry.findMany({
      where: {
        tenantId,
        customerId,
        ...(workspaceId ? {
          OR: [
            ...(includeWorkspaceEvents ? [{ workspaceId }] : []),
            { scope: { in: ["account", "membership"] } }
          ]
        } : {})
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
    customerId: string,
    workspaceId?: string
  ): Promise<CustomerSensitiveAccessAuditEntry[]> {
    const rows = await this.prisma.customerSensitiveAccessAudit.findMany({
      where: { tenantId, customerId, ...(workspaceId ? { workspaceId } : {}) },
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

  async listRiskRecords(
    tenantId: string,
    customerId: string,
    workspaceId: string,
    tx?: CustomerTx
  ): Promise<CustomerRiskRecordSummary[]> {
    const rows = await this.db(tx).customerRiskRecord.findMany({
      where: { tenantId, customerId, OR: [{ workspaceId: null }, { workspaceId }] },
      orderBy: [{ raisedAt: "desc" }, { id: "desc" }]
    });
    return rows.map((row) => this.toRiskRecordSummary(row));
  }

  async findRiskRecord(
    tenantId: string,
    customerId: string,
    riskRecordId: string,
    workspaceId: string,
    tx?: CustomerTx
  ): Promise<CustomerRiskRecordSummary | undefined> {
    const row = await this.db(tx).customerRiskRecord.findFirst({
      where: {
        id: riskRecordId,
        tenantId,
        customerId,
        OR: [{ workspaceId: null }, { workspaceId }]
      }
    });
    return row ? this.toRiskRecordSummary(row) : undefined;
  }

  async createRiskRecord(
    input: {
      tenantId: string;
      customerId: string;
      workspaceId: string | null;
      riskType: CustomerRiskType;
      level: CustomerRiskLevel;
      detail: string;
      source: string;
      raisedBy?: string;
      raisedAt: Date;
    },
    tx: CustomerTx
  ): Promise<CustomerRiskRecordSummary> {
    const row = await tx.customerRiskRecord.create({ data: input });
    return this.toRiskRecordSummary(row);
  }

  async updateRiskRecordDecision(
    tenantId: string,
    customerId: string,
    riskRecordId: string,
    input: {
      status: CustomerRiskStatus;
      reviewedBy?: string;
      reviewedAt: Date;
      closeReason?: string;
      closedAt?: Date;
    },
    tx: CustomerTx
  ): Promise<CustomerRiskRecordSummary | undefined> {
    const changed = await tx.customerRiskRecord.updateMany({
      where: { id: riskRecordId, tenantId, customerId, status: { in: ["open", "reviewing"] } },
      data: input
    });
    if (!changed.count) return undefined;
    const row = await tx.customerRiskRecord.findUnique({ where: { id: riskRecordId } });
    return row ? this.toRiskRecordSummary(row) : undefined;
  }

  private toRiskRecordSummary(row: {
    id: string;
    tenantId: string;
    customerId: string;
    workspaceId: string | null;
    riskType: string;
    level: string;
    detail: string;
    source: string;
    status: string;
    raisedBy: string | null;
    raisedAt: Date;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    closeReason: string | null;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerRiskRecordSummary {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      workspaceId: row.workspaceId ?? undefined,
      riskType: row.riskType as CustomerRiskType,
      level: row.level as CustomerRiskLevel,
      detail: row.detail,
      source: row.source,
      status: row.status as CustomerRiskStatus,
      raisedBy: row.raisedBy ?? undefined,
      raisedAt: row.raisedAt.toISOString(),
      reviewedBy: row.reviewedBy ?? undefined,
      reviewedAt: row.reviewedAt?.toISOString(),
      closeReason: row.closeReason ?? undefined,
      closedAt: row.closedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
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
