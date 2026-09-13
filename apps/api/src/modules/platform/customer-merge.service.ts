import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CustomerClosability,
  CustomerDuplicateCandidate,
  CustomerMembershipStatus,
  CustomerMergePreview,
  MergeCustomersRequest
} from "@rental-os/shared";
import { $Enums, Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { CustomerOperationsRepository } from "./customer-operations.repository";
import { SharedCustomerRepository } from "./shared-customer.repository";

const stamp = () => new Date().toISOString();

/** 订单的非终态。落在这些状态上的订单都算「未完成」，注销前必须先处理。 */
const OPEN_ORDER_STATUSES: $Enums.RentalOrderV1Status[] = [
  $Enums.RentalOrderV1Status.DRAFT,
  $Enums.RentalOrderV1Status.RESERVED,
  $Enums.RentalOrderV1Status.READY_FOR_PICKUP,
  $Enums.RentalOrderV1Status.RENTING,
  $Enums.RentalOrderV1Status.RETURN_INSPECTION
];

const mask = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 4) return "****";
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
};

/**
 * CUSTOMER-01D：重复客户识别、人工合并与注销前置检查。
 *
 * 三条口径贯穿本层：
 *   1. **合并不搬数据**。需求 4.8.3 明确「合并后订单、支付、合同和历史事件继续保留
 *      原始业务引用」，因此合并只写映射 + 标记被合并方，绝不 UPDATE 订单的 customerId。
 *      搬数据会让历史凭证与当时的事实不一致，且不可逆。
 *   2. **不混合空间权益**。各空间等级、积分、营销余额、优惠券分别保留，
 *      合并不把它们转成跨空间权益，也不把两边等级合成一个。
 *   3. **注销只挡真实存在的事实，缺数据源的类别显式要求人工确认**。
 *      假装检查过退款与争议，正是需求 4.8.13 所禁止的「借注销规避欠款」。
 */
