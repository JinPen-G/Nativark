import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, type CustomerMembershipReview as PrismaMembershipReview } from "@prisma/client";
import type {
  AssignCustomerMembershipPlanRequest,
  BookingMemberOption,
  CorporateMembershipMember,
  CustomerCorporateMembership,
  CustomerCorporateProfileSummary,
  CustomerMembershipBenefit,
  CustomerMembershipPlan,
  CustomerMembershipPlanAssignment,
  CustomerMembershipPlanVersion,
  CustomerMembershipQualificationType,
  CustomerMembershipRegistrationSettings,
  CustomerMembershipReview,
  CustomerMembershipBookingOption,
  CustomerQualificationRef,
  CustomerQualificationRevision,
  CustomerQualificationStatus,
  PersonalMembershipMember,
  RegisterPersonalMembershipRequest,
  ReviewCustomerMembershipRequest,
  SaveCustomerCorporateMembershipRequest,
  SaveCustomerMembershipPlanRequest,
  SaveCustomerMembershipQualificationTypeRequest,
  SaveCorporateMembershipRequest,
  SavePersonalMembershipRequest,
  SubmitCustomerQualificationRequest,
  RentalBookingIdentityInput,
  RentalMembershipSnapshot,
  RentalRuleConfig
} from "@rental-os/shared";
import { isRentalCategoryCode } from "@rental-os/shared";
import { assertPublishedRentalCategoryIdentities, rentalCategoryIdentityOptions, readRentalCategoryCode } from "../rental-core/category-identity";
import { customerRegistrationTransaction } from "./customer-registration.transaction";
import { CustomerRegistrationService } from "./customer-registration.service";
import { PrismaService } from "../database/prisma.service";
import { hashPassword } from "../../common/password";
import { CustomerOperationsRepository } from "./customer-operations.repository";
import { SharedCustomerRepository, type CustomerProfileUpdateData } from "./shared-customer.repository";
import { evaluateRentalQualification, type RentalQualificationAction, type RentalQualificationCheckWindow } from "../rental-core/rental-qualification";
import { getRequestDataScope, getRequestIdentity, getRequestLocationIds, getRequestUserId, getRequestWorkspaceId } from "../../common/request-identity";
import { lockActiveCategoryBinding } from "../rental-core/category-active-write";

const mask = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 4) return "****";
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
};

const dateOrUndefined = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("日期格式无效");
  return date;
};

const evidenceRefOrUndefined = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  // 这里只接受文件服务返回的不可变引用，不把本地路径或可直接访问的 URL 当作证据。
  if (/[\\/]/u.test(trimmed) || /^(?:https?|file):/iu.test(trimmed)) {
    throw new BadRequestException("附件引用必须使用文件服务返回的不可变引用");
  }
  return trimmed;
};

/**
 * MEMBER-01 的新体系服务。
 *
 * 这个服务只操作 CustomerProfile / CustomerAccount / CustomerMembership 及其新扩展表；
 * 不读取、不写入旧 Member 或 MembershipPlan。旧表尚保留是为了让历史订单能安全退役，
 * 而不是允许新旧体系双写。
 */
