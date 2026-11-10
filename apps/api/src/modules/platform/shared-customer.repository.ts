import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type CustomerAccount as PrismaCustomerAccount,
  type CustomerMembership as PrismaCustomerMembership,
  type CustomerMembershipReview as PrismaCustomerMembershipReview,
  type CustomerProfile as PrismaCustomerProfile
} from "@prisma/client";
import type {
  CustomerAccountStatus,
  CustomerMembershipStatus,
  CustomerMembership,
  SaveSharedCustomerRequest,
  SharedCustomerProfile
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { getRequestDataScope, getRequestUserId, getRequestWorkspaceId } from "../../common/request-identity";

export type SharedCustomerTx = Prisma.TransactionClient;

export interface CreateCustomerProfileInput {
  tenantId: string;
  customerType: "personal" | "corporate";
  name: string;
  phone: string;
  email?: string;
  /** 只接受调用方已脱敏的值；本层绝不落明文证件号。 */
  identityNoMasked?: string | null;
  /** 基础画像主数据（全部选填）。birthday 传 ISO 日期串 YYYY-MM-DD 或 null。 */
  gender?: string | null;
  birthday?: string | null;
  sourceChannel?: string | null;
  region?: string | null;
  qualifications?: Record<string, unknown>;
  corporateName?: string;
  corporateTaxNo?: string;
}

export type CustomerProfileUpdateData = Pick<
  Prisma.CustomerProfileUncheckedUpdateInput,
  "name" | "phone" | "phoneMasked" | "email" | "identityNoMasked" | "gender" | "birthday" | "sourceChannel" | "region" | "corporateName" | "corporateTaxNo"
>;

export type CustomerMembershipUpdateData = Pick<
  Prisma.CustomerMembershipUncheckedUpdateInput,
  "status" | "levelName" | "firstOrderAt" | "suspendedAt" | "restrictedAt" | "exitedAt" | "closedAt"
>;

export type CustomerAccountUpdateData = Pick<
  Prisma.CustomerAccountUncheckedUpdateInput,
  "status" | "suspendedAt" | "closedAt" | "lastReason" | "lastOperator" | "loginPhone" | "loginPhoneMasked" | "passwordHash" | "passwordUpdatedAt" | "mustChangePassword"
>;

export interface UpsertAccountCredentialsInput {
  tenantId: string;
  customerId: string;
  loginPhone: string;
  loginPhoneMasked: string;
  passwordHash: string;
  mustChangePassword: boolean;
  /** 已有账号时是否同时重绑登录号并激活（客户端自助注册）；后台临时密码只改口令。 */
  rebindLogin: boolean;
  lastReason?: { create: string; update: string };
  lastOperator?: string;
}

export interface CreateMembershipReviewInput {
  tenantId: string;
  customerId: string;
  reviewType: "registration" | "corporate_registration" | "qualification";
  channel: "admin" | "app";
  status?: "pending";
  sourceWorkspaceId?: string;
  qualificationType?: string;
  requestKey?: string | null;
  payload?: Prisma.InputJsonValue;
}

export type CustomerMembershipReviewUpdateData = Pick<
  Prisma.CustomerMembershipReviewUncheckedUpdateInput,
  "status" | "reason" | "reviewedBy" | "reviewedAt"
>;

/**
 * 主档与会员均按租户共享；订单、资金和营销等历史业务事实仍留在原空间。
 *
 * 写入口约束：`customerProfile / customerAccount / customerMembership / customerMembershipReview / customerCorporateProfile`
 * 四个模型的 create / update / upsert / delete 只允许出现在本文件，其余服务与仓储一律经由
 * 下面的写方法（都接受可选 `tx`）。`scripts/validate-customer-write-ownership.cjs` 静态把关。
 */
@Injectable()
export class SharedCustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: SharedCustomerTx) {
    return tx ?? this.prisma;
  }

  /** Enterprise lifecycle writers share the caller's lock/transaction, never duplicate identity. */
  async saveEnterpriseRelation(tenantId: string, corporateCustomerId: string, personalCustomerId: string,
    data: { role: string; status: string; department?: string | null; employeeNo?: string | null; effectiveFrom: Date; effectiveTo?: Date | null; reason: string; createdBy: string }, tx: SharedCustomerTx) {
    const { createdBy: _createdBy, ...changes } = data;
    const where = { tenantId_corporateCustomerId_personalCustomerId: { tenantId, corporateCustomerId, personalCustomerId } };
    const previous = await tx.customerCorporateMembership.findUnique({ where, select: { updatedAt: true } });
    // The timestamp is an authority revision, not just a clock reading. A same-ms
    // edit or clock rollback must never match an earlier grant/policy/approval again.
    const updatedAt = new Date(Math.max(Date.now(), previous ? previous.updatedAt.getTime() + 1 : Date.now()));
    return tx.customerCorporateMembership.upsert({
      where,
      create: { tenantId, corporateCustomerId, personalCustomerId, ...data },
      update: { ...changes, updatedAt }
    });
  }

  /** Under Tenant → customer locks, invalidate migrated enterprise authority with the
   * original status/history transaction. Restoration never rebinds grants or policies;
   * relation identity/status and historical orders/receipts are left untouched. */
  async invalidatePersonalEnterpriseAuthority(tenantId: string, customerId: string, tx: SharedCustomerTx): Promise<number> {
    return tx.$executeRaw`
      UPDATE customer_corporate_memberships m
      JOIN customer_profiles p ON p.tenantId=m.tenantId AND p.id=m.personalCustomerId AND p.customerType='personal'
      SET m.updatedAt=GREATEST(NOW(3),TIMESTAMPADD(MICROSECOND,1000,m.updatedAt))
      WHERE m.tenantId=${tenantId} AND m.personalCustomerId=${customerId}
        AND (EXISTS (SELECT 1 FROM enterprise_corporate_portals portal WHERE portal.tenantId=m.tenantId AND portal.corporateCustomerId=m.corporateCustomerId)
          OR EXISTS (SELECT 1 FROM enterprise_scope_policies policy WHERE policy.tenantId=m.tenantId AND policy.corporateCustomerId=m.corporateCustomerId))`;
  }

  /** 4 位及以下不再原样返回：原样返回等于把整段值存进“脱敏”列。 */
  private mask(value: string) {
    const trimmed = value.trim();
    if (trimmed.length <= 4) return "****";
    return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
  }

  /** 主档与唯一会员均按租户共享，业务事实仍由业务仓储按空间查询。 */
  async listByTenant(
    tenantId: string,
    creatorScope?: { createdByUserId: string; createdInWorkspaceId: string },
    customerIds?: string[]
  ): Promise<SharedCustomerProfile[]> {
    const rows = await this.prisma.customerProfile.findMany({
      where: {
        tenantId,
        ...(customerIds ? { id: { in: customerIds.length ? customerIds : ["__no_visible_customer__"] } } : {}),
        ...(creatorScope ? {
          createdByUserId: creatorScope.createdByUserId,
          createdInWorkspaceId: creatorScope.createdInWorkspaceId
        } : {})
      },
      include: { membership: true },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findById(
    tenantId: string,
    customerId: string,
    tx?: SharedCustomerTx
  ): Promise<SharedCustomerProfile | undefined> {
    const row = await this.db(tx).customerProfile.findFirst({
      where: { id: customerId, tenantId },
      include: {
        membership: true,
        // CUSTOMER-01E：详情才带联系人与经办人；列表不带，避免 N+1 且列表并不展示它们。
        contacts: { where: { status: "active" }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        authorizedAgents: { orderBy: { validFrom: "desc" } },
        // CUSTOMER-01E：账号只取判断状态所需的四列。刻意不 select loginPhone——
        // 明文登录标识是凭据，管理端页面没有任何场景需要它。
        account: { select: { status: true, loginPhoneMasked: true, suspendedAt: true, closedAt: true } }
      }
    });
    return row ? this.toDomain(row) : undefined;
  }

  /** 按租户手机号复用同一主档与会员。 */
  async findByPhone(tenantId: string, phone: string): Promise<SharedCustomerProfile | undefined> {
    const row = await this.prisma.customerProfile.findFirst({
      where: { tenantId, phone: phone.trim() },
      include: { membership: true }
    });
    return row ? this.toDomain(row) : undefined;
  }

  /** 创建主档与唯一会员必须同事务，避免手机号已占用但会员缺失。 */
  async createWithMembership(
    tenantId: string,
    input: SaveSharedCustomerRequest,
    levelName: string
  ): Promise<SharedCustomerProfile> {
    const created = await this.prisma.$transaction(async (tx) => {
      const profile = await this.createProfile({
        tenantId,
        customerType: input.customerType,
        name: input.name,
        phone: input.phone,
        email: input.email,
        // 只存掩码，绝不落明文证件号。
        identityNoMasked: input.identityNo ? this.mask(input.identityNo) : null,
        qualifications: input.qualifications,
        corporateName: input.corporateName,
        corporateTaxNo: input.corporateTaxNo
      }, tx);
      await this.createMembership({ tenantId, customerId: profile.id, levelName }, tx);
      return profile.id;
    });
    const profile = await this.findById(tenantId, created);
    if (!profile) throw new Error("共享客户创建后读取失败");
    return profile;
  }

  // ---------------------------------------------------------------------------
  // 客户主档模型的唯一写入口。方法只做单模型写入，不含业务判断；
  // 流程级规则（注册、合并、状态机）留在各自的服务里。
  // ---------------------------------------------------------------------------

  async createProfile(input: CreateCustomerProfileInput, tx?: SharedCustomerTx): Promise<PrismaCustomerProfile> {
    const scopeIsOperator = getRequestDataScope() !== undefined;
    return this.db(tx).customerProfile.create({
      data: {
        tenantId: input.tenantId,
        customerType: input.customerType,
        name: input.name.trim(),
        phone: input.phone.trim(),
        phoneMasked: this.mask(input.phone),
        email: input.email?.trim() || null,
        // 实名只能由独立核验记录驱动，普通建档/编辑请求不能自行置真。
        identityVerified: false,
        identityNoMasked: input.identityNoMasked ?? null,
        gender: input.gender ?? null,
        // birthday 以 @db.Date 存储；只取日期部分，避免时区把日期挪到相邻一天。
        birthday: input.birthday ? new Date(`${input.birthday}T00:00:00.000Z`) : null,
        sourceChannel: input.sourceChannel ?? null,
        region: input.region ?? null,
        qualifications: (input.qualifications ?? {}) as Prisma.InputJsonValue,
        corporateName: input.corporateName?.trim() || null,
        corporateTaxNo: input.corporateTaxNo?.trim() || null,
        // Creator attribution is a security boundary for `own`/`store` visibility.
        // Never accept it from a DTO or an internal caller's input object.
        createdByUserId: scopeIsOperator ? getRequestUserId() ?? null : null,
        createdInWorkspaceId: scopeIsOperator ? getRequestWorkspaceId() ?? null : null
      }
    });
  }

  /** 主档不存在（或不属于该租户）时返回 undefined，由调用方决定 404 还是断言。 */
  async updateProfile(
    tenantId: string,
    customerId: string,
    data: CustomerProfileUpdateData,
    tx?: SharedCustomerTx
  ): Promise<PrismaCustomerProfile | undefined> {
    try {
      return await this.db(tx).customerProfile.update({ where: { id: customerId, tenantId }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return undefined;
      throw error;
    }
  }

  /** 实名核验事实更新入口；只能由核验服务在审核记录同一事务内调用。 */
  async setIdentityVerificationState(tenantId: string, customerId: string, identityVerified: boolean, tx?: SharedCustomerTx) {
    return this.db(tx).customerProfile.updateMany({ where: { tenantId, id: customerId }, data: { identityVerified } });
  }

  async upsertCorporateProfile(input: {
    tenantId: string;
    customerId: string;
    legalName: string;
    unifiedSocialCreditCode: string;
    unifiedSocialCreditCodeMasked: string;
    registeredAddress?: string | null;
    legalRepName?: string | null;
    legalRepPhoneMasked?: string | null;
    industry?: string | null;
    scale?: string | null;
    status: string;
  }, tx?: SharedCustomerTx) {
    const data = {
      legalName: input.legalName,
      unifiedSocialCreditCode: input.unifiedSocialCreditCode,
      unifiedSocialCreditCodeMasked: input.unifiedSocialCreditCodeMasked,
      registeredAddress: input.registeredAddress ?? null,
      legalRepName: input.legalRepName ?? null,
      legalRepPhoneMasked: input.legalRepPhoneMasked ?? null,
      industry: input.industry ?? null,
      scale: input.scale ?? null,
      status: input.status
    };
    return this.db(tx).customerCorporateProfile.upsert({
      where: { tenantId_customerId: { tenantId: input.tenantId, customerId: input.customerId } },
      create: { tenantId: input.tenantId, customerId: input.customerId, ...data },
      update: data
    });
  }

  async updateCorporateProfileStatus(tenantId: string, customerId: string, status: string, tx?: SharedCustomerTx) {
    return this.db(tx).customerCorporateProfile.updateMany({ where: { tenantId, customerId }, data: { status } });
  }

  /**
   * 标记被合并方。以「尚未被合并」为写入条件：并发两路合并同一主档时，后到者更新 0 行，
   * 由调用方转为可解释的 409，而不是双双写出映射。
   */
  async markMerged(tenantId: string, sourceCustomerId: string, targetCustomerId: string, tx?: SharedCustomerTx): Promise<number> {
    const marked = await this.db(tx).customerProfile.updateMany({
      where: { tenantId, id: sourceCustomerId, mergedIntoCustomerId: null },
      data: { mergedIntoCustomerId: targetCustomerId, status: "merged" }
    });
    return marked.count;
  }

  async createMembership(
    input: { tenantId: string; customerId: string; levelName?: string; status?: CustomerMembershipStatus },
    tx?: SharedCustomerTx
  ): Promise<PrismaCustomerMembership> {
    return this.db(tx).customerMembership.create({
      data: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        ...(input.levelName === undefined ? {} : { levelName: input.levelName }),
        ...(input.status === undefined ? {} : { status: input.status })
      }
    });
  }

  /** 带 `expectedStatus` 时是乐观并发写：状态已被别人改过则更新 0 行。返回更新行数。 */
  async updateMembership(
    tenantId: string,
    membershipId: string,
    data: CustomerMembershipUpdateData,
    expectedStatus?: CustomerMembershipStatus,
    tx?: SharedCustomerTx
  ): Promise<number> {
    const updated = await this.db(tx).customerMembership.updateMany({
      where: { tenantId, id: membershipId, ...(expectedStatus === undefined ? {} : { status: expectedStatus }) },
      data
    });
    return updated.count;
  }

  async createAccount(
    input: { tenantId: string; customerId: string; loginPhone: string; loginPhoneMasked: string; lastOperator?: string | null },
    tx?: SharedCustomerTx
  ): Promise<PrismaCustomerAccount> {
    return this.db(tx).customerAccount.create({
      data: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        loginPhone: input.loginPhone.trim(),
        loginPhoneMasked: input.loginPhoneMasked,
        status: "active",
        lastOperator: input.lastOperator ?? null
      }
    });
  }

  /** 同 `updateMembership`；账号可按账号 id 或客户 id 定位。 */
  async updateAccount(
    tenantId: string,
    target: { accountId: string } | { customerId: string },
    data: CustomerAccountUpdateData,
    expectedStatus?: CustomerAccountStatus,
    tx?: SharedCustomerTx
  ): Promise<number> {
    const updated = await this.db(tx).customerAccount.updateMany({
      where: {
        tenantId,
        ...("accountId" in target ? { id: target.accountId } : { customerId: target.customerId }),
        ...(expectedStatus === undefined ? {} : { status: expectedStatus })
      },
      data
    });
    return updated.count;
  }

  /**
   * 设置或重置登录口令。既有账号只改口令相关列（不解除暂停、不改登录号），
   * 除非调用方明确要求 `rebindLogin`（客户端自助注册会把登录号绑回当前手机号并激活）。
   */
  async upsertAccountCredentials(input: UpsertAccountCredentialsInput, tx?: SharedCustomerTx): Promise<PrismaCustomerAccount> {
    const now = new Date();
    const operator = input.lastOperator === undefined ? {} : { lastOperator: input.lastOperator };
    return this.db(tx).customerAccount.upsert({
      where: { tenantId_customerId: { tenantId: input.tenantId, customerId: input.customerId } },
      create: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        loginPhone: input.loginPhone,
        loginPhoneMasked: input.loginPhoneMasked,
        status: "active",
        passwordHash: input.passwordHash,
        passwordUpdatedAt: now,
        mustChangePassword: input.mustChangePassword,
        ...(input.lastReason ? { lastReason: input.lastReason.create } : {}),
        ...operator
      },
      update: {
        passwordHash: input.passwordHash,
        passwordUpdatedAt: now,
        mustChangePassword: input.mustChangePassword,
        ...(input.rebindLogin ? { loginPhone: input.loginPhone, loginPhoneMasked: input.loginPhoneMasked, status: "active" } : {}),
        ...(input.lastReason ? { lastReason: input.lastReason.update } : {}),
        ...operator
      }
    });
  }

  /**
   * MP-02A：微信手机号登录为客户开通**无口令**登录账号。已有账号原样返回（不改口令、不改登录号、
   * 不解除暂停）；口令为空的账号只能通过微信/短信证明登录，密码登录会被拒绝。
   */
  async ensureLoginAccount(
    input: { tenantId: string; customerId: string; loginPhone: string; loginPhoneMasked: string; lastReason: string; lastOperator: string },
    tx?: SharedCustomerTx
  ): Promise<PrismaCustomerAccount> {
    return this.db(tx).customerAccount.upsert({
      where: { tenantId_customerId: { tenantId: input.tenantId, customerId: input.customerId } },
      create: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        loginPhone: input.loginPhone,
        loginPhoneMasked: input.loginPhoneMasked,
        status: "active",
        passwordHash: null,
        mustChangePassword: false,
        lastReason: input.lastReason,
        lastOperator: input.lastOperator
      },
      update: {}
    });
  }

  async createReview(input: CreateMembershipReviewInput, tx?: SharedCustomerTx): Promise<PrismaCustomerMembershipReview> {
    return this.db(tx).customerMembershipReview.create({
      data: {
        tenantId: input.tenantId,
        customerId: input.customerId,
        reviewType: input.reviewType,
        channel: input.channel,
        status: input.status ?? "pending",
        sourceWorkspaceId: input.sourceWorkspaceId ?? null,
        qualificationType: input.qualificationType ?? null,
        requestKey: input.requestKey ?? null,
        ...(input.payload === undefined ? {} : { payload: input.payload })
      }
    });
  }

  async updateReview(
    tenantId: string,
    reviewId: string,
    data: CustomerMembershipReviewUpdateData,
    tx?: SharedCustomerTx
  ): Promise<PrismaCustomerMembershipReview> {
    return this.db(tx).customerMembershipReview.update({ where: { id: reviewId, tenantId }, data });
  }

  /** 幂等创建租户会员；既有状态与等级绝不因切换空间或重试而恢复。 */
  async ensureMembership(
    tenantId: string,
    customerId: string,
    levelName: string
  ): Promise<CustomerMembership> {
    try {
      const row = await this.prisma.customerMembership.upsert({
        where: { tenantId_customerId: { tenantId, customerId } },
        create: { tenantId, customerId, levelName },
        update: {}
      });
      return this.toMembership(row);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const winner = await this.findMembership(tenantId, customerId);
      if (!winner) throw error;
      return winner;
    }
  }

  async listMembershipsByTenant(tenantId: string): Promise<CustomerMembership[]> {
    const rows = await this.prisma.customerMembership.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => this.toMembership(row));
  }

  async findMembership(
    tenantId: string,
    customerId: string,
    tx?: SharedCustomerTx
  ): Promise<CustomerMembership | undefined> {
    const row = await this.db(tx).customerMembership.findUnique({
      where: { tenantId_customerId: { tenantId, customerId } }
    });
    return row ? this.toMembership(row) : undefined;
  }

  /**
   * 新业务门禁只取四个最小事实，避免订单高频路径加载联系人、经办人等详情数据。
   * `tx` 存在时必须与调用方取得的客户行锁使用同一连接，才能读到锁后的权威状态。
   */
  async findBusinessGate(tenantId: string, _workspaceId: string, customerId: string, tx?: SharedCustomerTx) {
    const row = await this.db(tx).customerProfile.findFirst({
      where: { tenantId, id: customerId },
      select: {
        mergedIntoCustomerId: true,
        account: { select: { status: true } },
        membership: { select: { status: true } }
      }
    });
    return row
      ? {
          mergedIntoCustomerId: row.mergedIntoCustomerId,
          account: row.account ? { status: row.account.status as CustomerAccountStatus } : null,
          membership: row.membership ? { status: row.membership.status as CustomerMembershipStatus } : null
        }
      : null;
  }

  private toDomain(row: {
    id: string;
    tenantId: string;
    customerType: string;
    name: string;
    phone: string;
    phoneMasked: string;
    email: string | null;
    identityVerified: boolean;
    identityNoMasked: string | null;
    gender: string | null;
    birthday: Date | null;
    sourceChannel: string | null;
    region: string | null;
    qualifications: Prisma.JsonValue;
    corporateName: string | null;
    corporateTaxNo: string | null;
    status: string;
    sourceMemberId: string | null;
    mergedIntoCustomerId: string | null;
    createdAt: Date;
    updatedAt: Date;
    membership?: Parameters<SharedCustomerRepository["toMembership"]>[0] | null;
    contacts?: Array<{
      id: string; kind: string; name: string; phoneMasked: string;
      relation: string | null; isPrimary: boolean; status: string; linkedCustomerId: string | null;
    }>;
    authorizedAgents?: Array<{
      id: string; agentName: string; agentPhoneMasked: string; authorityScope: Prisma.JsonValue;
      validFrom: Date; validTo: Date | null; status: string;
    }>;
    // 三态刻意用「键缺失 / null / 有值」区分：缺失=列表没查账号，
    // null=查了但没开通，有值=已开通。少了中间那态，页面就分不出「未开通」与「已停用」。
    account?: {
      status: string; loginPhoneMasked: string; suspendedAt: Date | null; closedAt: Date | null;
    } | null;
  }): SharedCustomerProfile {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerType: row.customerType as SharedCustomerProfile["customerType"],
      name: row.name,
      phone: row.phone,
      phoneMasked: row.phoneMasked,
      email: row.email ?? undefined,
      identityVerified: row.identityVerified,
      identityNoMasked: row.identityNoMasked ?? undefined,
      gender: row.gender ?? undefined,
      // @db.Date 读回后只保留 YYYY-MM-DD，API 层统一用 ISO 日期串。
      birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : undefined,
      sourceChannel: row.sourceChannel ?? undefined,
      region: row.region ?? undefined,
      qualifications: (row.qualifications ?? {}) as Record<string, unknown>,
      corporateName: row.corporateName ?? undefined,
      corporateTaxNo: row.corporateTaxNo ?? undefined,
      status: row.status as SharedCustomerProfile["status"],
      sourceMemberId: row.sourceMemberId ?? undefined,
      // CUSTOMER-01A/B：必须带出来。少了它，`assertTransactable` 永远读到 undefined，
      // 已被合并的主档会继续通过下单判定——实测踩过，由 01B 专项用例抓到。
      mergedIntoCustomerId: row.mergedIntoCustomerId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      membership: row.membership ? this.toMembership(row.membership) : undefined,
      // CUSTOMER-01E：仅详情查询带这两个关联；列表不带，故为 undefined。
      // 号码一律只给脱敏值——明文由服务层按解密权限单独决定并留访问审计。
      contacts: row.contacts?.map((contact) => ({
        id: contact.id,
        kind: contact.kind as "emergency" | "corporate" | "other",
        name: contact.name,
        phoneMasked: contact.phoneMasked,
        relation: contact.relation ?? undefined,
        isPrimary: contact.isPrimary,
        status: contact.status,
        linkedCustomerId: contact.linkedCustomerId ?? undefined
      })),
      authorizedAgents: row.authorizedAgents?.map((agent) => ({
        id: agent.id,
        agentName: agent.agentName,
        agentPhoneMasked: agent.agentPhoneMasked,
        authorityScope: (agent.authorityScope ?? {}) as Record<string, unknown>,
        validFrom: agent.validFrom.toISOString(),
        validTo: agent.validTo?.toISOString(),
        status: agent.status
      })),
      accountSummary:
        row.account === undefined
          ? undefined
          : row.account === null
            ? { provisioned: false }
            : {
                provisioned: true,
                status: row.account.status as CustomerAccountStatus,
                loginPhoneMasked: row.account.loginPhoneMasked,
                suspendedAt: row.account.suspendedAt?.toISOString(),
                closedAt: row.account.closedAt?.toISOString()
              }
    };
  }

  private toMembership(row: {
    id: string;
    tenantId: string;
    customerId: string;
    levelName: string;
    status: string;
    firstOrderAt: Date | null;
    suspendedAt: Date | null;
    restrictedAt: Date | null;
    exitedAt: Date | null;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerMembership {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      levelName: row.levelName,
      status: row.status as CustomerMembership["status"],
      firstOrderAt: row.firstOrderAt?.toISOString(),
      suspendedAt: row.suspendedAt?.toISOString(),
      restrictedAt: row.restrictedAt?.toISOString(),
      exitedAt: row.exitedAt?.toISOString(),
      closedAt: row.closedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
