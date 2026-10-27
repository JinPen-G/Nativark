import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CustomerCorporateContract,
  CustomerCorporateCredit,
  CustomerCorporateInvoiceProfile,
  CustomerOrderSubjectInput,
  CustomerOrderSubjectSnapshot,
  CustomerOrderSubjects,
  SaveCustomerContractRequest,
  SaveCustomerCreditRequest,
  SaveCustomerInvoiceProfileRequest
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "./shared-customer.repository";

const mask = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 4) return "****";
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
};

/**
 * CUSTOMER-01C：企业资料（开票、合同、授信账期）与订单主体解析。
 *
 * 两条边界必须守住：
 *   1. **不碰定价链与订单状态机**。本服务只解析并校验主体、返回可固化的快照；
 *      订单侧拿到结果后原样存入既有列，金额计算与状态流转完全不变。
 *      授信主档调整与原占用共用行锁，核对敞口但不代写账务流水。
 *   2. **主体一律限定在同一租户内**。四个角色的客户 id 都必须属于当前租户，
 *      经办人也必须是签约主体自己的授权人——否则可以把别人的经办人挂到自己的订单上。
 */
@Injectable()
export class CustomerCorporateService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SharedCustomerRepository) private readonly customers: SharedCustomerRepository
  ) {}

  private async requireCorporate(tenantId: string, customerId: string) {
    const profile = await this.customers.findById(tenantId, customerId);
    if (!profile) throw new NotFoundException("客户不存在");
    if (profile.customerType !== "corporate") {
      throw new ConflictException("开票资料、合同与授信只适用于企业客户");
    }
    return profile;
  }

  // ---------- 开票资料 ----------

  async listInvoiceProfiles(tenantId: string, customerId: string): Promise<CustomerCorporateInvoiceProfile[]> {
    // 读路径同样先校验客户归属与类型。
    //
    // 只靠 `where: { tenantId, customerId }` 数据上不会泄露（查询已按租户收口），
    // 但一个来自别的租户或拼错的 customerId 会得到**空列表**而不是错误——
    // 调用方（尤其是管理端）无法区分「这家企业确实没有开票资料」与
    // 「我查的这个 id 根本不属于本租户」。写路径已经走 requireCorporate，
    // 读路径不走就成了两套口径。
    await this.requireCorporate(tenantId, customerId);
    const rows = await this.prisma.customerCorporateInvoiceProfile.findMany({
      where: { tenantId, customerId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => this.toInvoice(row));
  }

  /**
   * 保存开票资料。设为默认时在**同一事务**里把该企业其他行降级——
   * 分两步会出现「两份默认」或「一份都不默认」的中间态，而唯一键会让第二步直接失败。
   */
  async saveInvoiceProfile(
    tenantId: string,
    customerId: string,
    input: SaveCustomerInvoiceProfileRequest
  ): Promise<CustomerCorporateInvoiceProfile> {
    await this.requireCorporate(tenantId, customerId);
    if (!input.title?.trim()) throw new BadRequestException("开票名称不能为空");
    if (!input.taxNo?.trim()) throw new BadRequestException("开票税号不能为空");
    const wantDefault = input.isDefault ?? false;
    const id = input.id;
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = id
        ? await tx.customerCorporateInvoiceProfile.findFirst({ where: { tenantId, customerId, id } })
        : undefined;
      if (id && !existing) throw new NotFoundException("开票资料不存在");
      if (existing && !input.expectedRevision) {
        throw new BadRequestException("编辑开票资料必须携带读取时的版本号");
      }
      if (input.clearBankAccount && input.bankAccount?.trim()) {
        throw new BadRequestException("银行账号不能同时填写新值并选择清除");
      }
      if (input.clearContactPhone && input.contactPhone?.trim()) {
        throw new BadRequestException("联系电话不能同时填写新值并选择清除");
      }
      if (wantDefault) {
        // 先把现有默认降级；defaultMarker 写回自身 id 以恢复唯一性。
        const currentDefaults = await tx.customerCorporateInvoiceProfile.findMany({
          where: { tenantId, customerId, isDefault: true },
          select: { id: true }
        });
        for (const row of currentDefaults) {
          if (row.id === id) continue;
          await tx.customerCorporateInvoiceProfile.update({
            where: { id: row.id },
            data: { isDefault: false, defaultMarker: row.id, revision: { increment: 1 } }
          });
        }
      }
      const data = {
        invoiceType: input.invoiceType,
        title: input.title.trim(),
        taxNo: input.taxNo.trim(),
        registeredAddress: input.registeredAddress?.trim() || null,
        bankName: input.bankName?.trim() || null,
        // 银行账号只存脱敏值：它是资金信息，明文不该留在业务库里。
        bankAccountMasked: input.clearBankAccount
          ? null
          : mask(input.bankAccount) ?? existing?.bankAccountMasked ?? null,
        contactPhoneMasked: input.clearContactPhone
          ? null
          : mask(input.contactPhone) ?? existing?.contactPhoneMasked ?? null,
        receiveEmail: input.receiveEmail?.trim() || null,
        isDefault: wantDefault,
        status: input.status ?? "active"
      };
      if (id) {
        const changed = await tx.customerCorporateInvoiceProfile.updateMany({
          where: { id, revision: input.expectedRevision },
          data: { ...data, defaultMarker: wantDefault ? "default" : id, revision: { increment: 1 } }
        });
        if (changed.count === 0) {
          throw new ConflictException("开票资料已被其他人修改，请刷新后重试");
        }
        return tx.customerCorporateInvoiceProfile.findUniqueOrThrow({ where: { id } });
      }
      const newId = `cinv_${randomId()}`;
      return tx.customerCorporateInvoiceProfile.create({
        data: {
          id: newId,
          tenantId,
          customerId,
          ...data,
          defaultMarker: wantDefault ? "default" : newId
        }
      });
    }).catch((error: unknown) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        throw new ConflictException("开票资料已被其他人修改，请刷新后重试");
      }
      throw error;
    });
    return this.toInvoice(saved);
  }

  // ---------- 合同 ----------

  async listContracts(tenantId: string, customerId: string): Promise<CustomerCorporateContract[]> {
    // 同 listInvoiceProfiles：读路径也要校验归属与类型，避免空列表掩盖错误 id。
    await this.requireCorporate(tenantId, customerId);
    const rows = await this.prisma.customerCorporateContract.findMany({
      where: { tenantId, customerId },
      orderBy: [{ effectiveFrom: "desc" }]
    });
    return rows.map((row) => this.toContract(row));
  }

  async saveContract(
    tenantId: string,
    customerId: string,
    input: SaveCustomerContractRequest
  ): Promise<CustomerCorporateContract> {
    await this.requireCorporate(tenantId, customerId);
    if (!input.contractNo?.trim()) throw new BadRequestException("合同编号不能为空");
    if (!input.name?.trim()) throw new BadRequestException("合同名称不能为空");
    if (!input.effectiveFrom) throw new BadRequestException("合同生效时间不能为空");
    if (input.effectiveTo && new Date(input.effectiveTo) <= new Date(input.effectiveFrom)) {
      throw new BadRequestException("合同失效时间必须晚于生效时间");
    }
    if (input.status === "terminated" && !input.terminatedReason?.trim()) {
      throw new BadRequestException("终止合同必须填写原因");
    }
    const data = {
      contractNo: input.contractNo.trim(),
      name: input.name.trim(),
      signedAt: input.signedAt ? new Date(input.signedAt) : null,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      status: input.status ?? "draft",
      fileRef: input.fileRef?.trim() || null,
      terminatedReason: input.terminatedReason?.trim() || null
    };
    try {
      if (input.id) {
        const existing = await this.prisma.customerCorporateContract.findFirst({
          where: { tenantId, customerId, id: input.id }
        });
        if (!existing) throw new NotFoundException("合同不存在");
        if (!input.expectedRevision) throw new BadRequestException("编辑合同必须携带读取时的版本号");
        const changed = await this.prisma.customerCorporateContract.updateMany({
          where: { id: input.id, revision: input.expectedRevision },
          data: { ...data, revision: { increment: 1 } }
        });
        if (changed.count === 0) throw new ConflictException("合同已被其他人修改，请刷新后重试");
        return this.toContract(
          await this.prisma.customerCorporateContract.findUniqueOrThrow({ where: { id: input.id } })
        );
      }
      return this.toContract(
        await this.prisma.customerCorporateContract.create({ data: { tenantId, customerId, ...data } })
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("该合同编号在本租户已存在");
      }
      throw error;
    }
  }

  // ---------- 授信与账期 ----------

  async getCredit(tenantId: string, customerId: string): Promise<CustomerCorporateCredit | undefined> {
    // 同上。返回 undefined 表示「这家企业尚未授信」，而不是「这个 id 有问题」。
    await this.requireCorporate(tenantId, customerId);
    const row = await this.prisma.customerCorporateCredit.findFirst({ where: { tenantId, customerId } });
    return row ? this.toCredit(row) : undefined;
  }

  /**
   * 保存授信与账期主档。订单占用、结算和回款不在这里改金额，统一由
   * CustomerCorporateSettlementService 追加账务流水；这样资料维护不会绕过账务链。
   */
  async saveCredit(
    tenantId: string,
    customerId: string,
    input: SaveCustomerCreditRequest,
    operator?: string
  ): Promise<CustomerCorporateCredit> {
    await this.requireCorporate(tenantId, customerId);
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("调整授信与账期必须填写变更原因");
    if (!Number.isFinite(input.creditLimit) || input.creditLimit < 0) {
      throw new BadRequestException("授信额度必须是非负数值");
    }
    if (!Number.isInteger(input.settlementTermDays) || input.settlementTermDays < 0) {
      throw new BadRequestException("账期天数必须是非负整数");
    }
    const data = {
      creditLimit: new Prisma.Decimal(input.creditLimit),
      settlementTermDays: input.settlementTermDays,
      billingCycle: input.billingCycle ?? "monthly",
      status: input.status ?? "active",
      reason,
      approvedBy: operator ?? null,
      approvedAt: new Date()
    };
    const row = await this.prisma.$transaction(async tx => {
      // 与新增占用共用主档行锁；ReadCommitted确保等到锁后重新汇总最新流水，
      // 不能用事务外敞口或编辑revision代替资金并发控制。
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM customer_corporate_credits WHERE tenantId = ${tenantId} AND customerId = ${customerId} FOR UPDATE
      `);
      const existing = await tx.customerCorporateCredit.findFirst({ where: { tenantId, customerId } });
      const ledger = await tx.customerCorporateCreditLedger.aggregate({
        where: { tenantId, customerId }, _sum: { reservedDelta: true, receivableDelta: true }
      });
      const exposure = new Prisma.Decimal(ledger._sum.reservedDelta ?? 0).plus(ledger._sum.receivableDelta ?? 0);
      if (data.creditLimit.plus("0.005").lt(exposure)) {
        throw new ConflictException("新的授信额度不能低于当前已占用与应收合计，请先处理存量账务");
      }
      if (existing) {
        if (!input.expectedRevision) throw new BadRequestException("调整已有授信必须携带读取时的版本号");
        const changed = await tx.customerCorporateCredit.updateMany({
          where: { id: existing.id, tenantId, customerId, revision: input.expectedRevision },
          data: { ...data, revision: { increment: 1 } }
        });
        if (changed.count === 0) throw new ConflictException("授信与账期已被其他人修改，请刷新后重试");
        return tx.customerCorporateCredit.findUniqueOrThrow({ where: { id: existing.id } });
      }
      try { return await tx.customerCorporateCredit.create({ data: { tenantId, customerId, ...data } }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictException("授信记录已由其他人创建，请刷新后重试");
        }
        throw error;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.toCredit(row);
  }

  // ---------- 订单主体解析 ----------

  /**
   * 校验并解析订单四类主体，返回可由订单侧原样固化的结果。
   *
   * 省略任一角色时回落为下单客户本人——这保证既有下单路径行为不变（存量订单也是这个语义），
   * 同时让企业订单可以显式区分「总部付款、分公司签约、司机使用、行政经办」。
   *
   * 校验点（任一不满足即拒绝，不做「尽力而为」的降级）：
   *   * 三个主体客户都必须属于当前租户且未被合并——已合并主档不能再作为责任主体；
   *   * 经办人必须是**签约主体自己**的授权人，且在下单时点处于有效期内；
   *   * 指定合同必须属于签约主体且在下单时点生效；
   *   * 指定开票资料必须属于付款主体（谁付款谁开票）。
   */
  async resolveOrderSubjects(
    tenantId: string,
    orderCustomerId: string,
    at: string,
    input: CustomerOrderSubjectInput = {}
  ): Promise<CustomerOrderSubjects> {
    const contractId = input.contractSubjectCustomerId ?? orderCustomerId;
    const payerId = input.payerSubjectCustomerId ?? orderCustomerId;
    const userId = input.userSubjectCustomerId ?? orderCustomerId;
    const when = new Date(at);

    const profiles = new Map<string, Awaited<ReturnType<SharedCustomerRepository["findById"]>>>();
    for (const id of new Set([contractId, payerId, userId])) {
      const profile = await this.customers.findById(tenantId, id);
      // 不区分「不存在」与「属于别的租户」：后者会变成探测他租户客户的信道。
      if (!profile) throw new BadRequestException(`订单主体客户不存在：${id}`);
      if (profile.mergedIntoCustomerId) {
        throw new ConflictException(`客户 ${profile.name} 的主档已被合并，不能作为订单主体`);
      }
      profiles.set(id, profile);
    }

    const snapshot: CustomerOrderSubjectSnapshot[] = [];
    const contractProfile = profiles.get(contractId)!;
    const payerProfile = profiles.get(payerId)!;
    const userProfile = profiles.get(userId)!;

    // 指定合同：必须属于签约主体，且在下单时点生效。
    let contractRow: { id: string; contractNo: string } | undefined;
    if (input.contractId) {
      const row = await this.prisma.customerCorporateContract.findFirst({
        where: { tenantId, customerId: contractId, id: input.contractId }
      });
      if (!row) throw new BadRequestException("指定的企业合同不属于签约主体");
      if (row.status !== "active") throw new ConflictException("指定的企业合同当前不是生效状态");
      if (row.effectiveFrom > when || (row.effectiveTo && row.effectiveTo < when)) {
        throw new ConflictException("指定的企业合同在下单时点不在有效期内");
      }
      contractRow = { id: row.id, contractNo: row.contractNo };
    }

    // 指定开票资料：必须属于付款主体——谁付款谁开票，挂到签约主体上会开错票。
    let invoiceRow: { id: string } | undefined;
    if (input.invoiceProfileId) {
      const row = await this.prisma.customerCorporateInvoiceProfile.findFirst({
        where: { tenantId, customerId: payerId, id: input.invoiceProfileId }
      });
      if (!row) throw new BadRequestException("指定的开票资料不属于付款主体");
      if (row.status !== "active") throw new ConflictException("指定的开票资料已停用");
      invoiceRow = { id: row.id };
    }

    snapshot.push({
      role: "contract",
      customerId: contractId,
      customerType: contractProfile.customerType,
      name: contractProfile.name,
      phoneMasked: contractProfile.phoneMasked,
      corporateName: contractProfile.corporateName,
      contractId: contractRow?.id,
      contractNo: contractRow?.contractNo
    });
    snapshot.push({
      role: "payer",
      customerId: payerId,
      customerType: payerProfile.customerType,
      name: payerProfile.name,
      phoneMasked: payerProfile.phoneMasked,
      corporateName: payerProfile.corporateName,
      invoiceProfileId: invoiceRow?.id
    });
    snapshot.push({
      role: "user",
      customerId: userId,
      customerType: userProfile.customerType,
      name: userProfile.name,
      phoneMasked: userProfile.phoneMasked
    });

    // 经办人：必须是签约主体自己的授权人，且在下单时点有效。
    if (input.agentId) {
      const agent = await this.prisma.customerAuthorizedAgent.findFirst({
        where: { tenantId, id: input.agentId }
      });
      if (!agent) throw new BadRequestException("经办人不存在");
      if (agent.customerId !== contractId) {
        throw new BadRequestException("经办人必须由签约主体授权，不能使用其他客户的经办人");
      }
      if (agent.status !== "active") throw new ConflictException("该经办人授权已停用");
      if (agent.validFrom > when || (agent.validTo && agent.validTo < when)) {
        throw new ConflictException("该经办人授权在下单时点不在有效期内");
      }
      snapshot.push({
        role: "agent",
        agentId: agent.id,
        name: agent.agentName,
        phoneMasked: agent.agentPhoneMasked,
        authorityScope: (agent.authorityScope ?? {}) as Record<string, boolean>,
        authorityValidFrom: agent.validFrom.toISOString(),
        authorityValidTo: agent.validTo?.toISOString()
      });
    }

    return {
      contractSubjectCustomerId: contractId,
      payerSubjectCustomerId: payerId,
      userSubjectCustomerId: userId,
      agentId: input.agentId,
      snapshot
    };
  }

  private toInvoice(row: {
    id: string; tenantId: string; customerId: string; invoiceType: string; title: string; taxNo: string;
    registeredAddress: string | null; bankName: string | null; bankAccountMasked: string | null;
    contactPhoneMasked: string | null; receiveEmail: string | null; isDefault: boolean; status: string;
    revision: number; createdAt: Date; updatedAt: Date;
  }): CustomerCorporateInvoiceProfile {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      invoiceType: row.invoiceType as CustomerCorporateInvoiceProfile["invoiceType"],
      title: row.title,
      taxNo: row.taxNo,
      registeredAddress: row.registeredAddress ?? undefined,
      bankName: row.bankName ?? undefined,
      bankAccountMasked: row.bankAccountMasked ?? undefined,
      contactPhoneMasked: row.contactPhoneMasked ?? undefined,
      receiveEmail: row.receiveEmail ?? undefined,
      isDefault: row.isDefault,
      status: row.status as CustomerCorporateInvoiceProfile["status"],
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toContract(row: {
    id: string; tenantId: string; customerId: string; contractNo: string; name: string;
    signedAt: Date | null; effectiveFrom: Date; effectiveTo: Date | null; status: string;
    fileRef: string | null; terminatedReason: string | null; revision: number; createdAt: Date; updatedAt: Date;
  }): CustomerCorporateContract {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      contractNo: row.contractNo,
      name: row.name,
      signedAt: row.signedAt?.toISOString(),
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString(),
      status: row.status as CustomerCorporateContract["status"],
      fileRef: row.fileRef ?? undefined,
      terminatedReason: row.terminatedReason ?? undefined,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toCredit(row: {
    id: string; tenantId: string; customerId: string; creditLimit: Prisma.Decimal;
    settlementTermDays: number; billingCycle: string; status: string; approvedBy: string | null;
    approvedAt: Date | null; reason: string | null; revision: number; createdAt: Date; updatedAt: Date;
  }): CustomerCorporateCredit {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      creditLimit: Number(row.creditLimit),
      settlementTermDays: row.settlementTermDays,
      billingCycle: row.billingCycle as CustomerCorporateCredit["billingCycle"],
      status: row.status as CustomerCorporateCredit["status"],
      approvedBy: row.approvedBy ?? undefined,
      approvedAt: row.approvedAt?.toISOString(),
      reason: row.reason ?? undefined,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}

/** 简短随机 id。与仓储里的 uuid 默认值并存无碍，只是让 defaultMarker 可预知。 */
function randomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