@Injectable()
export class MembershipService {
  private readonly customers: SharedCustomerRepository;
  private readonly registration: CustomerRegistrationService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: CustomerOperationsRepository,
    // 既有测试用位置参数 `new MembershipService(prisma, operations)` 构造，
    // 后两个依赖追加在最后且可选，缺失时按同一个 prisma 自建。
    @Optional() customers?: SharedCustomerRepository,
    @Optional() registration?: CustomerRegistrationService
  ) {
    this.customers = customers ?? new SharedCustomerRepository(prisma);
    this.registration = registration ?? new CustomerRegistrationService(prisma, this.customers, operations);
  }

  private async lockCustomer(tenantId: string, customerId: string, tx: Prisma.TransactionClient) {
    if (!(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
      throw new NotFoundException("客户不存在");
    }
  }

  /** Same canonical customer lock order for relation writers and business readers. */
  private async lockBookingCustomers(tenantId: string, personalCustomerId: string, corporateCustomerId: string | undefined, tx: Prisma.TransactionClient) {
    const ids = [...new Set([personalCustomerId, corporateCustomerId].filter((id): id is string => Boolean(id)))].sort();
    for (const id of ids) await this.lockCustomer(tenantId, id, tx);
  }

  private async requireWorkspace(tenantId: string, workspaceId: string, tx?: Prisma.TransactionClient) {
    const workspace = await (tx ?? this.prisma).businessWorkspace.findFirst({
      where: { tenantId, id: workspaceId },
      select: { id: true, categoryCode: true }
    });
    if (!workspace) throw new NotFoundException("当前经营空间不存在或不属于本租户");
    return { ...workspace, categoryCode: readRentalCategoryCode(workspace.categoryCode) };
  }

  private async requireCustomer(tenantId: string, customerId: string, expectedType?: "personal" | "corporate", tx?: Prisma.TransactionClient) {
    const customer = await (tx ?? this.prisma).customerProfile.findFirst({ where: { tenantId, id: customerId } });
    if (!customer) throw new NotFoundException("客户不存在");
    if (customer.mergedIntoCustomerId) throw new ConflictException("客户主档已合并，请使用保留主档");
    if (expectedType && customer.customerType !== expectedType) {
      throw new ConflictException(expectedType === "personal" ? "必须选择个人会员" : "必须选择企业会员");
    }
    return customer;
  }

  private async requireMembership(tenantId: string, customerId: string, tx?: Prisma.TransactionClient) {
    const membership = await (tx ?? this.prisma).customerMembership.findUnique({ where: { tenantId_customerId: { tenantId, customerId } } });
    if (!membership) throw new ConflictException("该客户尚未开通租户会员");
    return membership;
  }

  /** 业务事实仍归属空间；会员身份按租户验证，不再要求逐空间接入。 */
  async assertCustomerInWorkspace(tenantId: string, workspaceId: string, customerId: string) {
    await this.requireWorkspace(tenantId, workspaceId);
    await this.requireCustomer(tenantId, customerId);
    return this.requireMembership(tenantId, customerId);
  }

  /**
   * 报价与下单的会员资金减免门禁：个人风险记录始终检查；企业身份预约同时检查企业主档。
   * 事务参数用于下单最终复核，避免报价时的风险状态被当成永久授权。
   */
  async hasOpenRiskForBooking(
    tenantId: string,
    workspaceId: string,
    snapshot: Pick<RentalMembershipSnapshot, "personalCustomerId" | "corporateCustomerId">,
    tx?: Prisma.TransactionClient
  ): Promise<boolean> {
    const customerIds = [...new Set([snapshot.personalCustomerId, snapshot.corporateCustomerId].filter((id): id is string => Boolean(id)))];
    for (const customerId of customerIds) {
      // 会员/客户状态变更共用该行锁；订单事务在读取风险记录前先锁定所有相关主体。
      // 不存在的主体按有风险处理，不能因并发删除/合并而放宽减免门禁。
      if (tx && !(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) return true;
      if (await this.operations.hasOpenRisk(tenantId, customerId, workspaceId, tx)) return true;
    }
    return false;
  }

  async getRegistrationSettings(tenantId: string): Promise<CustomerMembershipRegistrationSettings> {
    const row = await this.prisma.customerMembershipRegistrationSettings.findUnique({ where: { tenantId } });
    return {
      registrationMode: (row?.registrationMode ?? "manual") as CustomerMembershipRegistrationSettings["registrationMode"],
      supportsOnlyNewImport: true,
      updatedAt: row?.updatedAt.toISOString()
    };
  }

  async saveRegistrationSettings(
    tenantId: string,
    registrationMode: CustomerMembershipRegistrationSettings["registrationMode"]
  ) {
    const row = await this.prisma.customerMembershipRegistrationSettings.upsert({
      where: { tenantId },
      create: { tenantId, registrationMode },
      update: { registrationMode }
    });
    return { registrationMode: row.registrationMode as CustomerMembershipRegistrationSettings["registrationMode"], updatedAt: row.updatedAt.toISOString(), supportsOnlyNewImport: true };
  }

  async registerPersonal(
    tenantId: string,
    input: RegisterPersonalMembershipRequest,
    operator?: string,
    canDirectApprove = false,
    canManageAccount = false
  ) {
    if (input.onlyNew && input.channel !== "admin") throw new BadRequestException("仅新增模式只用于后台导入");
    if (input.channel === "app" && input.directApprove) {
      throw new BadRequestException("APP 注册不能请求后台直接通过");
    }
    if (input.directApprove && !canDirectApprove) {
      throw new ConflictException("当前账号无权直接通过注册审核");
    }
    if (input.temporaryPassword && !canManageAccount) {
      throw new ForbiddenException("当前账号无权设置会员临时密码");
    }
    const registration = await this.getRegistrationSettings(tenantId);
    const automatic = registration.registrationMode === "automatic" || (input.channel === "admin" && Boolean(input.directApprove));
    const phone = input.phone.trim();
    const requestKey = input.idempotencyKey?.trim() || null;

    const result = await customerRegistrationTransaction(this.prisma, (tx) => this.registration.registerPersonal(tx, {
      tenantId,
      phone,
      name: input.name,
      email: input.email,
      identityNoMasked: mask(input.identityNo),
      gender: input.gender,
      birthday: input.birthday,
      sourceChannel: input.sourceChannel,
      region: input.region,
      automatic,
      channel: input.channel,
      requestKey,
      reviewPayload: { name: input.name.trim(), email: input.email?.trim() || undefined } as Prisma.InputJsonValue,
      selfService: false,
      onlyNew: input.onlyNew === true,
      account: input.temporaryPassword
        ? {
            passwordHash: hashPassword(input.temporaryPassword),
            mustChangePassword: true,
            lastReason: { create: "后台创建临时密码", update: "后台重置临时密码" },
            lastOperator: operator
          }
        : undefined
    }));

    return {
      customerId: result.customer.id,
      skipped: result.skipped || undefined,
      membershipStatus: result.membership.status,
      review: result.review ? this.toReview(result.review) : undefined
    };
  }

  /** 客户端自助改资料的写入口：ClientApiService 不直接写客户模型。主档不存在返回 false。 */
  async updateOwnProfile(tenantId: string, customerId: string, data: Pick<CustomerProfileUpdateData, "name" | "email">) {
    return Boolean(await this.customers.updateProfile(tenantId, customerId, data));
  }

  async listReviews(tenantId: string, status?: string, type?: string): Promise<CustomerMembershipReview[]> {
    const rows = await this.prisma.customerMembershipReview.findMany({
      where: { tenantId, ...(status ? { status } : {}), ...(type ? { reviewType: type } : {}) },
      include: { customer: { select: { name: true } }, qualificationRevision: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    });
    return rows.map((row) => this.toReview(row, row.customer.name, row.qualificationRevision ?? undefined));
  }

  async review(
    tenantId: string,
    reviewId: string,
    input: ReviewCustomerMembershipRequest,
    operator?: string,
    permissions: { registration: boolean; qualification: boolean } = { registration: false, qualification: false }
  ) {
    const reason = input.reason?.trim();
    const now = new Date();
    const candidate = await this.prisma.customerMembershipReview.findFirst({ where: { tenantId, id: reviewId }, select: { customerId: true } });
    if (!candidate) throw new NotFoundException("审核任务不存在");
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockCustomer(tenantId, candidate.customerId, tx);
      const review = await tx.customerMembershipReview.findFirst({ where: { tenantId, id: reviewId } });
      if (!review) throw new NotFoundException("审核任务不存在");
      if ((review.reviewType === "registration" || review.reviewType === "corporate_registration") && !permissions.registration) throw new ForbiddenException("当前账号无权处理注册审核");
      if (review.reviewType === "qualification" && !permissions.qualification) throw new ForbiddenException("当前账号无权处理证件审核");
      if (review.status !== "pending" && review.status !== "supplement_required") {
        throw new ConflictException("审核任务已处理，不能重复审核");
      }
      if (input.status !== "approved" && !reason) {
        throw new BadRequestException("拒绝、补件或取消审核必须填写原因");
      }
      const updated = await this.customers.updateReview(tenantId, review.id, {
        status: input.status, reason: reason || null, reviewedBy: operator, reviewedAt: now
      }, tx);
      if ((review.reviewType === "registration" || review.reviewType === "corporate_registration") && input.status === "approved") {
        await this.requireCustomer(tenantId, review.customerId, review.reviewType === "corporate_registration" ? "corporate" : "personal", tx);
        const membership = await this.requireMembership(tenantId, review.customerId, tx);
        if (membership.status === "pending_activation") {
          await this.operations.updateMembershipStatus(tenantId, membership.id, { status: "active" }, "pending_activation", {
            customerId: review.customerId, scope: "membership", action: "activate", fromStatus: "pending_activation",
            toStatus: "active", reason: reason || "注册审核通过", operator, at: now.toISOString()
          }, tx);
        } else if (review.reviewType === "corporate_registration") {
          throw new ConflictException("企业会员状态已变化，不能重复通过注册审核");
        }
      }
      if (review.reviewType === "corporate_registration") {
        const changed = await this.customers.updateCorporateProfileStatus(
          tenantId,
          review.customerId,
          input.status === "approved" ? "active" : input.status === "rejected" ? "rejected" : "pending_review",
          tx
        );
        if (changed.count !== 1) throw new ConflictException("企业法定资料缺失，审核未能完成");
      }
      if (review.reviewType === "qualification" && review.qualificationType) {
        const qualificationStatus: CustomerQualificationStatus = input.status === "approved"
          ? "approved"
          : input.status === "rejected"
            ? "rejected"
            : "pending";
        const revision = await tx.customerQualificationRevision.findFirst({ where: {
          tenantId, customerId: review.customerId, reviewId: review.id,
          ...(review.sourceWorkspaceId ? { workspaceId: review.sourceWorkspaceId } : {})
        } });
        if (input.status === "approved") {
          const original = revision ?? await tx.customerQualificationRef.findFirst({ where: {
            tenantId, customerId: review.customerId, qualificationType: review.qualificationType, currentRevisionId: null
          } });
          // 历史原附件无效只能拒绝本次新批准，不自动撤销或补造已批准历史。
          if (!original || original.qualificationType !== review.qualificationType) throw new ConflictException("审核任务缺少原资质依据");
          await this.assertQualificationEvidence(tx, tenantId, review.customerId, review.qualificationType, original.evidenceRef);
        }
        if (revision) {
          await tx.customerQualificationRevision.update({
            where: { id: revision.id },
            data: {
              qualificationStatus,
              reviewStatus: input.status,
              reviewReason: reason || null,
              reviewedBy: operator,
              reviewedAt: now
            }
          });
          // 旧审核不能覆盖后来提交的当前证件；只有仍指向本次快照时才回写当前事实。
          await tx.customerQualificationRef.updateMany({
            where: { tenantId, customerId: review.customerId, qualificationType: review.qualificationType, currentRevisionId: revision.id },
            data: { status: qualificationStatus, verifiedAt: input.status === "approved" ? now : null }
          });
        } else {
          // 兼容历史上没有版本快照的审核任务。
          await tx.customerQualificationRef.updateMany({
            where: { tenantId, customerId: review.customerId, qualificationType: review.qualificationType, currentRevisionId: null },
            data: { status: qualificationStatus, verifiedAt: input.status === "approved" ? now : null }
          });
        }
      }
      return updated;
    });
    const reviewed = await this.prisma.customerMembershipReview.findFirst({
      where: { tenantId, id: result.id },
      include: { customer: { select: { name: true } }, qualificationRevision: true }
    });
    return this.toReview(reviewed ?? result, reviewed?.customer.name, reviewed?.qualificationRevision ?? undefined);
  }

  async listQualificationRevisions(tenantId: string, customerId: string, qualificationType?: string) {
    await this.requireCustomer(tenantId, customerId, "personal");
    await this.requireMembership(tenantId, customerId);
    const rows = await this.prisma.customerQualificationRevision.findMany({
      where: { tenantId, customerId, ...(qualificationType ? { qualificationType } : {}) },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }]
    });
    return rows.map((row) => this.toQualificationRevision(row));
  }

  async listQualificationTypes(tenantId: string, workspaceId: string): Promise<CustomerMembershipQualificationType[]> {
    await this.requireWorkspace(tenantId, workspaceId);
    return (await this.prisma.customerMembershipQualificationType.findMany({
      where: { tenantId, workspaceId }, orderBy: [{ status: "asc" }, { name: "asc" }]
    })).map((row) => ({
      id: row.id, workspaceId: row.workspaceId, code: row.code, name: row.name,
      categoryCode: readRentalCategoryCode(row.categoryCode),
      capabilityCode: row.capabilityCode ?? undefined, requiredForBooking: row.requiredForBooking,
      status: row.status as CustomerMembershipQualificationType["status"],
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    }));
  }

  async saveQualificationType(tenantId: string, workspaceId: string, input: SaveCustomerMembershipQualificationTypeRequest) {
    const workspace = await this.requireWorkspace(tenantId, workspaceId);
    const row = await this.prisma.$transaction(async (tx) => {
      // Qualification types are active adoption dependencies. Serialize all
      // mutations (including disable/code changes) with the space's adoption.
      // Read the existing row only AFTER the mutex in ReadCommitted isolation.
      await lockActiveCategoryBinding(tx, tenantId, workspaceId, undefined, workspace.categoryCode.toLowerCase());
      const existing = input.id
        ? await tx.customerMembershipQualificationType.findFirst({ where: { tenantId, workspaceId, id: input.id } })
        : undefined;
      if (input.id && !existing) throw new NotFoundException("证件类型不存在");
      return existing
      ? tx.customerMembershipQualificationType.update({
          where: { id: existing.id },
          data: { code: input.code.trim(), name: input.name.trim(), capabilityCode: input.capabilityCode?.trim() || null, requiredForBooking: input.requiredForBooking ?? false, status: input.status ?? "enabled" }
        })
      : tx.customerMembershipQualificationType.create({
          data: { tenantId, workspaceId, code: input.code.trim(), name: input.name.trim(), categoryCode: workspace.categoryCode, capabilityCode: input.capabilityCode?.trim() || null, requiredForBooking: input.requiredForBooking ?? false, status: input.status ?? "enabled" }
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return (await this.listQualificationTypes(tenantId, workspaceId)).find((item) => item.id === row.id)!;
  }

  /** 渠道只记录提交来源，不能跳过原文件/客户/证件类型校验。行锁使校验和
   * 审核/版本写入同事务；本门不把附件存在等同于资质已通过。 */
  private async assertQualificationEvidence(tx: Prisma.TransactionClient, tenantId: string, customerId: string,
    qualificationType: string, evidenceRef?: string | null) {
    if (!evidenceRef) return;
    const id = evidenceRefOrUndefined(evidenceRef);
    if (!id || id !== evidenceRef) throw new BadRequestException("资质附件引用无效");
    // MySQL RR：前面的客户读取已建立快照，不能锁后再用普通SELECT读旧文件状态。
    const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; businessModule: string; businessType: string;
      businessId: string | null; uploadScene: string; status: string; metadata: Prisma.JsonValue }>>(Prisma.sql`
      SELECT \`id\`, \`tenantId\`, \`businessModule\`, \`businessType\`, \`businessId\`, \`uploadScene\`, \`status\`, \`metadata\`
      FROM \`FileAsset\` WHERE \`tenantId\` = ${tenantId} AND \`id\` = ${id} FOR UPDATE`);
    const evidence = rows[0];
    if (!evidence || evidence.id !== id || evidence.tenantId !== tenantId || evidence.businessModule !== "membership"
      || evidence.businessType !== "customer" || evidence.businessId !== customerId || evidence.uploadScene !== "client-qualification"
      || evidence.status !== "active") throw new BadRequestException("资质附件不存在、尚未完成上传或不属于当前会员");
    const metadata = evidence.metadata && typeof evidence.metadata === "object" && !Array.isArray(evidence.metadata)
      ? evidence.metadata as Record<string, unknown> : {};
    if (metadata.qualificationType !== qualificationType) throw new BadRequestException("资质附件与证件类型不匹配");
  }

  async submitQualification(tenantId: string, workspaceId: string, customerId: string, input: SubmitCustomerQualificationRequest, channel: "admin" | "app", operator?: string) {
    await this.requireWorkspace(tenantId, workspaceId);
    await this.requireCustomer(tenantId, customerId, "personal");
    await this.requireMembership(tenantId, customerId);
    const type = await this.prisma.customerMembershipQualificationType.findFirst({
      where: { tenantId, workspaceId, code: input.qualificationType, status: "enabled" }
    });
    if (!type) throw new BadRequestException("当前经营空间未启用该证件类型");
    const issuedAt = dateOrUndefined(input.issuedAt);
    const expiresAt = dateOrUndefined(input.expiresAt);
    if ([issuedAt, expiresAt].some((value) => value && Number.isNaN(value.getTime()))) {
      throw new BadRequestException("证件日期格式无效");
    }
    if (issuedAt && expiresAt && expiresAt < issuedAt) {
      throw new BadRequestException("证件有效期不能早于签发日期");
    }
    const evidenceRef = evidenceRefOrUndefined(input.evidenceRef);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockCustomer(tenantId, customerId, tx);
      await this.requireCustomer(tenantId, customerId, "personal", tx);
      await this.requireMembership(tenantId, customerId, tx);
      await this.assertQualificationEvidence(tx, tenantId, customerId, input.qualificationType, evidenceRef);
      const review = await this.customers.createReview({
        tenantId, sourceWorkspaceId: workspaceId, customerId, reviewType: "qualification", qualificationType: input.qualificationType,
        status: "pending", channel, payload: { evidenceRef, submittedBy: operator } as Prisma.InputJsonValue
      }, tx);
      const revision = await tx.customerQualificationRevision.create({
        data: {
          tenantId, workspaceId, customerId, qualificationType: input.qualificationType,
          categoryCode: readRentalCategoryCode(type.categoryCode), capabilityCode: type.capabilityCode,
          applicableScope: {
            workspaceId, categoryCode: readRentalCategoryCode(type.categoryCode),
            ...(type.capabilityCode ? { capabilityCode: type.capabilityCode } : {}),
            requiredForBooking: type.requiredForBooking
          } as Prisma.InputJsonValue,
          referenceNoMasked: mask(input.referenceNo), issuedAt, expiresAt, evidenceRef,
          source: channel, submittedBy: operator, submittedAt: now,
          qualificationStatus: "pending", reviewStatus: "pending", reviewId: review.id
        }
      });
      const qualification = await tx.customerQualificationRef.upsert({
        where: { tenantId_customerId_qualificationType: { tenantId, customerId, qualificationType: input.qualificationType } },
        create: {
          tenantId, customerId, qualificationType: input.qualificationType,
          referenceNoMasked: mask(input.referenceNo), issuedAt,
          expiresAt, evidenceRef: evidenceRef || null, source: channel, currentRevisionId: revision.id, status: "pending"
        },
        update: {
          referenceNoMasked: mask(input.referenceNo) ?? null, issuedAt: issuedAt ?? null,
          expiresAt: expiresAt ?? null, evidenceRef: evidenceRef || null, source: channel, currentRevisionId: revision.id, status: "pending", verifiedAt: null
        }
      });
      return { qualification, review, revision, now };
    });
    return { qualification: this.toQualification(result.qualification), review: this.toReview(result.review, undefined, result.revision) };
  }

  async listPersonalOptions(tenantId: string): Promise<BookingMemberOption[]> {
    const whereScope = await this.personalBookingOptionScope(tenantId);
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId, customerType: "personal", mergedIntoCustomerId: null, membership: { is: { status: "active" } }, ...(whereScope ? { AND: [whereScope] } : {}) },
      select: { id: true, name: true, phoneMasked: true, membership: { select: { status: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    });
    return rows.map((row) => ({
      customerId: row.id, name: row.name, phoneMasked: row.phoneMasked,
      membershipStatus: row.membership!.status as BookingMemberOption["membershipStatus"]
    }));
  }

  /** Bounded read for authorized AI/booking callers. The legacy method above
   * remains unchanged for existing callers; this method never scans the full
   * member table and does not expose totals. */
  async listPersonalOptionsPage(tenantId: string, input: { limit: number; cursor?: string; name?: string; customerId?: string }) {
    const limit = Number.isInteger(input?.limit) && input.limit >= 1 && input.limit <= 50 ? input.limit : 0;
    if (!limit || (input.cursor && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(input.cursor))) throw new BadRequestException("会员候选分页参数无效");
    const whereScope = await this.personalBookingOptionScope(tenantId, 200, input.customerId);
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId, customerType: "personal", mergedIntoCustomerId: null,
        ...(input.customerId ? { id: input.customerId } : {}),
        ...(input.name ? { name: { contains: input.name.trim() } } : {}),
        membership: { is: { status: "active" } }, ...(whereScope ? { AND: [whereScope] } : {}) },
      select: { id: true, name: true, phoneMasked: true, membership: { select: { status: true } } },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: limit + 1, orderBy: [{ name: "asc" }, { id: "asc" }]
    });
    const page = rows.slice(0, limit);
    return { rows: page.map((row) => ({ customerId: row.id, name: row.name, phoneMasked: row.phoneMasked,
      membershipStatus: row.membership!.status as BookingMemberOption["membershipStatus"] })),
      nextCursor: rows.length > limit ? page[page.length - 1]?.id : undefined, truncated: rows.length > limit };
  }

  private async personalBookingOptionScope(tenantId: string, maximumCustomers?: number, customerId?: string): Promise<Prisma.CustomerProfileWhereInput | undefined> {
    const scope = getRequestDataScope();
    const locationIds = getRequestLocationIds();
    if ((!scope || scope === "all") && locationIds === undefined) return undefined;
    if (scope === "organization" && locationIds === undefined) {
      throw new ForbiddenException("组织会员范围未解析为授权履约地点，已拒绝访问");
    }
    const workspaceId = getRequestWorkspaceId();
    const userId = getRequestUserId();
    if (!workspaceId || (scope === "own" && !userId)) {
      throw new ForbiddenException("会员选择范围缺少已验证的账号或经营空间");
    }
    const orderScope: Prisma.RentalOrderWhereInput[] = [];
    if (locationIds !== undefined) {
      const safeIds = locationIds.length ? locationIds : ["__no_authorized_location__"];
      orderScope.push({ OR: [
        { fulfillmentLocationId: { in: safeIds } },
        { returnLocationId: { in: safeIds } }
      ] });
    }
    if (scope === "own") {
      orderScope.push({ OR: [
        { createdBy: userId! },
        { workOrders: { some: { OR: [{ createdBy: userId! }, { assigneeId: userId! }] } } }
      ] });
    }
    const orders = await this.prisma.rentalOrder.findMany({
      where: {
        tenantId,
        workspaceId,
        customerId: customerId ?? { not: null },
        ...(orderScope.length ? { AND: orderScope } : {})
      },
      select: { customerId: true },
      distinct: ["customerId"],
      ...(maximumCustomers === undefined ? {} : { take: maximumCustomers + 1, orderBy: { customerId: "asc" as const } })
    });
    // Do not turn a partial visibility expansion into a complete candidate set.
    // The legacy caller retains its existing semantics; the bounded endpoint
    // refuses large expansions until a relational/paged visibility source exists.
    if (maximumCustomers !== undefined && orders.length > maximumCustomers) {
      throw new BadRequestException("会员候选授权范围过大，请使用受权精确查询入口");
    }
    const visibleIds = new Set(orders.flatMap((row) => row.customerId ? [row.customerId] : []));
    const alternatives: Prisma.CustomerProfileWhereInput[] = [];
    if (visibleIds.size) alternatives.push({ id: { in: [...visibleIds] } });
    if (locationIds === undefined && (scope === "own" || scope === "store")) {
      alternatives.push({
        createdInWorkspaceId: workspaceId,
        ...(scope === "own" ? { createdByUserId: userId! } : {})
      });
    }
    return { OR: alternatives.length ? alternatives : [{ id: "__no_visible_customer__" }] };
  }

  private async assertPersonalBookingCustomerVisible(tenantId: string, workspaceId: string, customerId: string) {
    const scope = getRequestDataScope();
    const locationIds = getRequestLocationIds();
    if ((!scope || scope === "all") && locationIds === undefined) return;
    if (scope === "organization" && locationIds === undefined) {
      throw new ForbiddenException("组织会员范围未解析为授权履约地点，已拒绝访问");
    }
    const userId = getRequestUserId();
    if (scope === "own" && !userId) throw new ForbiddenException("本人会员范围缺少已验证账号");
    if (locationIds === undefined && (scope === "own" || scope === "store")) {
      const profile = await this.prisma.customerProfile.findFirst({
        where: {
          id: customerId,
          tenantId,
          createdInWorkspaceId: workspaceId,
          ...(scope === "own" ? { createdByUserId: userId! } : {})
        },
        select: { id: true }
      });
      if (profile) return;
    }
    const orderScope: Prisma.RentalOrderWhereInput[] = [];
    if (locationIds !== undefined) {
      const safeIds = locationIds.length ? locationIds : ["__no_authorized_location__"];
      orderScope.push({ OR: [
        { fulfillmentLocationId: { in: safeIds } },
        { returnLocationId: { in: safeIds } }
      ] });
    }
    if (scope === "own") {
      orderScope.push({ OR: [
        { createdBy: userId! },
        { workOrders: { some: { OR: [{ createdBy: userId! }, { assigneeId: userId! }] } } }
      ] });
    }
    const order = await this.prisma.rentalOrder.findFirst({
      where: {
        tenantId,
        workspaceId,
        AND: [
          ...orderScope,
          { OR: [
          { customerId },
          { contractSubjectCustomerId: customerId },
          { payerSubjectCustomerId: customerId },
          { userSubjectCustomerId: customerId }
          ] }
        ]
      },
      select: { id: true }
    });
    if (!order) throw new NotFoundException("会员不存在或不在当前账号的数据范围内");
  }

  /** Minimal name-edit discovery under the original personal-member list ACL.
   * Tenant member master data is shared; booking/order visibility is a separate
   * responsibility. Never load accounts, qualifications, contacts or orders. */
  async listPersonalProfileCandidatesPage(tenantId: string, input: { limit: number; name?: string; customerId?: string; cursor?: string }) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['limit', 'name', 'customerId', 'cursor'].includes(key))
      || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50
      || [input.customerId, input.cursor].some(value => value !== undefined && (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,191}$/u.test(value)))
      || input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 191))
      throw new BadRequestException('普通资料候选查询参数无效');
    const identity = getRequestIdentity();
    if (!identity?.userId || identity.tenantId !== tenantId || !identity.workspaceId || identity.isSaasAdmin || identity.staffApi)
      throw new ForbiddenException('普通资料候选缺少当前营运范围');
    const actorId = identity.userId, workspaceId = identity.workspaceId;
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId, customerType: 'personal', mergedIntoCustomerId: null, membership: { isNot: null },
        ...(input.customerId ? { id: input.customerId } : {}), ...(input.cursor ? { AND: [{ id: { lt: input.cursor } }] } : {}),
        ...(input.name ? { name: { contains: input.name.trim() } } : {}) },
      select: { id: true, name: true, phoneMasked: true, membership: { select: { status: true } } },
      take: input.limit + 1, orderBy: { id: 'desc' }
    });
    const current = getRequestIdentity();
    if (current?.userId !== actorId || current.tenantId !== tenantId || current.workspaceId !== workspaceId || current.isSaasAdmin || current.staffApi)
      throw new ForbiddenException('普通资料候选读取期间范围变化');
    const page = rows.slice(0, input.limit);
    if (page.some(row => !row.membership)) throw new ConflictException('普通资料候选会员关联不可用');
    return { rows: page.map(row => ({ customerId: row.id, name: row.name, phoneMasked: row.phoneMasked,
      membershipStatus: row.membership!.status as PersonalMembershipMember['membershipStatus'] })), truncated: rows.length > input.limit,
      ...(rows.length > input.limit ? { nextCursor: page[page.length - 1].id } : {}) };
  }

  async listPersonalMembers(tenantId: string): Promise<PersonalMembershipMember[]> {
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId, customerType: "personal", membership: { isNot: null } },
      include: {
        membership: true,
        account: { select: { status: true, loginPhoneMasked: true, suspendedAt: true, closedAt: true } },
        qualificationRefs: { where: { tenantId }, orderBy: { qualificationType: "asc" } }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return rows.map((row) => {
      const link = row.membership!;
      return {
        customerId: row.id, name: row.name, phoneMasked: row.phoneMasked, email: row.email ?? undefined,
        identityNoMasked: row.identityNoMasked ?? undefined,
        gender: row.gender ?? undefined, birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : undefined,
        sourceChannel: row.sourceChannel ?? undefined, region: row.region ?? undefined,
        membershipStatus: link.status as PersonalMembershipMember["membershipStatus"],
        levelName: link.levelName,
        account: row.account
          ? { provisioned: true, status: row.account.status as PersonalMembershipMember["account"]["status"], loginPhoneMasked: row.account.loginPhoneMasked, suspendedAt: row.account.suspendedAt?.toISOString(), closedAt: row.account.closedAt?.toISOString() }
          : { provisioned: false },
        qualifications: row.qualificationRefs.map((qualification) => this.toQualification(qualification)),
        createdAt: row.createdAt.toISOString()
      };
    });
  }

  async savePersonalMember(tenantId: string, customerId: string, input: SavePersonalMembershipRequest) {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockCustomer(tenantId, customerId, tx);
      await this.requireMembership(tenantId, customerId, tx);
      const customer = await this.requireCustomer(tenantId, customerId, "personal", tx);
      const phone = input.phone?.trim() || customer.phone;
      if (phone !== customer.phone) {
        const duplicate = await tx.customerProfile.findFirst({ where: { tenantId, phone, id: { not: customerId } }, select: { id: true } });
        if (duplicate) throw new ConflictException("该手机号已被其他客户主档使用");
      }
      const updated = await this.customers.updateProfile(tenantId, customer.id, {
        name: input.name.trim(), phone, phoneMasked: mask(phone) ?? "****", email: input.email?.trim() || null,
        ...(input.identityNo === undefined ? {} : { identityNoMasked: mask(input.identityNo) }),
        // 基础画像主数据：显式传入即写（含清空为 null）；未传字段不动。
        ...(input.gender === undefined ? {} : { gender: input.gender || null }),
        ...(input.birthday === undefined ? {} : { birthday: input.birthday ? new Date(`${input.birthday}T00:00:00.000Z`) : null }),
        ...(input.sourceChannel === undefined ? {} : { sourceChannel: input.sourceChannel || null }),
        ...(input.region === undefined ? {} : { region: input.region?.trim() || null })
      }, tx);
      if (!updated) throw new NotFoundException("客户不存在");
      await this.customers.updateAccount(tenantId, { customerId }, { loginPhone: phone, loginPhoneMasked: mask(phone) ?? "****" }, undefined, tx);
      return updated;
    });
    return {
      customerId: row.id, name: row.name, phoneMasked: row.phoneMasked, email: row.email ?? undefined,
      identityNoMasked: row.identityNoMasked ?? undefined,
      gender: row.gender ?? undefined, birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : undefined,
      sourceChannel: row.sourceChannel ?? undefined, region: row.region ?? undefined
    };
  }

  async setTemporaryPassword(tenantId: string, customerId: string, temporaryPassword: string, operator?: string) {
    const account = await this.prisma.$transaction(async (tx) => {
      await this.lockCustomer(tenantId, customerId, tx);
      await this.requireMembership(tenantId, customerId, tx);
      const customer = await this.requireCustomer(tenantId, customerId, "personal", tx);
      const updated = await this.customers.upsertAccountCredentials({
        tenantId, customerId, loginPhone: customer.phone, loginPhoneMasked: customer.phoneMasked,
        passwordHash: hashPassword(temporaryPassword), mustChangePassword: true, rebindLogin: false,
        lastReason: { create: "管理员设置临时密码", update: "管理员重置临时密码" }, lastOperator: operator
      }, tx);
      await tx.clientAuthSession.updateMany({ where: { tenantId, customerId, revokedAt: null }, data: { revokedAt: new Date() } });
      return updated;
    });
    return { provisioned: true, status: account.status, loginPhoneMasked: account.loginPhoneMasked, mustChangePassword: account.mustChangePassword };
  }

  async listCorporateMembers(tenantId: string): Promise<CorporateMembershipMember[]> {
    const now = new Date();
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId, customerType: "corporate", membership: { isNot: null } },
      include: {
        membership: true,
        corporateProfile: true,
        corporateMembershipsAsCompany: {
          where: { tenantId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
          select: { role: true }
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return rows.map((row) => ({
      customerId: row.id, name: row.name, corporateName: row.corporateProfile?.legalName ?? row.corporateName ?? undefined, email: row.email ?? undefined, phoneMasked: row.phoneMasked,
      corporateProfile: row.corporateProfile ? {
        legalName: row.corporateProfile.legalName,
        unifiedSocialCreditCodeMasked: row.corporateProfile.unifiedSocialCreditCodeMasked,
        registeredAddress: row.corporateProfile.registeredAddress ?? undefined,
        legalRepName: row.corporateProfile.legalRepName ?? undefined,
        legalRepPhoneMasked: row.corporateProfile.legalRepPhoneMasked ?? undefined,
        industry: row.corporateProfile.industry ?? undefined,
        scale: row.corporateProfile.scale as CustomerCorporateProfileSummary["scale"]
      } : undefined,
      membershipStatus: row.membership!.status as CorporateMembershipMember["membershipStatus"],
      employeeCount: row.corporateMembershipsAsCompany.length,
      adminCount: row.corporateMembershipsAsCompany.filter((item) => item.role === "admin").length,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async saveCorporateMember(tenantId: string, input: SaveCorporateMembershipRequest) {
    const name = input.name.trim();
    const legalName = input.corporateName.trim();
    const suppliedPhone = input.phone?.trim();
    const suppliedCode = (input.unifiedSocialCreditCode ?? input.corporateTaxNo)?.trim().toUpperCase();
    if (!name || !legalName) throw new BadRequestException("企业名称和联系人不能为空");
    if (!input.id && !suppliedPhone) throw new BadRequestException("新建企业会员必须填写联系电话");
    if (!input.id && !suppliedCode) throw new BadRequestException("新建企业会员必须填写统一社会信用代码");
    if (suppliedCode && !/^[0-9A-HJ-NPQRTUWXY]{18}$/u.test(suppliedCode)) {
      throw new BadRequestException("统一社会信用代码必须为 18 位有效字符");
    }

    const execute = async () => this.prisma.$transaction(async (tx) => {
      const existing = input.id ? await tx.customerProfile.findFirst({
        where: { tenantId, id: input.id, customerType: "corporate" },
        include: { membership: true, corporateProfile: true }
      }) : undefined;
      if (input.id && !existing) throw new NotFoundException("企业客户不存在或不属于当前租户");
      if (existing && !existing.membership) throw new ConflictException("企业客户尚未建立会员关系");

      const phone = suppliedPhone || existing?.phone;
      if (!phone) throw new BadRequestException("新建企业会员必须填写联系电话");
      const duplicatePhone = await tx.customerProfile.findFirst({
        where: { tenantId, phone, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true }
      });
      if (duplicatePhone) throw new ConflictException("该手机号已被其他客户主档使用");

      // Never silently promote the legacy flat field: old rows can contain malformed or
      // duplicated codes that the one-time backfill deliberately skipped. Require an
      // explicit value when editing such a record so the operator reconciles it.
      const code = suppliedCode || existing?.corporateProfile?.unifiedSocialCreditCode;
      if (!code) throw new BadRequestException("企业资料缺少统一社会信用代码，请补充后保存");
      if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/u.test(code)) {
        throw new BadRequestException("统一社会信用代码必须为 18 位有效字符");
      }
      const duplicateCode = await tx.customerCorporateProfile.findFirst({
        where: { tenantId, unifiedSocialCreditCode: code, ...(existing ? { customerId: { not: existing.id } } : {}) }, select: { customerId: true }
      });
      if (duplicateCode) throw new ConflictException("该统一社会信用代码已登记为本租户的其他企业");
      const legacyCorporateRows = await tx.customerProfile.findMany({
        where: { tenantId, customerType: "corporate", corporateTaxNo: { not: null }, ...(existing ? { id: { not: existing.id } } : {}) },
        select: { corporateTaxNo: true }
      });
      if (legacyCorporateRows.some((row) => row.corporateTaxNo?.trim().toUpperCase() === code)) {
        throw new ConflictException("该统一社会信用代码仍存在未迁移的历史企业记录，请先核对企业主档");
      }

      const email = input.clearEmail ? null : input.email?.trim() || existing?.email || null;
      const profileData: CustomerProfileUpdateData = {
        name, phone, phoneMasked: mask(phone) ?? "****", email,
        corporateName: legalName,
        // 新资料只以 CustomerCorporateProfile 为法定主体资料事实源，不再双写明文税号。
        corporateTaxNo: null
      };
      const customer = existing
        ? await this.customers.updateProfile(tenantId, existing.id, profileData, tx)
        : await this.customers.createProfile({ tenantId, customerType: "corporate", name, phone, email: email ?? undefined, corporateName: legalName }, tx);
      if (!customer) throw new NotFoundException("企业客户不存在");

      const pending = !existing || existing.membership?.status === "pending_activation";
      const corporateProfile = await this.customers.upsertCorporateProfile({
        tenantId, customerId: customer.id, legalName, unifiedSocialCreditCode: code,
        unifiedSocialCreditCodeMasked: mask(code) ?? "****",
        registeredAddress: input.registeredAddress?.trim() || existing?.corporateProfile?.registeredAddress,
        legalRepName: input.legalRepName?.trim() || existing?.corporateProfile?.legalRepName,
        legalRepPhoneMasked: input.legalRepPhone?.trim() ? mask(input.legalRepPhone) : existing?.corporateProfile?.legalRepPhoneMasked,
        industry: input.industry?.trim() || existing?.corporateProfile?.industry,
        scale: input.scale ?? existing?.corporateProfile?.scale,
        status: pending ? "pending_review" : existing?.corporateProfile?.status ?? "active"
      }, tx);

      if (!existing) {
        await this.customers.createMembership({ tenantId, customerId: customer.id, levelName: "企业会员", status: "pending_activation" }, tx);
      }
      if (pending) {
        const openReview = existing ? await tx.customerMembershipReview.findFirst({
          where: { tenantId, customerId: customer.id, reviewType: "corporate_registration", status: { in: ["pending", "supplement_required"] } },
          orderBy: { createdAt: "desc" }
        }) : undefined;
        if (openReview) {
          await this.customers.updateReview(tenantId, openReview.id, {
            status: "cancelled", reason: "企业资料已更新，已重新提交审核", reviewedBy: getRequestUserId() ?? "后台管理员", reviewedAt: new Date()
          }, tx);
        }
        await this.customers.createReview({
          tenantId, customerId: customer.id, reviewType: "corporate_registration", channel: "admin",
          sourceWorkspaceId: getRequestWorkspaceId(), requestKey: `corp-registration:${customer.id}:${randomUUID()}`,
          payload: {
            corporateSnapshot: {
              legalName: corporateProfile.legalName,
              unifiedSocialCreditCodeMasked: corporateProfile.unifiedSocialCreditCodeMasked,
              registeredAddress: corporateProfile.registeredAddress ?? undefined,
              legalRepName: corporateProfile.legalRepName ?? undefined,
              legalRepPhoneMasked: corporateProfile.legalRepPhoneMasked ?? undefined,
              industry: corporateProfile.industry ?? undefined,
              scale: corporateProfile.scale ?? undefined,
              contactName: customer.name,
              contactPhoneMasked: customer.phoneMasked,
              email: customer.email ?? undefined
            }
          } as Prisma.InputJsonValue
        }, tx);
      }
      return customer.id;
    });

    try {
      const customerId = await execute();
      return (await this.listCorporateMembers(tenantId)).find((item) => item.customerId === customerId)!;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("手机号或统一社会信用代码已被本租户其他客户使用");
      }
      throw error;
    }
  }

  async listCorporateEmployees(tenantId: string, corporateCustomerId: string): Promise<CustomerCorporateMembership[]> {
    await this.requireCustomer(tenantId, corporateCustomerId, "corporate");
    await this.requireMembership(tenantId, corporateCustomerId);
    const rows = await this.prisma.customerCorporateMembership.findMany({
      where: { tenantId, corporateCustomerId },
      include: { personalCustomer: { select: { name: true } } }, orderBy: [{ role: "asc" }, { createdAt: "desc" }]
    });
    return rows.map((row) => this.toCorporateMembership(row, row.personalCustomer.name));
  }

  async saveCorporateEmployee(tenantId: string, corporateCustomerId: string, input: SaveCustomerCorporateMembershipRequest, operator?: string) {
    input = structuredClone(input);
    await this.requireCustomer(tenantId, corporateCustomerId, "corporate");
    const corporateLink = await this.requireMembership(tenantId, corporateCustomerId);
    if (corporateLink.status !== "active") throw new ConflictException("企业会员尚未审核通过，不能维护企业员工关系");
    await this.requireCustomer(tenantId, input.personalCustomerId, "personal");
    const personalLink = await this.requireMembership(tenantId, input.personalCustomerId);
    if (personalLink.status !== "active") throw new ConflictException("只有本租户的有效个人会员才能加入企业");
    if (corporateCustomerId === input.personalCustomerId) throw new BadRequestException("企业不能将自身作为员工");
    const effectiveFrom = dateOrUndefined(input.effectiveFrom) ?? new Date();
    const effectiveTo = dateOrUndefined(input.effectiveTo);
    if ([effectiveFrom, effectiveTo].some((value) => value && Number.isNaN(value.getTime()))) {
      throw new BadRequestException("员工关系有效期格式无效");
    }
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException("员工关系失效时间不能早于生效时间");
    const row = await this.prisma.$transaction(async tx => {
      await this.lockBookingCustomers(tenantId, input.personalCustomerId, corporateCustomerId, tx);
      await this.requireCustomer(tenantId, corporateCustomerId, "corporate", tx);
      await this.requireCustomer(tenantId, input.personalCustomerId, "personal", tx);
      const [corporate, personal] = await Promise.all([
        this.requireMembership(tenantId, corporateCustomerId, tx), this.requireMembership(tenantId, input.personalCustomerId, tx)
      ]);
      if (corporate.status !== "active" || personal.status !== "active") throw new ConflictException("会员状态已变化，不能维护企业员工关系");
      return tx.customerCorporateMembership.upsert({
        where: { tenantId_corporateCustomerId_personalCustomerId: { tenantId, corporateCustomerId, personalCustomerId: input.personalCustomerId } },
        create: {
          tenantId, corporateCustomerId, personalCustomerId: input.personalCustomerId,
          role: input.role, department: input.department?.trim() || null, employeeNo: input.employeeNo?.trim() || null,
          status: input.status ?? "active", effectiveFrom,
          effectiveTo, reason: input.reason?.trim() || null, createdBy: operator
        },
        update: {
          role: input.role, department: input.department?.trim() || null, employeeNo: input.employeeNo?.trim() || null,
          status: input.status ?? "active", effectiveFrom,
          effectiveTo, reason: input.reason?.trim() || null
        },
        include: { personalCustomer: { select: { name: true } } }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return this.toCorporateMembership(row, row.personalCustomer.name);
  }

  async benefitScopeOptions(tenantId: string) {
    const workspaces = await this.prisma.businessWorkspace.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, code: true, name: true, categoryCode: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    });
    return {
      workspaces,
      categories: await rentalCategoryIdentityOptions(this.prisma)
    };
  }

  /** Opening needs the tenant's plan count, not plan/version/benefit contents.
   * Same tenant-only population as listPlans, including drafts/empty plans. */
  async countPlans(tenantId: string): Promise<number> {
    return this.prisma.customerMembershipPlan.count({ where: { tenantId } });
  }

  async listPlans(tenantId: string): Promise<CustomerMembershipPlan[]> {
    const rows = await this.prisma.customerMembershipPlan.findMany({
      where: { tenantId }, include: { versions: { orderBy: { version: "desc" } } }, orderBy: [{ targetType: "asc" }, { code: "asc" }]
    });
    return rows.map((row) => this.toPlan(row));
  }

  async savePlan(tenantId: string, input: SaveCustomerMembershipPlanRequest, operator?: string) {
    input = { ...input, benefits: await this.normalizeBenefits(tenantId, input.benefits) };
    if (input.effectiveFrom && input.effectiveTo && new Date(input.effectiveFrom) > new Date(input.effectiveTo)) {
      throw new BadRequestException("方案失效时间不能早于生效时间");
    }
    const plan = await this.prisma.$transaction(async (tx) => {
      const existing = input.id
        ? await tx.customerMembershipPlan.findFirst({ where: { tenantId, id: input.id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } })
        : undefined;
      if (input.id && !existing) throw new NotFoundException("会员方案不存在");
      if (existing && existing.targetType !== input.targetType) throw new ConflictException("已创建方案不能改变个人/企业目标类型");
      const base = existing
        ? await tx.customerMembershipPlan.update({ where: { id: existing.id }, data: { code: input.code.trim(), name: input.name.trim() } })
        : await tx.customerMembershipPlan.create({ data: { tenantId, code: input.code.trim(), name: input.name.trim(), targetType: input.targetType } });
      const latest = existing?.versions[0];
      const targetVersion = latest && latest.status === "draft"
        ? await tx.customerMembershipPlanVersion.update({
            where: { id: latest.id },
            data: this.planVersionData(input)
          })
        : await tx.customerMembershipPlanVersion.create({
            data: { tenantId, planId: base.id, version: (latest?.version ?? 0) + 1, createdBy: operator, ...this.planVersionData(input) }
          });
      return { base, targetVersion };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const all = await this.listPlans(tenantId);
    return all.find((item) => item.id === plan.base.id)!;
  }

  async publishPlan(tenantId: string, planId: string, versionId: string, operator?: string) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, planId, id: versionId }, include: { plan: true } });
      if (!version) throw new NotFoundException("会员方案版本不存在");
      if (version.status !== "draft") throw new ConflictException("只有草稿版本可以发布");
      if (version.isDefault) {
        await tx.customerMembershipPlanVersion.updateMany({
          where: { tenantId, id: { not: version.id }, status: "published", isDefault: true, plan: { targetType: version.plan.targetType } },
          data: { isDefault: false }
        });
      }
      await tx.customerMembershipPlanVersion.update({ where: { id: version.id }, data: { status: "published", publishedBy: operator, publishedAt: now } });
      await tx.customerMembershipPlan.update({ where: { id: planId }, data: { status: "active" } });
    });
    return (await this.listPlans(tenantId)).find((item) => item.id === planId)!;
  }

  async disablePlanVersion(tenantId: string, planId: string, versionId: string, reason: string, operator?: string) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new BadRequestException("停用会员方案必须填写原因");
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, planId, id: versionId } });
      if (!version) throw new NotFoundException("会员方案版本不存在");
      if (version.status !== "published") throw new ConflictException("只有已发布方案版本可以停用");
      await tx.customerMembershipPlanVersion.update({
        where: { id: version.id },
        data: { status: "disabled", disabledBy: operator, disabledAt: new Date(), disableReason: trimmedReason }
      });
      const remainingPublished = await tx.customerMembershipPlanVersion.count({
        where: { tenantId, planId, status: "published", id: { not: version.id } }
      });
      await tx.customerMembershipPlan.update({ where: { id: planId }, data: { status: remainingPublished ? "active" : "disabled" } });
    });
    return (await this.listPlans(tenantId)).find((item) => item.id === planId)!;
  }

  async restorePlanVersion(tenantId: string, planId: string, versionId: string, reason: string, operator?: string) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new BadRequestException("恢复会员方案必须填写原因");
    await this.prisma.$transaction(async (tx) => {
      const source = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, planId, id: versionId } });
      if (!source) throw new NotFoundException("会员方案版本不存在");
      if (!["published", "disabled"].includes(source.status)) throw new ConflictException("只能从已发布或已停用版本恢复");
      const latest = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, planId }, orderBy: { version: "desc" } });
      if (latest?.status === "draft") throw new ConflictException("该方案已有草稿，请先发布或作废后再恢复");
      const benefits = await this.normalizeBenefits(tenantId, source.benefits as unknown as CustomerMembershipBenefit[], tx);
      await tx.customerMembershipPlanVersion.create({
        data: {
          tenantId, planId, version: (latest?.version ?? 0) + 1, status: "draft", levelRank: source.levelRank,
          isDefault: source.isDefault, isRecommended: source.isRecommended, appVisible: source.appVisible,
          effectiveFrom: source.effectiveFrom, effectiveTo: source.effectiveTo, eligibility: source.eligibility as Prisma.InputJsonValue, benefits: benefits as unknown as Prisma.InputJsonValue,
          createdBy: operator, restoredFromVersionId: source.id, restoreReason: trimmedReason
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return (await this.listPlans(tenantId)).find((item) => item.id === planId)!;
  }

  async assignPlan(tenantId: string, input: AssignCustomerMembershipPlanRequest, operator?: string): Promise<CustomerMembershipPlanAssignment> {
    const customer = await this.requireCustomer(tenantId, input.customerId);
    const membership = await this.requireMembership(tenantId, input.customerId);
    if (membership.status !== "active") {
      throw new ConflictException(customer.customerType === "corporate" ? "企业会员尚未审核通过，不能获得企业权益" : "会员当前状态不可授予方案");
    }
    const source = input.source ?? "manual";
    const effectiveFrom = dateOrUndefined(input.effectiveFrom) ?? new Date();
    const effectiveTo = dateOrUndefined(input.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException("会员方案失效时间不能早于生效时间");
    if ((source === "manual" || source === "corporate_contract") && !input.reason?.trim()) {
      throw new BadRequestException("人工授予或合同授予会员方案必须填写原因");
    }
    const version = await this.prisma.customerMembershipPlanVersion.findFirst({
      where: { tenantId, id: input.planVersionId, status: "published" }, include: { plan: true }
    });
    if (!version) throw new NotFoundException("可授予的已发布会员方案版本不存在");
    if (customer.customerType !== version.plan.targetType) throw new ConflictException("方案目标类型与会员类型不匹配");
    const row = await this.prisma.customerMembershipPlanAssignment.create({
      data: {
        tenantId, customerId: input.customerId, planId: version.planId, planVersionId: version.id,
        source, effectiveFrom, effectiveTo,
        reason: input.reason?.trim() || null, grantedBy: operator,
        snapshot: { planName: version.plan.name, targetType: version.plan.targetType, benefits: version.benefits } as Prisma.InputJsonValue
      }
    });
    return this.toAssignment(row);
  }

  async listPlanAssignments(tenantId: string, customerId: string): Promise<CustomerMembershipPlanAssignment[]> {
    await this.requireCustomer(tenantId, customerId);
    await this.requireMembership(tenantId, customerId);
    const rows = await this.prisma.customerMembershipPlanAssignment.findMany({
      where: { tenantId, customerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    const now = Date.now();
    return rows.map((row) => {
      const assignment = this.toAssignment(row);
      if (assignment.status === "active" && assignment.effectiveTo && new Date(assignment.effectiveTo).getTime() <= now) assignment.status = "expired";
      return assignment;
    });
  }

  async revokePlanAssignment(tenantId: string, assignmentId: string, reason: string, operator?: string) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new BadRequestException("撤销会员方案必须填写原因");
    const assignment = await this.prisma.customerMembershipPlanAssignment.findFirst({ where: { tenantId, id: assignmentId } });
    if (!assignment) throw new NotFoundException("会员方案授予记录不存在");
    if (assignment.status !== "active") throw new ConflictException("只有当前有效的会员方案授予可以撤销");
    const updated = await this.prisma.customerMembershipPlanAssignment.updateMany({
      where: { tenantId, id: assignment.id, status: "active" },
      data: { status: "revoked", revokedBy: operator, revokedAt: new Date(), revokeReason: trimmedReason }
    });
    if (updated.count !== 1) throw new ConflictException("会员方案授予已被其他操作撤销，请刷新后重试");
    const row = await this.prisma.customerMembershipPlanAssignment.findFirst({ where: { tenantId, id: assignment.id } });
    if (!row) throw new NotFoundException("会员方案授予记录不存在");
    return this.toAssignment(row);
  }

  /** 企业优惠资格判定的单一读模型，供后续报价/订单安全接入，不从旧企业表取权益。 */
  async resolveBenefits(tenantId: string, workspaceId: string, personalCustomerId: string, corporateCustomerId?: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    await this.requireWorkspace(tenantId, workspaceId, tx);
    await this.requireCustomer(tenantId, personalCustomerId, "personal", tx);
    const membership = await this.requireMembership(tenantId, personalCustomerId, tx);
    if (membership.status !== "active") throw new ConflictException("个人会员当前状态不允许使用权益");
    const now = new Date();
    const personal = await db.customerMembershipPlanAssignment.findFirst({
      where: { tenantId, customerId: personalCustomerId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    let corporate: CustomerMembershipPlanAssignment | undefined;
    if (corporateCustomerId) {
      await this.requireCustomer(tenantId, corporateCustomerId, "corporate", tx);
      const membership = await this.requireMembership(tenantId, corporateCustomerId, tx);
      if (membership.status !== "active") throw new ConflictException("企业会员当前状态不允许使用权益");
      const relation = await db.customerCorporateMembership.findFirst({
        where: { tenantId, corporateCustomerId, personalCustomerId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }
      });
      if (!relation) throw new ConflictException("该个人会员不是当前企业的有效员工，不能使用企业权益");
      const assignment = await db.customerMembershipPlanAssignment.findFirst({
        where: { tenantId, customerId: corporateCustomerId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      corporate = assignment ? this.toAssignment(assignment) : undefined;
    }
    return { personal: personal ? this.toAssignment(personal) : undefined, corporate };
  }

  /**
   * 订单域唯一允许的预约身份解析。个人永远是使用人与资质事实来源；企业只来自
   * 本租户有效员工关系，不能由管理端或 App 自报一个企业 id 来取得权益或主体。
   */
  async resolveBookingIdentity(
    tenantId: string,
    workspaceId: string,
    personalCustomerId: string,
    input?: RentalBookingIdentityInput,
    tx?: Prisma.TransactionClient
  ): Promise<RentalMembershipSnapshot> {
    const db = tx ?? this.prisma;
    if (tx) {
      await this.lockBookingCustomers(tenantId, personalCustomerId, input?.corporateCustomerId, tx);
      // Qualification-type writers serialize on this workspace. Acquire their
      // mutex before reading target capability acceptance, not afterwards at
      // inventory admission. This order remains customers -> workspace -> stock.
      const workspace = (await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
        SELECT id, status FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} FOR UPDATE
      `))[0];
      // WorkspaceStatus.ACTIVE is mapped to 'active' in MySQL. Raw SQL does
      // not apply Prisma's enum projection; frozen/disabled must still reject.
      if (!workspace || workspace.id !== workspaceId || workspace.status !== 'active') throw new ConflictException("经营空间不可用，不能核定新业务资格");
    }
    await this.requireWorkspace(tenantId, workspaceId, tx);
    const personal = await this.requireCustomer(tenantId, personalCustomerId, "personal", tx);
    const personalLink = await this.requireMembership(tenantId, personalCustomerId, tx);
    const [qualificationRows, targetTypes] = await Promise.all([
      db.customerQualificationRef.findMany({
        where: { tenantId, customerId: personalCustomerId }, include: { currentRevision: true }, orderBy: { qualificationType: "asc" }
      }),
      tx ? tx.$queryRaw<Prisma.CustomerMembershipQualificationTypeGetPayload<object>[]>(Prisma.sql`
        SELECT * FROM customer_membership_qualification_types
        WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND status = 'enabled' LOCK IN SHARE MODE
      `) : db.customerMembershipQualificationType.findMany({ where: { tenantId, workspaceId, status: "enabled" } })
    ]);
    const qualifications = qualificationRows.filter((row) => {
      const revision = row.currentRevision;
      // 历史无版本事实仍交给订单规则判定；有版本的当前事实必须与原审核快照一致。
      if (!row.currentRevisionId) return true;
      if (!revision || revision.id !== row.currentRevisionId || revision.tenantId !== tenantId
        || revision.customerId !== personalCustomerId || revision.qualificationType !== row.qualificationType
        || revision.qualificationStatus !== row.status || (row.status === "approved" && revision.reviewStatus !== "approved")) return false;
      const targetType = targetTypes.find((type) => type.code === row.qualificationType);
      // 来源品类/空间不是资格限制；通用证件可跨空间复用，专属能力须由目标声明接纳。
      const capability = this.toQualificationRevision(revision).applicableScope.capabilityCode;
      return capability || targetType?.capabilityCode ? capability === targetType?.capabilityCode : true;
    }).map((row) => this.toQualification(row));
    if (personalLink.status !== "active") throw new ConflictException("个人会员当前状态不允许新建订单");
    const bookingIdentity = input?.bookingIdentity ?? "personal";
    if (bookingIdentity === "personal") {
      if (input?.corporateCustomerId || input?.enterpriseContractAndPayer) {
        throw new BadRequestException("个人预约不能携带企业主体或企业付款选择");
      }
      const benefits = await this.resolveBenefits(tenantId, workspaceId, personalCustomerId, undefined, tx);
      return {
        bookingIdentity,
        personalCustomerId,
        personalCustomerName: personal.name,
        enterpriseContractAndPayer: false,
        benefitSource: "personal",
        personalPlan: benefits.personal,
        qualifications,
        resolvedAt: new Date().toISOString()
      };
    }
    const corporateCustomerId = input?.corporateCustomerId;
    if (!corporateCustomerId) throw new BadRequestException("企业员工预约必须选择企业会员");
    const corporate = await this.requireCustomer(tenantId, corporateCustomerId, "corporate", tx);
    const corporateLink = await this.requireMembership(tenantId, corporateCustomerId, tx);
    if (corporateLink.status !== "active") throw new ConflictException("企业会员当前状态不允许作为订单主体");
    const now = new Date();
    const relationship = await db.customerCorporateMembership.findFirst({
      where: {
        tenantId, corporateCustomerId, personalCustomerId, status: "active",
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
      }
    });
    if (!relationship) throw new ConflictException("该个人会员不是当前企业的有效员工，不能使用企业身份或权益");
    const benefits = await this.resolveBenefits(tenantId, workspaceId, personalCustomerId, corporateCustomerId, tx);
    return {
      bookingIdentity,
      personalCustomerId,
      personalCustomerName: personal.name,
      corporateCustomerId,
      corporateCustomerName: corporate.name,
      corporateMembershipId: relationship.id,
      enterpriseContractAndPayer: Boolean(input?.enterpriseContractAndPayer),
      benefitSource: "corporate",
      personalPlan: benefits.personal,
      corporatePlan: benefits.corporate,
      qualifications,
      resolvedAt: now.toISOString()
    };
  }

  /**
   * SHARED-QUAL-01：履约动作前重新解析会员事实，再按订单规则快照复核资格。
   *
   * 订单里的 membershipSnapshot 只解释下单时选了谁，不能当成当前授权；
   * 因此企业员工关系、租户会员状态和证件状态都必须从当前主档重读。
   */
  async assertBookingQualificationForAction(
    tenantId: string,
    workspaceId: string,
    snapshot: RentalMembershipSnapshot | undefined,
    rule: RentalRuleConfig["qualification"],
    action: RentalQualificationAction,
    window: RentalQualificationCheckWindow,
    tx?: Prisma.TransactionClient
  ) {
    await this.requireWorkspace(tenantId, workspaceId, tx);
    if (!snapshot && !rule.required) return { ok: true as const };
    if (!snapshot) {
      throw new ConflictException(`${this.qualificationActionLabel(action)}不能继续：订单缺少会员资格快照，请先人工核验`);
    }

    const current = await this.resolveBookingIdentity(tenantId, workspaceId, snapshot.personalCustomerId, {
      bookingIdentity: snapshot.bookingIdentity,
      corporateCustomerId: snapshot.corporateCustomerId,
      enterpriseContractAndPayer: snapshot.enterpriseContractAndPayer
    }, tx);
    if (current.corporateMembershipId !== snapshot.corporateMembershipId || current.bookingIdentity !== snapshot.bookingIdentity
      || current.corporateCustomerId !== snapshot.corporateCustomerId || current.enterpriseContractAndPayer !== snapshot.enterpriseContractAndPayer) {
      throw new ConflictException("原企业预约关系已变化，不能将后继新关系当作原订单授权");
    }
    if (!rule.required) return { ok: true as const };
    const result = evaluateRentalQualification(current.qualifications, rule, window);
    if (!result.ok) throw new ConflictException(`${this.qualificationActionLabel(action)}资格校验未通过：${result.message}`);
    return { ok: true as const, qualificationType: result.qualificationType };
  }

  private qualificationActionLabel(action: RentalQualificationAction) {
    return action === "submit" ? "订单提交" : action === "pickup" ? "领取" : "续租";
  }

  async listBookingOptions(tenantId: string, workspaceId: string, personalCustomerId: string,
    page?: { limit: number; cursor?: string }): Promise<CustomerMembershipBookingOption[]> {
    page = page === undefined ? undefined : structuredClone(page);
    if (page && (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50
      || page.cursor !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(page.cursor))) {
      throw new BadRequestException("预约身份分页参数无效");
    }
    await this.requireWorkspace(tenantId, workspaceId);
    await this.assertPersonalBookingCustomerVisible(tenantId, workspaceId, personalCustomerId);
    await this.requireCustomer(tenantId, personalCustomerId, "personal");
    await this.requireMembership(tenantId, personalCustomerId);
    const now = new Date();
    const rows = await this.prisma.customerCorporateMembership.findMany({
      where: {
        tenantId, personalCustomerId, status: "active", effectiveFrom: { lte: now },
        ...(page?.cursor ? { id: { lt: page.cursor } } : {}),
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        corporateCustomer: { tenantId, customerType: "corporate", mergedIntoCustomerId: null, membership: { is: { status: "active" } } }
      },
      include: { corporateCustomer: { select: { name: true } } },
      orderBy: page ? [{ id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }],
      ...(page ? { take: page.limit + 1 } : {})
    });
    return rows.map((row) => ({
      corporateCustomerId: row.corporateCustomerId,
      corporateCustomerName: row.corporateCustomer.name,
      corporateMembershipId: row.id,
      role: row.role as CustomerMembershipBookingOption["role"],
      effectiveTo: row.effectiveTo?.toISOString()
    }));
  }

  /** Same visible member and current corporate relationship facts as the
   * manual booking endpoint, with a database bound and stable ID cursor. */
  async listBookingOptionsPage(tenantId: string, workspaceId: string, personalCustomerId: string,
    input: { limit: number; cursor?: string }) {
    const page = structuredClone(input);
    const options = await this.listBookingOptions(tenantId, workspaceId, personalCustomerId, page);
    const truncated = options.length > page.limit;
    const rows = options.slice(0, page.limit);
    return { rows, truncated, ...(truncated && rows.length ? { nextCursor: rows[rows.length - 1].corporateMembershipId } : {}) };
  }

  private normalizeBenefitScope(scope: unknown): NonNullable<CustomerMembershipBenefit["scope"]> {
    if (scope === undefined) return { type: "tenant" };
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new BadRequestException("权益适用范围必须是对象");
    const value = scope as Record<string, unknown>;
    const allowedKeys = value.type === "tenant" ? ["type"] : value.type === "workspaces" ? ["type", "workspaceIds"] : value.type === "categories" ? ["type", "categoryCodes"] : [];
    if (!allowedKeys.length || Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new BadRequestException("权益适用范围结构无效");
    if (value.type === "tenant") return { type: "tenant" };
    if (value.type === "workspaces") {
      return { type: "workspaces", workspaceIds: this.normalizeScopeValues(value.workspaceIds, "经营空间") };
    }
    const categoryCodes = this.normalizeScopeValues(value.categoryCodes, "租赁品类");
    if (categoryCodes.some((code) => !isRentalCategoryCode(code))) {
      throw new BadRequestException("权益适用范围包含无效租赁品类");
    }
    return { type: "categories", categoryCodes };
  }

  private normalizeScopeValues(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
      throw new BadRequestException(`指定${label}范围必须填写非空列表`);
    }
    return [...new Set(value.map((entry: string) => entry.trim()))];
  }

  private async normalizeBenefits(tenantId: string, benefits: CustomerMembershipBenefit[], db: PrismaService | Prisma.TransactionClient = this.prisma): Promise<CustomerMembershipBenefit[]> {
    if (!Array.isArray(benefits)) throw new BadRequestException("会员权益必须是数组");
    const result: CustomerMembershipBenefit[] = [];
    const workspaceIds = new Set<string>();
    const serviceIds = new Set<string>();
    const categoryCodes = new Set<string>();
    for (const benefit of benefits) {
      if (!benefit || typeof benefit !== "object" || Array.isArray(benefit)
        || !["rental_discount", "deposit_reduction", "preauth_reduction", "service_benefit", "priority_reservation", "quote_validity_extension"].includes(benefit.type)
        || !["percentage", "amount", "quota", "priority"].includes(benefit.calculation)
        || !Number.isFinite(benefit.value) || benefit.value < 0
        || (benefit.calculation === "percentage" && benefit.value > 100)
        || (benefit.maximum !== undefined && (!Number.isFinite(benefit.maximum) || benefit.maximum < 0))) {
        throw new BadRequestException("会员权益类型、计算方式或数值无效");
      }
      const scope = this.normalizeBenefitScope(benefit.scope);
      if (scope.type === "workspaces") scope.workspaceIds.forEach((id) => workspaceIds.add(id));
      if (scope.type === "categories") scope.categoryCodes.forEach((code) => categoryCodes.add(code));
      let applicableServiceIds: string[] | undefined;
      if (benefit.applicableServiceIds !== undefined) {
        if (!Array.isArray(benefit.applicableServiceIds) || benefit.applicableServiceIds.some((id) => typeof id !== "string" || !id.trim())) {
          throw new BadRequestException("指定服务必须是服务ID列表");
        }
        applicableServiceIds = [...new Set(benefit.applicableServiceIds.map((id) => id.trim()))];
        applicableServiceIds.forEach((id) => serviceIds.add(id));
      }
      result.push({ ...benefit, scope, ...(applicableServiceIds ? { applicableServiceIds } : {}) });
    }
    await assertPublishedRentalCategoryIdentities(db, [...categoryCodes]);
    if (workspaceIds.size) {
      const count = await db.businessWorkspace.count({ where: { tenantId, id: { in: [...workspaceIds] } } });
      if (count !== workspaceIds.size) throw new BadRequestException("权益范围包含不存在或不属于本租户的经营空间");
    }
    if (serviceIds.size) {
      // 服务可来自本租户任一空间；不能用当前空间把合法跨空间方案排除。
      const count = await db.rentalValueAddedService.count({ where: { tenantId, id: { in: [...serviceIds] } } });
      if (count !== serviceIds.size) throw new BadRequestException("会员权益包含不存在或不属于本租户的服务");
    }
    return result;
  }

  private planVersionData(input: SaveCustomerMembershipPlanRequest) {
    return {
      levelRank: input.levelRank, isDefault: input.isDefault ?? false, isRecommended: input.isRecommended ?? false,
      appVisible: input.appVisible ?? false, effectiveFrom: dateOrUndefined(input.effectiveFrom), effectiveTo: dateOrUndefined(input.effectiveTo),
      eligibility: (input.eligibility ?? {}) as Prisma.InputJsonValue,
      benefits: input.benefits as unknown as Prisma.InputJsonValue
    };
  }

  private toReview(row: PrismaMembershipReview, customerName?: string, qualificationRevision?: Prisma.CustomerQualificationRevisionGetPayload<{}>): CustomerMembershipReview {
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload as Prisma.JsonObject
      : undefined;
    const corporateSnapshot = payload?.corporateSnapshot && typeof payload.corporateSnapshot === "object" && !Array.isArray(payload.corporateSnapshot)
      ? payload.corporateSnapshot as unknown as CustomerMembershipReview["corporateSnapshot"]
      : undefined;
    return {
      id: row.id, tenantId: row.tenantId, sourceWorkspaceId: row.sourceWorkspaceId ?? undefined, customerId: row.customerId, customerName,
      reviewType: row.reviewType as CustomerMembershipReview["reviewType"], qualificationType: row.qualificationType ?? undefined,
      status: row.status as CustomerMembershipReview["status"], channel: row.channel, reason: row.reason ?? undefined,
      reviewedBy: row.reviewedBy ?? undefined, reviewedAt: row.reviewedAt?.toISOString(),
      qualificationSnapshot: qualificationRevision ? this.toQualificationRevision(qualificationRevision) : undefined,
      corporateSnapshot,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    };
  }

  private toQualification(row: {
    id: string; customerId: string; qualificationType: string; referenceNoMasked: string | null; issuedAt: Date | null;
    expiresAt: Date | null; status: string; source: string; evidenceRef: string | null; verifiedAt: Date | null; createdAt: Date; updatedAt: Date;
  }): CustomerQualificationRef {
    const status: CustomerQualificationStatus = row.status === "approved" && row.expiresAt && row.expiresAt.getTime() <= Date.now()
      ? "expired"
      : row.status as CustomerQualificationStatus;
    return {
      id: row.id, customerId: row.customerId, qualificationType: row.qualificationType, referenceNoMasked: row.referenceNoMasked ?? undefined,
      issuedAt: row.issuedAt?.toISOString(), expiresAt: row.expiresAt?.toISOString(), status, source: row.source,
      evidenceRef: row.evidenceRef ?? undefined, verifiedAt: row.verifiedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    };
  }

  private toQualificationRevision(row: {
    id: string; tenantId: string; workspaceId: string; customerId: string; qualificationType: string; categoryCode: string;
    capabilityCode: string | null; applicableScope: Prisma.JsonValue; referenceNoMasked: string | null; issuedAt: Date | null;
    expiresAt: Date | null; evidenceRef: string | null; source: string; submittedBy: string | null; submittedAt: Date;
    qualificationStatus: string; reviewStatus: string; reviewReason: string | null; reviewedBy: string | null;
    reviewedAt: Date | null; reviewId: string | null; createdAt: Date;
  }): CustomerQualificationRevision {
    const scope = (row.applicableScope ?? {}) as { workspaceId?: string; categoryCode?: string; capabilityCode?: string; requiredForBooking?: boolean };
    return {
      id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, customerId: row.customerId,
      qualificationType: row.qualificationType, categoryCode: readRentalCategoryCode(row.categoryCode),
      capabilityCode: row.capabilityCode ?? undefined,
      applicableScope: {
        workspaceId: scope.workspaceId ?? row.workspaceId,
        categoryCode: readRentalCategoryCode(scope.categoryCode ?? row.categoryCode),
        capabilityCode: scope.capabilityCode ?? row.capabilityCode ?? undefined,
        requiredForBooking: Boolean(scope.requiredForBooking)
      },
      referenceNoMasked: row.referenceNoMasked ?? undefined, issuedAt: row.issuedAt?.toISOString(), expiresAt: row.expiresAt?.toISOString(),
      evidenceRef: row.evidenceRef ?? undefined, source: row.source, submittedBy: row.submittedBy ?? undefined,
      submittedAt: row.submittedAt.toISOString(), qualificationStatus: row.qualificationStatus as CustomerQualificationRevision["qualificationStatus"],
      reviewStatus: row.reviewStatus as CustomerQualificationRevision["reviewStatus"], reviewReason: row.reviewReason ?? undefined,
      reviewedBy: row.reviewedBy ?? undefined, reviewedAt: row.reviewedAt?.toISOString(), reviewId: row.reviewId ?? undefined,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toCorporateMembership(row: {
    id: string; corporateCustomerId: string; personalCustomerId: string; role: string; department: string | null; employeeNo: string | null;
    status: string; effectiveFrom: Date; effectiveTo: Date | null; reason: string | null; createdAt: Date; updatedAt: Date;
  }, personalCustomerName?: string): CustomerCorporateMembership {
    return {
      id: row.id, corporateCustomerId: row.corporateCustomerId, personalCustomerId: row.personalCustomerId, personalCustomerName,
      role: row.role as CustomerCorporateMembership["role"], department: row.department ?? undefined, employeeNo: row.employeeNo ?? undefined,
      status: row.status as CustomerCorporateMembership["status"], effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString(),
      reason: row.reason ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    };
  }

  private toPlan(row: {
    id: string; tenantId: string; code: string; name: string; targetType: string; status: string; createdAt: Date; updatedAt: Date;
    versions: Array<{ id: string; planId: string; version: number; status: string; levelRank: number; isDefault: boolean; isRecommended: boolean; appVisible: boolean; effectiveFrom: Date | null; effectiveTo: Date | null; eligibility: Prisma.JsonValue; benefits: Prisma.JsonValue; createdAt: Date; updatedAt: Date; publishedAt: Date | null; disabledBy: string | null; disabledAt: Date | null; disableReason: string | null; restoredFromVersionId: string | null; restoreReason: string | null }>;
  }): CustomerMembershipPlan {
    const versions = row.versions.map((version) => this.toPlanVersion(version));
    return {
      id: row.id, tenantId: row.tenantId, code: row.code, name: row.name,
      targetType: row.targetType as CustomerMembershipPlan["targetType"], status: row.status as CustomerMembershipPlan["status"],
      // 管理端必须先看到最新草稿，才能发布它；只回传已发布版会把「保存后生成的 v2 草稿」藏掉，
      // 造成方案处于 active 却无法发布下一版本的假死状态。
      currentVersion: versions[0], versions,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    };
  }

  private toPlanVersion(row: { id: string; planId: string; version: number; status: string; levelRank: number; isDefault: boolean; isRecommended: boolean; appVisible: boolean; effectiveFrom: Date | null; effectiveTo: Date | null; eligibility: Prisma.JsonValue; benefits: Prisma.JsonValue; createdAt: Date; updatedAt: Date; publishedAt: Date | null; disabledBy: string | null; disabledAt: Date | null; disableReason: string | null; restoredFromVersionId: string | null; restoreReason: string | null }): CustomerMembershipPlanVersion {
    return {
      id: row.id, planId: row.planId, version: row.version, status: row.status as CustomerMembershipPlanVersion["status"], levelRank: row.levelRank,
      isDefault: row.isDefault, isRecommended: row.isRecommended, appVisible: row.appVisible, effectiveFrom: row.effectiveFrom?.toISOString(), effectiveTo: row.effectiveTo?.toISOString(),
      eligibility: (row.eligibility ?? {}) as Record<string, unknown>, benefits: (row.benefits ?? []) as unknown as CustomerMembershipPlanVersion["benefits"],
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), publishedAt: row.publishedAt?.toISOString(),
      disabledBy: row.disabledBy ?? undefined, disabledAt: row.disabledAt?.toISOString(), disableReason: row.disableReason ?? undefined,
      restoredFromVersionId: row.restoredFromVersionId ?? undefined, restoreReason: row.restoreReason ?? undefined
    };
  }

  private toAssignment(row: { id: string; customerId: string; planId: string; planVersionId: string; source: string; status: string; effectiveFrom: Date; effectiveTo: Date | null; reason: string | null; revokedBy: string | null; revokedAt: Date | null; revokeReason: string | null; snapshot: Prisma.JsonValue; createdAt: Date }): CustomerMembershipPlanAssignment {
    return {
      id: row.id, customerId: row.customerId, planId: row.planId, planVersionId: row.planVersionId,
      source: row.source as CustomerMembershipPlanAssignment["source"], status: row.status as CustomerMembershipPlanAssignment["status"],
      effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString(), reason: row.reason ?? undefined,
      revokedBy: row.revokedBy ?? undefined, revokedAt: row.revokedAt?.toISOString(), revokeReason: row.revokeReason ?? undefined,
      snapshot: row.snapshot as unknown as CustomerMembershipPlanAssignment["snapshot"], createdAt: row.createdAt.toISOString()
    };
  }
}
