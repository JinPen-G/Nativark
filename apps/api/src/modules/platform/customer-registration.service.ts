import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  Prisma,
  CustomerMembership as PrismaCustomerMembership,
  CustomerMembershipReview as PrismaCustomerMembershipReview,
  CustomerProfile as PrismaCustomerProfile
} from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { CustomerOperationsRepository } from "./customer-operations.repository";
import { SharedCustomerRepository, type SharedCustomerTx } from "./shared-customer.repository";

const REGISTRATION_LEVEL_NAME = "普通会员";
const SELF_SERVICE_REUSABLE_MEMBERSHIP = new Set(["active", "pending_activation"]);
const maskPhone = (value: string) => (value.length <= 4 ? "****" : `${value.slice(0, 3)}****${value.slice(-4)}`);

export interface RegisterPersonalCustomerInput {
  tenantId: string;
  /** 调用方已规范化（去空白 / 去分隔符）的手机号，本层不再改写。 */
  phone: string;
  name: string;
  email?: string;
  /** 调用方已脱敏；两条入口的脱敏格式历史上就不同，这里不统一。 */
  identityNoMasked?: string;
  /** 自动注册：会员直接 active；否则 pending_activation 并挂一条注册审核。 */
  automatic: boolean;
  channel: "admin" | "app";
  /**
   * 注册审核幂等键；非空时先按键查审核：已用于别的客户或别的审核类型即拒绝，
   * 命中本客户的注册审核则直接复用（会员已激活时也照样返回，供调用方回显）。
   */
  requestKey: string | null;
  /** 审核来源空间，只留来源，不是会员归属。 */
  sourceWorkspaceId?: string;
  reviewPayload: Prisma.InputJsonValue;
  /**
   * 会员仍待激活时，只复用处理中的注册审核（pending / supplement_required）；
   * 已拒绝、已取消属终态，再次注册一律新建一条待审记录。两条入口口径相同。
   * @deprecated 曾用于区分 open / latest 两种复用策略；latest 会把已拒绝审核回显给调用方、
   * 让客户永远卡在待激活，已移除。字段保留只为兼容尚在开发中的调用方，传入被忽略。
   */
  reuseReview?: "open";
  /**
   * 自助注册（客户端）与后台代注册的差别集中在这一位：
   * - 自助：主档、账号、会员任一已停用 / 受限 / 终态即拒绝，已设口令的账号拒绝重复注册，
   *   并用本次资料刷新既有主档的姓名 / 邮箱 / 证件掩码；
   * - 后台：允许对既有客户补开会员与临时密码，不改主档资料。
   */
  selfService: boolean;
  /** 不传则不动账号（后台未设临时密码时账号留待客户端自助开通）。 */
  account?: {
    passwordHash: string;
    mustChangePassword: boolean;
    lastReason?: { create: string; update: string };
    lastOperator?: string;
  };
}

export interface RegisterPersonalCustomerResult {
  customer: PrismaCustomerProfile;
  membership: PrismaCustomerMembership;
  review?: PrismaCustomerMembershipReview;
}

/**
 * 个人客户注册的唯一实现。后台代注册（MembershipService）与客户端自助注册（ClientAuthService）
 * 都调用它：主档按租户手机号复用、会员按 (tenantId, customerId) 唯一、账号按需 upsert、
 * 待激活时挂注册审核。调用方负责事务（`customerRegistrationTransaction`）、入参规范化与
 * 各自的前置校验（权限、验证码、密码强度）。
 *
 * 不变量：注册重试只复用会员，绝不改写既有会员状态——自动注册也不能解除暂停、注销，
 * 或抢过既有的人工审核。
 */
@Injectable()
export class CustomerRegistrationService {
  private readonly customers: SharedCustomerRepository;
  private readonly operations: CustomerOperationsRepository;

  constructor(
    prisma: PrismaService,
    // 既有测试用位置参数构造上层服务，这两个依赖缺失时按同一个 prisma 自建，
    // 与 CustomerOperationsRepository 的做法一致。
    @Optional() customers?: SharedCustomerRepository,
    @Optional() operations?: CustomerOperationsRepository
  ) {
    this.customers = customers ?? new SharedCustomerRepository(prisma);
    this.operations = operations ?? new CustomerOperationsRepository(prisma, this.customers);
  }