@Injectable()
export class CustomerMergeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SharedCustomerRepository) private readonly customers: SharedCustomerRepository,
    @Inject(CustomerOperationsRepository) private readonly operations: CustomerOperationsRepository
  ) {}

  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  /**
   * 找出可能与该客户重复的主档（需求 4.8.3）。
   *
   * 只在**同租户内**查找——跨租户重复不是重复，那是两个不同租户各自的客户。
   * 已被合并掉的主档仍会列出，但带 `mergedIntoCustomerId`，供界面标灰而不是当成可选目标。
   */
  async findDuplicates(tenantId: string, customerId: string): Promise<CustomerDuplicateCandidate[]> {
    const profile = await this.customers.findById(tenantId, customerId);
    if (!profile) throw new NotFoundException("客户不存在");

    const found = new Map<string, CustomerDuplicateCandidate>();
    const push = (row: {
      id: string; name: string; phoneMasked: string; customerType: string;
      mergedIntoCustomerId?: string | null; createdAt: Date;
    }, matchedBy: string, matchedValueMasked?: string) => {
      if (row.id === customerId) return;
      // 先命中的判据优先保留：phone 比 contact_phone 更强，顺序由调用次序决定。
      if (found.has(row.id)) return;
      found.set(row.id, {
        customerId: row.id,
        name: row.name,
        phoneMasked: row.phoneMasked,
        customerType: row.customerType as CustomerDuplicateCandidate["customerType"],
        matchedBy,
        matchedValueMasked,
        mergedIntoCustomerId: row.mergedIntoCustomerId ?? undefined,
        createdAt: row.createdAt.toISOString()
      });
    };

    // 1) 手机号完全相同。库层已保证同租户手机号唯一，因此这条通常查不到——
    //    但存量数据（唯一键建立之前写入的行）仍可能存在，必须照查。
    for (const row of await this.prisma.customerProfile.findMany({
      where: { tenantId, phone: profile.phone, id: { not: customerId } }
    })) {
      push(row, "phone", row.phoneMasked);
    }

    // 2) 实名证件掩码相同（个人）。掩码相同不等于证件相同，因此它只是**候选**，
    //    最终由人工核验——这也是需求把合并定为人工动作的原因。
    if (profile.identityNoMasked) {
      for (const row of await this.prisma.customerProfile.findMany({
        where: { tenantId, identityNoMasked: profile.identityNoMasked, id: { not: customerId } }
      })) {
        push(row, "identity", profile.identityNoMasked);
      }
    }

    // 3) 企业：统一社会信用代码相同。库层同租户唯一，同样只为存量兜底。
    const corporate = await this.prisma.customerCorporateProfile.findFirst({
      where: { tenantId, customerId }
    });
    if (corporate) {
      const peers = await this.prisma.customerCorporateProfile.findMany({
        where: { tenantId, unifiedSocialCreditCode: corporate.unifiedSocialCreditCode, customerId: { not: customerId } },
        include: { customer: true }
      });
      for (const peer of peers) {
        push(peer.customer, "uscc", corporate.unifiedSocialCreditCodeMasked);
      }
    }

    // 4) 已验证联系人手机号相同（需求 4.8.3：企业结合已验证联系人识别）。
    for (const contact of await this.prisma.customerContact.findMany({
      where: { tenantId, customerId, status: "active" }
    })) {
      for (const row of await this.prisma.customerProfile.findMany({
        where: { tenantId, phone: contact.phone, id: { not: customerId } }
      })) {
        push(row, "contact_phone", contact.phoneMasked);
      }
    }

    return [...found.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  /**
   * 合并预览。**只读**，不写任何东西。
   *
   * 预览与提交分开是需求要求的人工闭环：运营先看清字段冲突、双方空间会员关系
   * 与将被保留的历史引用，再决定是否提交。直接一步合并没有回头路。
   */
  async previewMerge(
    tenantId: string,
    sourceCustomerId: string,
    targetCustomerId: string,
    tx?: Prisma.TransactionClient
  ): Promise<CustomerMergePreview> {
    const db = this.db(tx);
    const [source, target] = await Promise.all([
      this.customers.findById(tenantId, sourceCustomerId, undefined, tx),
      this.customers.findById(tenantId, targetCustomerId, undefined, tx)
    ]);
    const blockers: CustomerMergePreview["blockers"] = [];
    if (!source || !target) throw new NotFoundException("待合并的客户不存在");
    if (sourceCustomerId === targetCustomerId) {
      blockers.push({ code: "same_customer", message: "被合并方与保留方不能是同一份主档" });
    }
    if (source.mergedIntoCustomerId) {
      blockers.push({ code: "source_already_merged", message: "被合并方已经被合并过，不能重复合并" });
    }
    // 目标也已被合并 → 会形成 A→B→C 的链，历史引用要多跳才能找到当前主档。
    if (target.mergedIntoCustomerId) {
      blockers.push({ code: "target_already_merged", message: "保留方本身已被合并，请直接合并到最终保留的主档" });
    }
    if (source.customerType !== target.customerType) {
      blockers.push({ code: "type_mismatch", message: "个人客户与企业客户不能互相合并" });
    }

    const fields: Array<[string, string | undefined, string | undefined]> = [
      ["name", source.name, target.name],
      ["phone", source.phoneMasked, target.phoneMasked],
      ["email", mask(source.email), mask(target.email)],
      ["identityNoMasked", source.identityNoMasked, target.identityNoMasked],
      ["corporateName", source.corporateName, target.corporateName],
      ["corporateTaxNo", mask(source.corporateTaxNo), mask(target.corporateTaxNo)]
    ];
    const fieldDiff = fields.map(([field, sourceValue, targetValue]) => ({
      field,
      sourceValue,
      targetValue,
      // 只有两边都有值且不同才算冲突：一边为空是补全，不需要人工取舍。
      conflict: Boolean(sourceValue && targetValue && sourceValue !== targetValue)
    }));

    const [sourceLinks, targetLinks] = await Promise.all([
      db.customerWorkspaceLink.findMany({ where: { tenantId, customerId: sourceCustomerId } }),
      db.customerWorkspaceLink.findMany({ where: { tenantId, customerId: targetCustomerId } })
    ]);
    const toMembership = (row: { workspaceId: string; levelName: string; status: string }) => ({
      workspaceId: row.workspaceId,
      levelName: row.levelName,
      status: row.status as CustomerMembershipStatus
    });
    const targetWorkspaceIds = new Set(targetLinks.map((row) => row.workspaceId));

    // 将被保留的历史引用：合并后这些仍指向被合并方，不搬迁。
    const [asCustomer, asContract, asPayer, asUser] = await Promise.all([
      db.rentalOrder.count({ where: { tenantId, customerId: sourceCustomerId } }),
      db.rentalOrder.count({ where: { tenantId, contractSubjectCustomerId: sourceCustomerId } }),
      db.rentalOrder.count({ where: { tenantId, payerSubjectCustomerId: sourceCustomerId } }),
      db.rentalOrder.count({ where: { tenantId, userSubjectCustomerId: sourceCustomerId } })
    ]);

    return {
      sourceCustomerId,
      targetCustomerId,
      fieldDiff,
      sourceMemberships: sourceLinks.map(toMembership),
      targetMemberships: targetLinks.map(toMembership),
      overlappingWorkspaceIds: sourceLinks
        .filter((row) => targetWorkspaceIds.has(row.workspaceId))
        .map((row) => row.workspaceId),
      preservedReferences: [
        { kind: "order_customer", count: asCustomer },
        { kind: "order_contract_subject", count: asContract },
        { kind: "order_payer_subject", count: asPayer },
        { kind: "order_user_subject", count: asUser }
      ],
      blockers
    };
  }

  /**
   * 提交人工合并。**一个事务**里完成：写映射、标记被合并方、关闭其登录账号、双方各记一条历史。
   *
   * 刻意**不做**的三件事：
   *   1. 不 UPDATE 任何订单的 customerId 或主体列——历史引用必须继续指向被合并方
   *      （需求 4.8.3）。搬迁会让历史凭证与当时事实不一致，而且不可逆。
   *   2. 不合并空间会员关系与权益——各空间等级、积分、券分别保留，
   *      不因合并变成跨空间权益。被合并方的会员关系原样留着作为历史，
   *      但它已无法开展新业务（`mergedIntoCustomerId` 由 01B 的 assertTransactable 拦下）。
   *   3. 不删除被合并方主档——订单、发票、合同仍引用它。
   */
  async mergeCustomers(tenantId: string, input: MergeCustomersRequest, operator?: string) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("人工合并必须填写原因");
    const preview = await this.previewMerge(tenantId, input.sourceCustomerId, input.targetCustomerId);
    if (preview.blockers.length) {
      throw new ConflictException(`不能合并：${preview.blockers.map((row) => row.message).join("；")}`);
    }
    const at = stamp();
    await this.prisma.$transaction(async (tx) => {
      // 与订单创建共用主档行锁。按 id 排序依次加锁，避免两路反向合并形成死锁。
      for (const customerId of [input.sourceCustomerId, input.targetCustomerId].sort()) {
        if (!(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
          throw new NotFoundException("待合并的客户不存在");
        }
      }
      // 事务外预览只服务于快速反馈；真正提交必须在锁后重算，不能使用陈旧快照。
      const lockedPreview = await this.previewMerge(tenantId, input.sourceCustomerId, input.targetCustomerId, tx);
      if (lockedPreview.blockers.length) {
        throw new ConflictException(`不能合并：${lockedPreview.blockers.map((row) => row.message).join("；")}`);
      }
      const sourceAccount = await this.operations.findAccountByCustomer(tenantId, input.sourceCustomerId, tx);
      // 以「尚未被合并」为写入条件：并发两路合并同一主档时，后到者更新 0 行并拿到 409，
      // 而不是双双写出映射（唯一键也会挡，但这里先给出可解释的错误）。
      const marked = await tx.customerProfile.updateMany({
        where: { tenantId, id: input.sourceCustomerId, mergedIntoCustomerId: null },
        data: { mergedIntoCustomerId: input.targetCustomerId, status: "merged" }
      });
      if (marked.count === 0) {
        throw new ConflictException("该主档已被合并或正被并发合并，请刷新后重试");
      }
      await tx.customerMergeMapping.create({
        data: {
          tenantId,
          sourceCustomerId: input.sourceCustomerId,
          targetCustomerId: input.targetCustomerId,
          reason,
          operator: operator ?? null,
          approver: input.approver ?? null,
          // 字段差异与人工取舍结论一并固化：事后要能解释「保留了谁的值、谁决定的」。
          fieldDiff: {
            diff: lockedPreview.fieldDiff,
            resolutions: input.fieldResolutions ?? {}
          } as unknown as object,
          // 双方空间会员关系快照：证明合并当时各空间权益是分开的，没有被合成一份。
          membershipSnapshot: {
            source: lockedPreview.sourceMemberships,
            target: lockedPreview.targetMemberships,
            overlappingWorkspaceIds: lockedPreview.overlappingWorkspaceIds,
            preservedReferences: lockedPreview.preservedReferences
          } as unknown as object,
          mergedAt: new Date(at)
        }
      });
      // 被合并方的登录账号必须关掉：主档已是终态，留一个能登录的账号等于留一个
      // 可以继续下单的入口。账号不存在则跳过（线下客户没有账号）。
      if (sourceAccount && sourceAccount.status !== "closed") {
        await tx.customerAccount.updateMany({
          where: { tenantId, id: sourceAccount.id },
          data: { status: "closed", closedAt: new Date(at), lastReason: `合并进 ${input.targetCustomerId}：${reason}`, lastOperator: operator ?? null }
        });
        await this.operations.appendStatusHistory(tenantId, {
          customerId: input.sourceCustomerId,
          scope: "account",
          action: "close",
          fromStatus: sourceAccount.status,
          toStatus: "closed",
          reason: `因合并关闭账号：${reason}`,
          operator,
          approver: input.approver,
          at
        }, tx);
      }
      // 双方各记一条 merge 历史：只记被合并方会让保留方的时间线出现
      // 「凭空多出一批历史引用」而无从解释。
      await this.operations.appendStatusHistory(tenantId, {
        customerId: input.sourceCustomerId,
        scope: "account",
        action: "merge",
        fromStatus: "active",
        toStatus: "merged",
        reason: `合并进 ${input.targetCustomerId}：${reason}`,
        operator,
        approver: input.approver,
        at
      }, tx);
      await this.operations.appendStatusHistory(tenantId, {
        customerId: input.targetCustomerId,
        scope: "account",
        action: "merge",
        toStatus: "active",
        reason: `接收合并 ${input.sourceCustomerId}：${reason}`,
        operator,
        approver: input.approver,
        at
      }, tx);
    });

    // 合并属敏感动作，单独留一条访问审计（需求 4.8.14 要求合并进入审计日志）。
    await this.operations.recordSensitiveAccess(tenantId, {
      customerId: input.sourceCustomerId,
      field: "customer_merge",
      action: "reveal",
      revealed: true,
      operator,
      reason: `合并进 ${input.targetCustomerId}：${reason}`,
      at
    });

    return this.prisma.customerMergeMapping.findFirst({
      where: { tenantId, sourceCustomerId: input.sourceCustomerId }
    });
  }

  /**
   * 注销前置检查（需求 4.8.13）。
   *
   * `blockers` 只由**真实存在的事实**产生，非空即禁止注销。
   * `manualConfirmations` 是本分支尚无数据源的类别——退款、争议、追偿，以及已完成订单的
   * 押金/预授权退还状态（Rental Core 目前没有支付与退款流水表）。
   * 系统不能假装检查过：那正是需求禁止的「借注销规避欠款、追偿或风险限制」。
   * 因此显式列出，由调用方要求人工签字确认后才允许继续。
   *
   * `workspaceId` 传入时只检查该空间（注销空间会员关系）；不传则检查全租户（注销账号）。
   */
  async assertClosable(
    tenantId: string,
    customerId: string,
    workspaceId?: string,
    tx?: Prisma.TransactionClient
  ): Promise<CustomerClosability> {
    const db = this.db(tx);
    const profile = await this.customers.findById(tenantId, customerId, undefined, tx);
    if (!profile) throw new NotFoundException("客户不存在");
    const blockers: CustomerClosability["blockers"] = [];

    // 未完成订单：客户在**任一角色**上的在途订单都算。只查 customerId 会漏掉
    // 「他是别人订单的付款主体」这种同样有资金义务的情形。
    const roleFilter = {
      OR: [
        { customerId },
        { contractSubjectCustomerId: customerId },
        { payerSubjectCustomerId: customerId },
        { userSubjectCustomerId: customerId }
      ]
    };
    const scope = workspaceId ? { workspaceId } : {};
    const openOrders = await db.rentalOrder.count({
      where: { tenantId, ...scope, status: { in: OPEN_ORDER_STATUSES }, ...roleFilter }
    });
    if (openOrders > 0) {
      blockers.push({
        code: "open_orders",
        message: `存在 ${openOrders} 张未完成订单（含作为签约/付款/使用主体的订单），必须先处理完毕`,
        count: openOrders
      });
    }

    // 归属无法判定的存量保证金：金额到底是押金还是预授权都说不清，
    // 放它过去等于默认「不用退」。必须先人工厘清。
    const unverifiedDeposit = await db.rentalOrder.count({
      where: { tenantId, ...scope, legacyDepositUnverified: true, ...roleFilter }
    });
    if (unverifiedDeposit > 0) {
      blockers.push({
        code: "legacy_unverified_deposit",
        message: `存在 ${unverifiedDeposit} 张订单的保证金归属未厘清（押金/预授权无法判定），必须先确认后再注销`,
        count: unverifiedDeposit
      });
    }

    // 未关闭的风险记录：需求 4.8.13 明确不得借注销规避风险限制。
    if (await this.operations.hasOpenRisk(tenantId, customerId, workspaceId, tx)) {
      blockers.push({
        code: "open_risk",
        message: "存在未关闭的风险记录，必须先完成复核或关闭"
      });
    }

    // 企业授信仍生效：账期意味着可能存在未到期应收。撤销授信是独立动作，
    // 必须先做，否则注销会把一个仍有账期的企业留在系统外。
    const credit = await db.customerCorporateCredit.findFirst({
      where: { tenantId, customerId, status: "active" }
    });
    if (credit) {
      blockers.push({
        code: "active_corporate_credit",
        message: `企业授信仍处于生效状态（账期 ${credit.settlementTermDays} 天），必须先撤销授信`
      });
    }

    return {
      closable: blockers.length === 0,
      blockers,
      manualConfirmations: [
        { code: "refunds", message: "退款是否已全部完成——本系统当前没有退款流水表，需人工确认" },
        { code: "deposit_returned", message: "已完成订单的押金与预授权是否已退还/解冻——当前无退还状态字段，需人工确认" },
        { code: "disputes", message: "是否存在未结争议或追偿——本系统当前没有争议记录表，需人工确认" }
      ]
    };
  }
}
