import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type CustomerMembershipReview as PrismaMembershipReview } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import type {
  AssignCustomerMembershipPlanRequest,
  CorporateMembershipMember,
  CustomerCorporateMembership,
  CustomerMembershipPlan,
  CustomerMembershipPlanAssignment,
  CustomerMembershipPlanVersion,
  CustomerMembershipQualificationType,
  CustomerMembershipRegistrationSettings,
  CustomerMembershipReview,
  CustomerMembershipBookingOption,
  CustomerQualificationRef,
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
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import { evaluateRentalQualification, type RentalQualificationAction, type RentalQualificationCheckWindow } from "../rental-core/rental-qualification";

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

/**
 * MEMBER-01 的新体系服务。
 *
 * 这个服务只操作 CustomerProfile / CustomerAccount / CustomerWorkspaceLink 及其新扩展表；
 * 不读取、不写入旧 Member 或 MembershipPlan。旧表尚保留是为了让已有门市订单能安全退役，
 * 而不是允许新旧体系双写。
 */
@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
  }

  private async requireWorkspace(tenantId: string, workspaceId: string) {
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId, id: workspaceId },
      select: { id: true, categoryCode: true }
    });
    if (!workspace) throw new NotFoundException("当前经营空间不存在或不属于本租户");
    return workspace;
  }

  private async requireCustomer(tenantId: string, customerId: string, expectedType?: "personal" | "corporate") {
    const customer = await this.prisma.customerProfile.findFirst({ where: { tenantId, id: customerId } });
    if (!customer) throw new NotFoundException("客户不存在");
    if (expectedType && customer.customerType !== expectedType) {
      throw new ConflictException(expectedType === "personal" ? "必须选择个人会员" : "必须选择企业会员");
    }
    return customer;
  }

  private async requireWorkspaceLink(tenantId: string, workspaceId: string, customerId: string) {
    const link = await this.prisma.customerWorkspaceLink.findFirst({ where: { tenantId, workspaceId, customerId } });
    if (!link) throw new ConflictException("该客户尚未接入当前经营空间");
    return link;
  }

  /**
   * 供订单/营销等共享业务在写入空间级事实前复用同一条会员范围校验。
   * 客户主档属于租户，但优惠券、奖励和预约权益属于经营空间，不能只凭
   * tenantId + customerId 就把事实写入当前空间。
   */
  async assertCustomerInWorkspace(tenantId: string, workspaceId: string, customerId: string) {
    await this.requireCustomer(tenantId, customerId);
    return this.requireWorkspaceLink(tenantId, workspaceId, customerId);
  }

  async getRegistrationSettings(tenantId: string, workspaceId: string): Promise<CustomerMembershipRegistrationSettings> {
    await this.requireWorkspace(tenantId, workspaceId);
    const row = await this.prisma.customerMembershipRegistrationSettings.findFirst({ where: { tenantId, workspaceId } });
    return {
      registrationMode: (row?.registrationMode ?? "manual") as CustomerMembershipRegistrationSettings["registrationMode"],
      updatedAt: row?.updatedAt.toISOString()
    };
  }

  async saveRegistrationSettings(
    tenantId: string,
    workspaceId: string,
    registrationMode: CustomerMembershipRegistrationSettings["registrationMode"]
  ) {
    await this.requireWorkspace(tenantId, workspaceId);
    const row = await this.prisma.customerMembershipRegistrationSettings.upsert({
      where: { workspaceId },
      create: { tenantId, workspaceId, registrationMode },
      update: { registrationMode }
    });
    return { registrationMode: row.registrationMode as CustomerMembershipRegistrationSettings["registrationMode"], updatedAt: row.updatedAt.toISOString() };
  }

  async registerPersonal(
    tenantId: string,
    workspaceId: string,
    input: RegisterPersonalMembershipRequest,
    operator?: string,
    canDirectApprove = false,
    canManageAccount = false
  ) {
    await this.requireWorkspace(tenantId, workspaceId);
    if (input.channel === "app" && input.directApprove) {
      throw new BadRequestException("APP 注册不能请求后台直接通过");
    }
    if (input.directApprove && !canDirectApprove) {
      throw new ConflictException("当前账号无权直接通过注册审核");
    }
    if (input.temporaryPassword && !canManageAccount) {
      throw new ForbiddenException("当前账号无权设置会员临时密码");
    }
    const registration = await this.getRegistrationSettings(tenantId, workspaceId);
    const automatic = registration.registrationMode === "automatic" || (input.channel === "admin" && input.directApprove);
    const phone = input.phone.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      let customer = await tx.customerProfile.findFirst({ where: { tenantId, phone } });
      if (customer && customer.customerType !== "personal") {
        throw new ConflictException("该手机号已绑定企业客户，不能作为个人会员注册");
      }
      if (!customer) {
        customer = await tx.customerProfile.create({
          data: {
            tenantId,
            customerType: "personal",
            name: input.name.trim(),
            phone,
            phoneMasked: mask(phone) ?? "****",
            email: input.email?.trim() || null,
            identityVerified: false,
            identityNoMasked: mask(input.identityNo),
            qualifications: {}
          }
        });
      }
      const link = await tx.customerWorkspaceLink.upsert({
        where: { workspaceId_customerId: { workspaceId, customerId: customer.id } },
        create: {
          tenantId,
          workspaceId,
          customerId: customer.id,
          levelName: "普通会员",
          status: automatic ? "active" : "pending_activation"
        },
        update: automatic ? { status: "active" } : {}
      });
      if (input.temporaryPassword) {
        await tx.customerAccount.upsert({
          where: { tenantId_customerId: { tenantId, customerId: customer.id } },
          create: {
            tenantId,
            customerId: customer.id,
            loginPhone: phone,
            loginPhoneMasked: mask(phone) ?? "****",
            status: "active",
            passwordHash: this.hashPassword(input.temporaryPassword),
            passwordUpdatedAt: new Date(),
            mustChangePassword: true,
            lastReason: "后台创建临时密码",
            lastOperator: operator
          },
          update: {
            passwordHash: this.hashPassword(input.temporaryPassword),
            passwordUpdatedAt: new Date(),
            mustChangePassword: true,
            lastReason: "后台重置临时密码",
            lastOperator: operator
          }
        });
      }
      let review: PrismaMembershipReview | undefined;
      if (!automatic) {
        if (input.idempotencyKey) {
          review = await tx.customerMembershipReview.findFirst({
            where: { tenantId, workspaceId, requestKey: input.idempotencyKey }
          }) ?? undefined;
        }
        if (!review) {
          review = await tx.customerMembershipReview.create({
            data: {
              tenantId,
              workspaceId,
              customerId: customer.id,
              reviewType: "registration",
              status: "pending",
              channel: input.channel,
              requestKey: input.idempotencyKey?.trim() || null,
              payload: { name: input.name.trim(), email: input.email?.trim() || undefined } as Prisma.InputJsonValue
            }
          });
        }
      }
      return { customerId: customer.id, membershipStatus: link.status, review };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      customerId: result.customerId,
      membershipStatus: result.membershipStatus,
      review: result.review ? this.toReview(result.review) : undefined
    };
  }

  async listReviews(tenantId: string, workspaceId: string, status?: string, type?: string): Promise<CustomerMembershipReview[]> {
    const rows = await this.prisma.customerMembershipReview.findMany({
      where: { tenantId, workspaceId, ...(status ? { status } : {}), ...(type ? { reviewType: type } : {}) },
      include: { customer: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    });
    return rows.map((row) => this.toReview(row, row.customer.name));
  }

  async review(
    tenantId: string,
    workspaceId: string,
    reviewId: string,
    input: ReviewCustomerMembershipRequest,
    operator?: string,
    permissions: { registration: boolean; qualification: boolean } = { registration: false, qualification: false }
  ) {
    const reason = input.reason?.trim();
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const review = await tx.customerMembershipReview.findFirst({ where: { tenantId, workspaceId, id: reviewId } });
      if (!review) throw new NotFoundException("审核任务不存在");
      if (review.reviewType === "registration" && !permissions.registration) throw new ForbiddenException("当前账号无权处理注册审核");
      if (review.reviewType === "qualification" && !permissions.qualification) throw new ForbiddenException("当前账号无权处理证件审核");
      if (review.status !== "pending" && review.status !== "supplement_required") {
        throw new ConflictException("审核任务已处理，不能重复审核");
      }
      if (input.status !== "approved" && !reason) {
        throw new BadRequestException("拒绝、补件或取消审核必须填写原因");
      }
      const updated = await tx.customerMembershipReview.update({
        where: { id: review.id },
        data: { status: input.status, reason: reason || null, reviewedBy: operator, reviewedAt: now }
      });
      if (review.reviewType === "registration" && input.status === "approved") {
        await tx.customerWorkspaceLink.updateMany({
          where: { tenantId, workspaceId, customerId: review.customerId, status: "pending_activation" },
          data: { status: "active" }
        });
      }
      if (review.reviewType === "qualification" && review.qualificationType) {
        const qualificationStatus: CustomerQualificationStatus = input.status === "approved"
          ? "approved"
          : input.status === "rejected"
            ? "rejected"
            : "pending";
        await tx.customerQualificationRef.updateMany({
          where: { tenantId, customerId: review.customerId, qualificationType: review.qualificationType },
          data: { status: qualificationStatus, verifiedAt: input.status === "approved" ? now : null }
        });
      }
      return updated;
    });
    return this.toReview(result);
  }

  async listQualificationTypes(tenantId: string, workspaceId: string): Promise<CustomerMembershipQualificationType[]> {
    return (await this.prisma.customerMembershipQualificationType.findMany({
      where: { tenantId, workspaceId }, orderBy: [{ status: "asc" }, { name: "asc" }]
    })).map((row) => ({
      id: row.id, workspaceId: row.workspaceId, code: row.code, name: row.name,
      categoryCode: row.categoryCode as CustomerMembershipQualificationType["categoryCode"],
      capabilityCode: row.capabilityCode ?? undefined, requiredForBooking: row.requiredForBooking,
      status: row.status as CustomerMembershipQualificationType["status"],
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    }));
  }

  async saveQualificationType(tenantId: string, workspaceId: string, input: SaveCustomerMembershipQualificationTypeRequest) {
    const workspace = await this.requireWorkspace(tenantId, workspaceId);
    const existing = input.id
      ? await this.prisma.customerMembershipQualificationType.findFirst({ where: { tenantId, workspaceId, id: input.id } })
      : undefined;
    if (input.id && !existing) throw new NotFoundException("证件类型不存在");
    const row = existing
      ? await this.prisma.customerMembershipQualificationType.update({
          where: { id: existing.id },
          data: { code: input.code.trim(), name: input.name.trim(), capabilityCode: input.capabilityCode?.trim() || null, requiredForBooking: input.requiredForBooking ?? false, status: input.status ?? "enabled" }
        })
      : await this.prisma.customerMembershipQualificationType.create({
          data: { tenantId, workspaceId, code: input.code.trim(), name: input.name.trim(), categoryCode: workspace.categoryCode, capabilityCode: input.capabilityCode?.trim() || null, requiredForBooking: input.requiredForBooking ?? false, status: input.status ?? "enabled" }
        });
    return (await this.listQualificationTypes(tenantId, workspaceId)).find((item) => item.id === row.id)!;
  }

  async submitQualification(tenantId: string, workspaceId: string, customerId: string, input: SubmitCustomerQualificationRequest, channel: "admin" | "app", operator?: string) {
    await this.requireCustomer(tenantId, customerId, "personal");
    await this.requireWorkspaceLink(tenantId, workspaceId, customerId);
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
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const qualification = await tx.customerQualificationRef.upsert({
        where: { tenantId_customerId_qualificationType: { tenantId, customerId, qualificationType: input.qualificationType } },
        create: {
          tenantId, customerId, qualificationType: input.qualificationType,
          referenceNoMasked: mask(input.referenceNo), issuedAt,
          expiresAt, evidenceRef: input.evidenceRef?.trim() || null, status: "pending"
        },
        update: {
          referenceNoMasked: mask(input.referenceNo), issuedAt,
          expiresAt, evidenceRef: input.evidenceRef?.trim() || null, status: "pending", verifiedAt: null
        }
      });
      const review = await tx.customerMembershipReview.create({
        data: {
          tenantId, workspaceId, customerId, reviewType: "qualification", qualificationType: input.qualificationType,
          status: "pending", channel, payload: { evidenceRef: input.evidenceRef?.trim() || undefined, submittedBy: operator } as Prisma.InputJsonValue
        }
      });
      return { qualification, review, now };
    });
    return { qualification: this.toQualification(result.qualification), review: this.toReview(result.review) };
  }

  async listPersonalMembers(tenantId: string, workspaceId: string): Promise<PersonalMembershipMember[]> {
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId, customerType: "personal", workspaceLinks: { some: { tenantId, workspaceId } } },
      include: {
        workspaceLinks: { where: { tenantId, workspaceId }, take: 1 },
        account: { select: { status: true, loginPhoneMasked: true, suspendedAt: true, closedAt: true } },
        qualificationRefs: { where: { tenantId }, orderBy: { qualificationType: "asc" } }
      },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => {
      const link = row.workspaceLinks[0]!;
      return {
        customerId: row.id, name: row.name, phoneMasked: row.phoneMasked, email: row.email ?? undefined,
        identityNoMasked: row.identityNoMasked ?? undefined, membershipStatus: link.status as PersonalMembershipMember["membershipStatus"],
        levelName: link.levelName,
        account: row.account
          ? { provisioned: true, status: row.account.status as PersonalMembershipMember["account"]["status"], loginPhoneMasked: row.account.loginPhoneMasked, suspendedAt: row.account.suspendedAt?.toISOString(), closedAt: row.account.closedAt?.toISOString() }
          : { provisioned: false },
        qualifications: row.qualificationRefs.map((qualification) => this.toQualification(qualification)),
        createdAt: row.createdAt.toISOString()
      };
    });
  }

  async savePersonalMember(tenantId: string, workspaceId: string, customerId: string, input: SavePersonalMembershipRequest) {
    await this.requireWorkspaceLink(tenantId, workspaceId, customerId);
    const customer = await this.requireCustomer(tenantId, customerId, "personal");
    const phone = input.phone?.trim() || customer.phone;
    if (phone !== customer.phone) {
      const duplicate = await this.prisma.customerProfile.findFirst({ where: { tenantId, phone, id: { not: customerId } }, select: { id: true } });
      if (duplicate) throw new ConflictException("该手机号已被其他客户主档使用");
    }
    const row = await this.prisma.customerProfile.update({
      where: { id: customer.id },
      data: {
        name: input.name.trim(), phone, phoneMasked: mask(phone) ?? "****", email: input.email?.trim() || null,
        ...(input.identityNo === undefined ? {} : { identityNoMasked: mask(input.identityNo) })
      }
    });
    await this.prisma.customerAccount.updateMany({
      where: { tenantId, customerId }, data: { loginPhone: phone, loginPhoneMasked: mask(phone) ?? "****" }
    });
    return { customerId: row.id, name: row.name, phoneMasked: row.phoneMasked, email: row.email ?? undefined, identityNoMasked: row.identityNoMasked ?? undefined };
  }

  async setTemporaryPassword(tenantId: string, workspaceId: string, customerId: string, temporaryPassword: string, operator?: string) {
    await this.requireWorkspaceLink(tenantId, workspaceId, customerId);
    const customer = await this.requireCustomer(tenantId, customerId, "personal");
    const account = await this.prisma.customerAccount.upsert({
      where: { tenantId_customerId: { tenantId, customerId } },
      create: {
        tenantId, customerId, loginPhone: customer.phone, loginPhoneMasked: customer.phoneMasked, status: "active",
        passwordHash: this.hashPassword(temporaryPassword), passwordUpdatedAt: new Date(), mustChangePassword: true,
        lastReason: "管理员设置临时密码", lastOperator: operator
      },
      update: {
        passwordHash: this.hashPassword(temporaryPassword), passwordUpdatedAt: new Date(), mustChangePassword: true,
        lastReason: "管理员重置临时密码", lastOperator: operator
      }
    });
    return { provisioned: true, status: account.status, loginPhoneMasked: account.loginPhoneMasked, mustChangePassword: account.mustChangePassword };
  }

  async listCorporateMembers(tenantId: string, workspaceId: string): Promise<CorporateMembershipMember[]> {
    const now = new Date();
    const rows = await this.prisma.customerProfile.findMany({
      where: { tenantId, customerType: "corporate", workspaceLinks: { some: { tenantId, workspaceId } } },
      include: {
        workspaceLinks: { where: { tenantId, workspaceId }, take: 1 },
        corporateMembershipsAsCompany: {
          where: { tenantId, workspaceId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
          select: { role: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => ({
      customerId: row.id, name: row.name, corporateName: row.corporateName ?? undefined, phoneMasked: row.phoneMasked,
      membershipStatus: row.workspaceLinks[0]!.status as CorporateMembershipMember["membershipStatus"],
      employeeCount: row.corporateMembershipsAsCompany.length,
      adminCount: row.corporateMembershipsAsCompany.filter((item) => item.role === "admin").length,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async saveCorporateMember(tenantId: string, workspaceId: string, input: SaveCorporateMembershipRequest) {
    await this.requireWorkspace(tenantId, workspaceId);
    const phone = input.phone?.trim();
    if (input.id) {
      await this.requireWorkspaceLink(tenantId, workspaceId, input.id);
      const customer = await this.requireCustomer(tenantId, input.id, "corporate");
      const nextPhone = phone || customer.phone;
      if (nextPhone !== customer.phone) {
        const duplicate = await this.prisma.customerProfile.findFirst({ where: { tenantId, phone: nextPhone, id: { not: customer.id } }, select: { id: true } });
        if (duplicate) throw new ConflictException("该手机号已被其他客户主档使用");
      }
      const row = await this.prisma.customerProfile.update({
        where: { id: customer.id },
        data: { name: input.name.trim(), phone: nextPhone, phoneMasked: mask(nextPhone) ?? "****", email: input.email?.trim() || null, corporateName: input.corporateName.trim(), corporateTaxNo: input.corporateTaxNo?.trim() || null }
      });
      return (await this.listCorporateMembers(tenantId, workspaceId)).find((item) => item.customerId === row.id)!;
    }
    if (!phone) throw new BadRequestException("新建企业会员必须填写联系电话");
    const duplicate = await this.prisma.customerProfile.findFirst({ where: { tenantId, phone }, select: { id: true } });
    if (duplicate) throw new ConflictException("该手机号已被其他客户主档使用");
    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerProfile.create({
        data: { tenantId, customerType: "corporate", name: input.name.trim(), phone, phoneMasked: mask(phone) ?? "****", email: input.email?.trim() || null, qualifications: {}, corporateName: input.corporateName.trim(), corporateTaxNo: input.corporateTaxNo?.trim() || null }
      });
      await tx.customerWorkspaceLink.create({ data: { tenantId, workspaceId, customerId: created.id, levelName: "企业会员", status: "active" } });
      return created;
    });
    return (await this.listCorporateMembers(tenantId, workspaceId)).find((item) => item.customerId === customer.id)!;
  }

  async listCorporateEmployees(tenantId: string, workspaceId: string, corporateCustomerId: string): Promise<CustomerCorporateMembership[]> {
    await this.requireCustomer(tenantId, corporateCustomerId, "corporate");
    await this.requireWorkspaceLink(tenantId, workspaceId, corporateCustomerId);
    const rows = await this.prisma.customerCorporateMembership.findMany({
      where: { tenantId, workspaceId, corporateCustomerId },
      include: { personalCustomer: { select: { name: true } } }, orderBy: [{ role: "asc" }, { createdAt: "desc" }]
    });
    return rows.map((row) => this.toCorporateMembership(row, row.personalCustomer.name));
  }

  async saveCorporateEmployee(tenantId: string, workspaceId: string, corporateCustomerId: string, input: SaveCustomerCorporateMembershipRequest, operator?: string) {
    await this.requireCustomer(tenantId, corporateCustomerId, "corporate");
    await this.requireWorkspaceLink(tenantId, workspaceId, corporateCustomerId);
    await this.requireCustomer(tenantId, input.personalCustomerId, "personal");
    const personalLink = await this.requireWorkspaceLink(tenantId, workspaceId, input.personalCustomerId);
    if (personalLink.status !== "active") throw new ConflictException("只有当前空间的有效个人会员才能加入企业");
    if (corporateCustomerId === input.personalCustomerId) throw new BadRequestException("企业不能将自身作为员工");
    const effectiveFrom = dateOrUndefined(input.effectiveFrom) ?? new Date();
    const effectiveTo = dateOrUndefined(input.effectiveTo);
    if ([effectiveFrom, effectiveTo].some((value) => value && Number.isNaN(value.getTime()))) {
      throw new BadRequestException("员工关系有效期格式无效");
    }
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException("员工关系失效时间不能早于生效时间");
    const row = await this.prisma.customerCorporateMembership.upsert({
      where: { workspaceId_corporateCustomerId_personalCustomerId: { workspaceId, corporateCustomerId, personalCustomerId: input.personalCustomerId } },
      create: {
        tenantId, workspaceId, corporateCustomerId, personalCustomerId: input.personalCustomerId,
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
    return this.toCorporateMembership(row, row.personalCustomer.name);
  }

  async listPlans(tenantId: string, workspaceId: string): Promise<CustomerMembershipPlan[]> {
    const rows = await this.prisma.customerMembershipPlan.findMany({
      where: { tenantId, workspaceId }, include: { versions: { orderBy: { version: "desc" } } }, orderBy: [{ targetType: "asc" }, { code: "asc" }]
    });
    return rows.map((row) => this.toPlan(row));
  }

  async savePlan(tenantId: string, workspaceId: string, input: SaveCustomerMembershipPlanRequest, operator?: string) {
    await this.requireWorkspace(tenantId, workspaceId);
    if (input.effectiveFrom && input.effectiveTo && new Date(input.effectiveFrom) > new Date(input.effectiveTo)) {
      throw new BadRequestException("方案失效时间不能早于生效时间");
    }
    const plan = await this.prisma.$transaction(async (tx) => {
      const existing = input.id
        ? await tx.customerMembershipPlan.findFirst({ where: { tenantId, workspaceId, id: input.id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } })
        : undefined;
      if (input.id && !existing) throw new NotFoundException("会员方案不存在");
      if (existing && existing.targetType !== input.targetType) throw new ConflictException("已创建方案不能改变个人/企业目标类型");
      const base = existing
        ? await tx.customerMembershipPlan.update({ where: { id: existing.id }, data: { code: input.code.trim(), name: input.name.trim() } })
        : await tx.customerMembershipPlan.create({ data: { tenantId, workspaceId, code: input.code.trim(), name: input.name.trim(), targetType: input.targetType } });
      const latest = existing?.versions[0];
      const targetVersion = latest && latest.status === "draft"
        ? await tx.customerMembershipPlanVersion.update({
            where: { id: latest.id },
            data: this.planVersionData(input)
          })
        : await tx.customerMembershipPlanVersion.create({
            data: { tenantId, workspaceId, planId: base.id, version: (latest?.version ?? 0) + 1, createdBy: operator, ...this.planVersionData(input) }
          });
      return { base, targetVersion };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const all = await this.listPlans(tenantId, workspaceId);
    return all.find((item) => item.id === plan.base.id)!;
  }

  async publishPlan(tenantId: string, workspaceId: string, planId: string, versionId: string, operator?: string) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, workspaceId, planId, id: versionId }, include: { plan: true } });
      if (!version) throw new NotFoundException("会员方案版本不存在");
      if (version.status !== "draft") throw new ConflictException("只有草稿版本可以发布");
      if (version.isDefault) {
        await tx.customerMembershipPlanVersion.updateMany({
          where: { tenantId, workspaceId, id: { not: version.id }, status: "published", isDefault: true, plan: { targetType: version.plan.targetType } },
          data: { isDefault: false }
        });
      }
      await tx.customerMembershipPlanVersion.update({ where: { id: version.id }, data: { status: "published", publishedBy: operator, publishedAt: now } });
      await tx.customerMembershipPlan.update({ where: { id: planId }, data: { status: "active" } });
    });
    return (await this.listPlans(tenantId, workspaceId)).find((item) => item.id === planId)!;
  }

  async disablePlanVersion(tenantId: string, workspaceId: string, planId: string, versionId: string, reason: string, operator?: string) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new BadRequestException("停用会员方案必须填写原因");
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, workspaceId, planId, id: versionId } });
      if (!version) throw new NotFoundException("会员方案版本不存在");
      if (version.status !== "published") throw new ConflictException("只有已发布方案版本可以停用");
      await tx.customerMembershipPlanVersion.update({
        where: { id: version.id },
        data: { status: "disabled", disabledBy: operator, disabledAt: new Date(), disableReason: trimmedReason }
      });
      const remainingPublished = await tx.customerMembershipPlanVersion.count({
        where: { tenantId, workspaceId, planId, status: "published", id: { not: version.id } }
      });
      await tx.customerMembershipPlan.update({ where: { id: planId }, data: { status: remainingPublished ? "active" : "disabled" } });
    });
    return (await this.listPlans(tenantId, workspaceId)).find((item) => item.id === planId)!;
  }

  async restorePlanVersion(tenantId: string, workspaceId: string, planId: string, versionId: string, reason: string, operator?: string) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new BadRequestException("恢复会员方案必须填写原因");
    await this.prisma.$transaction(async (tx) => {
      const source = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, workspaceId, planId, id: versionId } });
      if (!source) throw new NotFoundException("会员方案版本不存在");
      if (!["published", "disabled"].includes(source.status)) throw new ConflictException("只能从已发布或已停用版本恢复");
      const latest = await tx.customerMembershipPlanVersion.findFirst({ where: { tenantId, workspaceId, planId }, orderBy: { version: "desc" } });
      if (latest?.status === "draft") throw new ConflictException("该方案已有草稿，请先发布或作废后再恢复");
      await tx.customerMembershipPlanVersion.create({
        data: {
          tenantId, workspaceId, planId, version: (latest?.version ?? 0) + 1, status: "draft", levelRank: source.levelRank,
          isDefault: source.isDefault, isRecommended: source.isRecommended, appVisible: source.appVisible,
          effectiveFrom: source.effectiveFrom, effectiveTo: source.effectiveTo, eligibility: source.eligibility as Prisma.InputJsonValue, benefits: source.benefits as Prisma.InputJsonValue,
          createdBy: operator, restoredFromVersionId: source.id, restoreReason: trimmedReason
        }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return (await this.listPlans(tenantId, workspaceId)).find((item) => item.id === planId)!;
  }

  async assignPlan(tenantId: string, workspaceId: string, input: AssignCustomerMembershipPlanRequest, operator?: string): Promise<CustomerMembershipPlanAssignment> {
    await this.requireCustomer(tenantId, input.customerId);
    await this.requireWorkspaceLink(tenantId, workspaceId, input.customerId);
    const source = input.source ?? "manual";
    const effectiveFrom = dateOrUndefined(input.effectiveFrom) ?? new Date();
    const effectiveTo = dateOrUndefined(input.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException("会员方案失效时间不能早于生效时间");
    if ((source === "manual" || source === "corporate_contract") && !input.reason?.trim()) {
      throw new BadRequestException("人工授予或合同授予会员方案必须填写原因");
    }
    const version = await this.prisma.customerMembershipPlanVersion.findFirst({
      where: { tenantId, workspaceId, id: input.planVersionId, status: "published" }, include: { plan: true }
    });
    if (!version) throw new NotFoundException("可授予的已发布会员方案版本不存在");
    const customer = await this.requireCustomer(tenantId, input.customerId);
    if (customer.customerType !== version.plan.targetType) throw new ConflictException("方案目标类型与会员类型不匹配");
    const row = await this.prisma.customerMembershipPlanAssignment.create({
      data: {
        tenantId, workspaceId, customerId: input.customerId, planId: version.planId, planVersionId: version.id,
        source, effectiveFrom, effectiveTo,
        reason: input.reason?.trim() || null, grantedBy: operator,
        snapshot: { planName: version.plan.name, targetType: version.plan.targetType, benefits: version.benefits } as Prisma.InputJsonValue
      }
    });
    return this.toAssignment(row);
  }

  async listPlanAssignments(tenantId: string, workspaceId: string, customerId: string): Promise<CustomerMembershipPlanAssignment[]> {
    await this.requireCustomer(tenantId, customerId);
    await this.requireWorkspaceLink(tenantId, workspaceId, customerId);
    const rows = await this.prisma.customerMembershipPlanAssignment.findMany({
      where: { tenantId, workspaceId, customerId }, orderBy: { createdAt: "desc" }
    });
    const now = Date.now();
    return rows.map((row) => {
      const assignment = this.toAssignment(row);
      if (assignment.status === "active" && assignment.effectiveTo && new Date(assignment.effectiveTo).getTime() <= now) assignment.status = "expired";
      return assignment;
    });
  }

  async revokePlanAssignment(tenantId: string, workspaceId: string, assignmentId: string, reason: string, operator?: string) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new BadRequestException("撤销会员方案必须填写原因");
    const assignment = await this.prisma.customerMembershipPlanAssignment.findFirst({ where: { tenantId, workspaceId, id: assignmentId } });
    if (!assignment) throw new NotFoundException("会员方案授予记录不存在");
    if (assignment.status !== "active") throw new ConflictException("只有当前有效的会员方案授予可以撤销");
    const updated = await this.prisma.customerMembershipPlanAssignment.updateMany({
      where: { tenantId, workspaceId, id: assignment.id, status: "active" },
      data: { status: "revoked", revokedBy: operator, revokedAt: new Date(), revokeReason: trimmedReason }
    });
    if (updated.count !== 1) throw new ConflictException("会员方案授予已被其他操作撤销，请刷新后重试");
    const row = await this.prisma.customerMembershipPlanAssignment.findFirst({ where: { tenantId, workspaceId, id: assignment.id } });
    if (!row) throw new NotFoundException("会员方案授予记录不存在");
    return this.toAssignment(row);
  }

  /** 企业优惠资格判定的单一读模型，供后续报价/订单安全接入，不从旧企业表取权益。 */
  async resolveBenefits(tenantId: string, workspaceId: string, personalCustomerId: string, corporateCustomerId?: string) {
    await this.requireCustomer(tenantId, personalCustomerId, "personal");
    await this.requireWorkspaceLink(tenantId, workspaceId, personalCustomerId);
    const now = new Date();
    const personal = await this.prisma.customerMembershipPlanAssignment.findFirst({
      where: { tenantId, workspaceId, customerId: personalCustomerId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      orderBy: { createdAt: "desc" }
    });
    let corporate: CustomerMembershipPlanAssignment | undefined;
    if (corporateCustomerId) {
      const relation = await this.prisma.customerCorporateMembership.findFirst({
        where: { tenantId, workspaceId, corporateCustomerId, personalCustomerId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }
      });
      if (!relation) throw new ConflictException("该个人会员不是当前企业的有效员工，不能使用企业权益");
      const assignment = await this.prisma.customerMembershipPlanAssignment.findFirst({
        where: { tenantId, workspaceId, customerId: corporateCustomerId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        orderBy: { createdAt: "desc" }
      });
      corporate = assignment ? this.toAssignment(assignment) : undefined;
    }
    return { personal: personal ? this.toAssignment(personal) : undefined, corporate };
  }

  /**
   * 订单域唯一允许的预约身份解析。个人永远是使用人与资质事实来源；企业只来自
   * 当前空间有效员工关系，不能由管理端或 App 自报一个企业 id 来取得权益或主体。
   */
  async resolveBookingIdentity(
    tenantId: string,
    workspaceId: string,
    personalCustomerId: string,
    input?: RentalBookingIdentityInput
  ): Promise<RentalMembershipSnapshot> {
    const personal = await this.requireCustomer(tenantId, personalCustomerId, "personal");
    const personalLink = await this.requireWorkspaceLink(tenantId, workspaceId, personalCustomerId);
    const qualifications = (await this.prisma.customerQualificationRef.findMany({
      where: { tenantId, customerId: personalCustomerId }, orderBy: { qualificationType: "asc" }
    })).map((row) => this.toQualification(row));
    if (personalLink.status !== "active") throw new ConflictException("个人会员当前状态不允许新建订单");
    const bookingIdentity = input?.bookingIdentity ?? "personal";
    if (bookingIdentity === "personal") {
      if (input?.corporateCustomerId || input?.enterpriseContractAndPayer) {
        throw new BadRequestException("个人预约不能携带企业主体或企业付款选择");
      }
      const benefits = await this.resolveBenefits(tenantId, workspaceId, personalCustomerId);
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
    const corporate = await this.requireCustomer(tenantId, corporateCustomerId, "corporate");
    const corporateLink = await this.requireWorkspaceLink(tenantId, workspaceId, corporateCustomerId);
    if (corporateLink.status !== "active") throw new ConflictException("企业会员当前状态不允许作为订单主体");
    const now = new Date();
    const relationship = await this.prisma.customerCorporateMembership.findFirst({
      where: {
        tenantId, workspaceId, corporateCustomerId, personalCustomerId, status: "active",
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }]
      }
    });
    if (!relationship) throw new ConflictException("该个人会员不是当前企业的有效员工，不能使用企业身份或权益");
    const benefits = await this.resolveBenefits(tenantId, workspaceId, personalCustomerId, corporateCustomerId);
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
   * 因此企业员工关系、空间会员状态和证件状态都必须从当前主档重读。
   */
  async assertBookingQualificationForAction(
    tenantId: string,
    workspaceId: string,
    snapshot: RentalMembershipSnapshot | undefined,
    rule: RentalRuleConfig["qualification"],
    action: RentalQualificationAction,
    window: RentalQualificationCheckWindow
  ) {
    if (!rule.required) return { ok: true as const };
    if (!snapshot) {
      throw new ConflictException(`${this.qualificationActionLabel(action)}不能继续：订单缺少会员资格快照，请先人工核验`);
    }

    const current = await this.resolveBookingIdentity(tenantId, workspaceId, snapshot.personalCustomerId, {
      bookingIdentity: snapshot.bookingIdentity,
      corporateCustomerId: snapshot.corporateCustomerId,
      enterpriseContractAndPayer: snapshot.enterpriseContractAndPayer
    });
    const result = evaluateRentalQualification(current.qualifications, rule, window);
    if (!result.ok) throw new ConflictException(`${this.qualificationActionLabel(action)}资格校验未通过：${result.message}`);
    return { ok: true as const, qualificationType: result.qualificationType };
  }

  private qualificationActionLabel(action: RentalQualificationAction) {
    return action === "submit" ? "订单提交" : action === "pickup" ? "领取" : "续租";
  }

  async listBookingOptions(tenantId: string, workspaceId: string, personalCustomerId: string): Promise<CustomerMembershipBookingOption[]> {
    await this.requireCustomer(tenantId, personalCustomerId, "personal");
    await this.requireWorkspaceLink(tenantId, workspaceId, personalCustomerId);
    const now = new Date();
    const rows = await this.prisma.customerCorporateMembership.findMany({
      where: {
        tenantId, workspaceId, personalCustomerId, status: "active", effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        corporateCustomer: { customerType: "corporate" }
      },
      include: { corporateCustomer: { select: { name: true } } }, orderBy: { createdAt: "desc" }
    });
    return rows.map((row) => ({
      corporateCustomerId: row.corporateCustomerId,
      corporateCustomerName: row.corporateCustomer.name,
      corporateMembershipId: row.id,
      role: row.role as CustomerMembershipBookingOption["role"],
      effectiveTo: row.effectiveTo?.toISOString()
    }));
  }

  private planVersionData(input: SaveCustomerMembershipPlanRequest) {
    return {
      levelRank: input.levelRank, isDefault: input.isDefault ?? false, isRecommended: input.isRecommended ?? false,
      appVisible: input.appVisible ?? false, effectiveFrom: dateOrUndefined(input.effectiveFrom), effectiveTo: dateOrUndefined(input.effectiveTo),
      eligibility: (input.eligibility ?? {}) as Prisma.InputJsonValue,
      benefits: input.benefits as unknown as Prisma.InputJsonValue
    };
  }

  private toReview(row: PrismaMembershipReview, customerName?: string): CustomerMembershipReview {
    return {
      id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, customerId: row.customerId, customerName,
      reviewType: row.reviewType as CustomerMembershipReview["reviewType"], qualificationType: row.qualificationType ?? undefined,
      status: row.status as CustomerMembershipReview["status"], channel: row.channel, reason: row.reason ?? undefined,
      reviewedBy: row.reviewedBy ?? undefined, reviewedAt: row.reviewedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
    };
  }

  private toQualification(row: {
    id: string; customerId: string; qualificationType: string; referenceNoMasked: string | null; issuedAt: Date | null;
    expiresAt: Date | null; status: string; evidenceRef: string | null; verifiedAt: Date | null; createdAt: Date; updatedAt: Date;
  }): CustomerQualificationRef {
    const status: CustomerQualificationStatus = row.status === "approved" && row.expiresAt && row.expiresAt.getTime() <= Date.now()
      ? "expired"
      : row.status as CustomerQualificationStatus;
    return {
      id: row.id, customerId: row.customerId, qualificationType: row.qualificationType, referenceNoMasked: row.referenceNoMasked ?? undefined,
      issuedAt: row.issuedAt?.toISOString(), expiresAt: row.expiresAt?.toISOString(), status,
      evidenceRef: row.evidenceRef ?? undefined, verifiedAt: row.verifiedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
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
    id: string; workspaceId: string; code: string; name: string; targetType: string; status: string; createdAt: Date; updatedAt: Date;
    versions: Array<{ id: string; planId: string; version: number; status: string; levelRank: number; isDefault: boolean; isRecommended: boolean; appVisible: boolean; effectiveFrom: Date | null; effectiveTo: Date | null; eligibility: Prisma.JsonValue; benefits: Prisma.JsonValue; createdAt: Date; updatedAt: Date; publishedAt: Date | null; disabledBy: string | null; disabledAt: Date | null; disableReason: string | null; restoredFromVersionId: string | null; restoreReason: string | null }>;
  }): CustomerMembershipPlan {
    const versions = row.versions.map((version) => this.toPlanVersion(version));
    return {
      id: row.id, workspaceId: row.workspaceId, code: row.code, name: row.name,
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