  async registerPersonal(tx: SharedCustomerTx, input: RegisterPersonalCustomerInput): Promise<RegisterPersonalCustomerResult> {
    const { tenantId, phone } = input;
    const name = input.name.trim();
    const email = input.email?.trim() || undefined;

    let customer = await tx.customerProfile.findFirst({ where: { tenantId, phone } });
    if (customer && customer.customerType !== "personal") {
      throw new ConflictException("该手机号已属于企业客户，不能注册为个人会员");
    }
    const created = !customer;
    if (!customer) {
      customer = await this.customers.createProfile({
        tenantId, customerType: "personal", name, phone, email, identityNoMasked: input.identityNoMasked ?? null
      }, tx);
    }

    // 与订单创建、状态变更共用同一条主档行锁；锁后重读才是权威状态。
    if (!(await this.operations.lockCustomerBusinessGate(tenantId, customer.id, tx))) {
      throw new NotFoundException("客户不存在");
    }
    const locked = await tx.customerProfile.findFirst({ where: { tenantId, id: customer.id } });
    if (!locked) throw new NotFoundException("客户不存在");
    if (locked.mergedIntoCustomerId) throw new ConflictException("客户主档已合并，请使用保留主档");
    if (locked.customerType !== "personal") throw new ConflictException("必须选择个人会员");
    // 资料状态只认锁后的行：锁前读到 active、锁前被并发停用的资料不能借注册重新激活。
    if (input.selfService && locked.status !== "active") {
      throw new ConflictException("该客户资料已停用，不能通过注册重新激活");
    }
    customer = locked;

    if (input.selfService && !created) {
      const account = await tx.customerAccount.findFirst({ where: { tenantId, customerId: customer.id } });
      if (account && account.status !== "active") throw new ConflictException("该客户账号已停用，不能通过注册重新激活");
      if (account?.passwordHash && account.status === "active") throw new ConflictException("该手机号已注册，请直接登录");
      const refreshed = await this.customers.updateProfile(tenantId, customer.id, {
        name,
        email: email || customer.email || null,
        identityNoMasked: input.identityNoMasked ?? customer.identityNoMasked
      }, tx);
      if (!refreshed) throw new NotFoundException("客户不存在");
      customer = refreshed;
    }

    const keyedReview = input.requestKey
      ? await tx.customerMembershipReview.findFirst({ where: { tenantId, requestKey: input.requestKey } })
      : null;
    if (keyedReview && (keyedReview.customerId !== customer.id || keyedReview.reviewType !== "registration")) {
      throw new ConflictException("注册幂等键已用于其他请求");
    }

    const existingMembership = await tx.customerMembership.findUnique({
      where: { tenantId_customerId: { tenantId, customerId: customer.id } }
    });
    if (input.selfService && existingMembership && !SELF_SERVICE_REUSABLE_MEMBERSHIP.has(existingMembership.status)) {
      throw new ConflictException("该客户会员关系已受限、退出或关闭，不能通过注册重新激活");
    }
    let membership = existingMembership ?? await this.customers.createMembership({
      tenantId,
      customerId: customer.id,
      levelName: REGISTRATION_LEVEL_NAME,
      status: input.automatic ? "active" : "pending_activation"
    }, tx);
    // 自动通过/后台直接通过对**待激活**的既有会员生效（沿用两条旧路径的 upsert.update 语义）；
    // 其余状态（暂停、受限、退出、关闭）不由注册改写，它们有各自的状态变更入口与审计。
    if (input.automatic && membership.status === "pending_activation") {
      const activated = await this.customers.updateMembership(
        tenantId, membership.id, { status: "active" }, "pending_activation", tx
      );
      if (activated > 0) membership = { ...membership, status: "active" };
    }

    if (input.account) {
      await this.customers.upsertAccountCredentials({
        tenantId,
        customerId: customer.id,
        loginPhone: phone,
        loginPhoneMasked: maskPhone(phone),
        passwordHash: input.account.passwordHash,
        mustChangePassword: input.account.mustChangePassword,
        rebindLogin: input.selfService,
        lastReason: input.account.lastReason,
        lastOperator: input.account.lastOperator
      }, tx);
    }

    let review: PrismaCustomerMembershipReview | undefined = keyedReview ?? undefined;
    if (membership.status === "pending_activation") {
      // 只复用**仍在处理中**的注册审核（待审/待补件）；已拒绝、已取消的审核是终态，
      // 客户补正后再次注册必须产生一条新的待审记录，否则审核员无事可批、客户永远卡住。
      review ??= await tx.customerMembershipReview.findFirst({
        where: {
          tenantId,
          customerId: customer.id,
          reviewType: "registration",
          status: { in: ["pending", "supplement_required"] }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      }) ?? undefined;
      review ??= await this.customers.createReview({
        tenantId,
        customerId: customer.id,
        reviewType: "registration",
        status: "pending",
        channel: input.channel,
        requestKey: input.requestKey,
        sourceWorkspaceId: input.sourceWorkspaceId,
        payload: input.reviewPayload
      }, tx);
    }

    return { customer, membership, review };
  }
}
