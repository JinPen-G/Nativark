import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  RentalCapabilityHookOutcome,
  RentalCapabilityHookPoint
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";

/** Hook 判定对象的种类。用于按订单或报价追溯当时的判定。 */
export type CapabilityHookSubjectType = "order" | "quote" | "item_group" | "asset";

export interface CapabilityHookAuditRow {
  point: RentalCapabilityHookPoint;
  capability: string;
  implementationVersion: string;
  configVersion: string;
  decision: string;
  failed: boolean;
  subjectType: CapabilityHookSubjectType;
  subjectId: string;
  blockReasons?: unknown;
  notices?: unknown;
  linkedTasks?: unknown;
  feeBases?: unknown;
  operator?: string;
  at: string;
}

type HookTx = Prisma.TransactionClient;

/**
 * CORE-EXT-02B：Hook 执行审计的持久化。
 *
 * 唯一的写入方法**必须**接受事务客户端：审计要与 Core 的业务变更同事务提交，
 * 否则事务回滚后会留下「提示已记、业务已回滚」的记录，比没有审计更容易误导排查。
 * 因此这里刻意不提供「无事务写入」的重载。
 */
@Injectable()
export class CapabilityHookRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 把一次判定里每个执行过的能力各记一行。
   *
   * 只记 `executed` 里的能力：未启用、或未登记该节点的能力根本没参与判定，
   * 给它们记一行会让审计看起来像是「它也判过并放行了」。
   */
  async recordOutcome(
    tenantId: string,
    workspaceId: string,
    subject: { type: CapabilityHookSubjectType; id: string },
    outcome: RentalCapabilityHookOutcome,
    tx: HookTx,
    operator?: string,
    at = new Date().toISOString()
  ): Promise<number> {
    if (!outcome.executed.length) return 0;
    const byCapability = (code: string) => ({
      blockReasons: outcome.blockReasons.filter((row) => row.capability === code),
      notices: outcome.notices.filter((row) => row.capability === code),
      linkedTasks: outcome.linkedTasks.filter((row) => row.capability === code),
      feeBases: outcome.feeBases.filter((row) => row.capability === code)
    });
    const rows = outcome.executed.map((executed) => {
      const products = byCapability(executed.capability);
      return {
        tenantId,
        workspaceId,
        point: outcome.point,
        capability: executed.capability,
        implementationVersion: executed.implementationVersion,
        configVersion: executed.configVersion,
        decision: executed.decision,
        failed: Boolean(executed.failed),
        subjectType: subject.type,
        subjectId: subject.id,
        // 空数组存 null 而不是 `[]`：查询时「有没有提示」只需判空，
        // 不必区分「空数组」与「没有这一类产物」两种等价状态。
        blockReasons: products.blockReasons.length ? (products.blockReasons as unknown as Prisma.InputJsonValue) : undefined,
        notices: products.notices.length ? (products.notices as unknown as Prisma.InputJsonValue) : undefined,
        linkedTasks: products.linkedTasks.length ? (products.linkedTasks as unknown as Prisma.InputJsonValue) : undefined,
        feeBases: products.feeBases.length ? (products.feeBases as unknown as Prisma.InputJsonValue) : undefined,
        operator: operator ?? null,
        at: new Date(at)
      };
    });
    await tx.capabilityHookAuditEntry.createMany({ data: rows });
    return rows.length;
  }

  /**
   * Review P1-5：写一条**被阻止**判定的拒绝审计。
   *
   * 与 `recordOutcome` 不同，这里刻意**不要求事务**：被阻止的请求没有任何业务变更需要
   * 回滚（报价根本没生成、订单根本没建），因此这条审计不属于任何业务事务。
   * 若跟着业务事务一起回滚，拒绝就完全不留痕——而「为什么这单报不出价」正是
   * 最需要事后追溯的问题之一。
   *
   * 只追加，不更新、不删除。
   */
  async recordRejection(
    tenantId: string,
    workspaceId: string,
    subject: { type: CapabilityHookSubjectType; id: string },
    outcome: RentalCapabilityHookOutcome,
    operator?: string,
    at = new Date().toISOString()
  ): Promise<number> {
    const rows = outcome.executed
      .filter((executed) => executed.decision === "block")
      .map((executed) => ({
        tenantId,
        workspaceId,
        point: outcome.point,
        capability: executed.capability,
        implementationVersion: executed.implementationVersion,
        configVersion: executed.configVersion,
        decision: "block",
        failed: Boolean(executed.failed),
        subjectType: subject.type,
        subjectId: subject.id,
        blockReasons: outcome.blockReasons.filter((row) => row.capability === executed.capability) as unknown as Prisma.InputJsonValue,
        notices: outcome.notices.filter((row) => row.capability === executed.capability).length
          ? (outcome.notices.filter((row) => row.capability === executed.capability) as unknown as Prisma.InputJsonValue)
          : undefined,
        operator: operator ?? null,
        at: new Date(at)
      }));
    if (!rows.length) return 0;
    await this.prisma.capabilityHookAuditEntry.createMany({ data: rows });
    return rows.length;
  }

  /** 按判定对象读回审计，供追溯「这张订单当时为什么被放行并带了提示」。 */
  async listBySubject(
    tenantId: string,
    subjectType: CapabilityHookSubjectType,
    subjectId: string
  ): Promise<CapabilityHookAuditRow[]> {
    const rows = await this.prisma.capabilityHookAuditEntry.findMany({
      where: { tenantId, subjectType, subjectId },
      orderBy: [{ at: "asc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => ({
      point: row.point as RentalCapabilityHookPoint,
      capability: row.capability,
      implementationVersion: row.implementationVersion,
      configVersion: row.configVersion,
      decision: row.decision,
      failed: row.failed,
      subjectType: row.subjectType as CapabilityHookSubjectType,
      subjectId: row.subjectId,
      blockReasons: row.blockReasons ?? undefined,
      notices: row.notices ?? undefined,
      linkedTasks: row.linkedTasks ?? undefined,
      feeBases: row.feeBases ?? undefined,
      operator: row.operator ?? undefined,
      at: row.at.toISOString()
    }));
  }
}
