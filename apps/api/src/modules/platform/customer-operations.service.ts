import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ChangeCustomerAccountStatusRequest,
  ChangeCustomerMembershipStatusRequest,
  CustomerAccount,
  CustomerAccountStatus,
  CustomerMembershipStatus,
  CustomerRiskRecordSummary,
  CreateCustomerRiskRecordRequest,
  ReviewCustomerRiskRecordRequest,
  CustomerProfileOrderQuery,
  CustomerProfileOverview,
  CustomerIdentityVerificationSummary,
  SaveCustomerIdentityVerificationRequest,
  SaveCustomerProfileAddressRequest,
  CustomerStatusAction,
  CustomerTransactability,
  SharedCustomerProfile,
  SystemUserRow
} from "@rental-os/shared";
import { CUSTOMER_ACCOUNT_STATUSES, CUSTOMER_MEMBERSHIP_STATUSES, CUSTOMER_RISK_LEVELS, CUSTOMER_RISK_TYPES } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { CustomerOperationsRepository, type CustomerTx } from "./customer-operations.repository";
import { SharedCustomerRepository } from "./shared-customer.repository";
import { CustomerMergeService } from "./customer-merge.service";
import { getRequestDataScope, getRequestIdentity, getRequestLocationIds, getRequestUserId, getRequestWorkspaceId } from "../../common/request-identity";
import { readCustomerInsights } from "./customer-insights";

/** 敏感字段的解密查看权限。与「查看客户」分开授权（需求 4.8.5）。 */
export const CUSTOMER_REVEAL_PERMISSION = "rental-os:customer:reveal-sensitive";

const stamp = () => new Date().toISOString();

/**
 * 租户会员状态的合法迁移。
 *
 * 用显式表而不是「任意状态可改成任意状态」：需求给每个状态定义了业务含义，
 * 从「已注销」回到「正常」不是一次普通编辑，而是重新开户，必须走 reopen 并留痕。
 * 没有这张表的话，一个手滑的 PUT 就能把注销过的会员关系直接改回正常。
 */
const MEMBERSHIP_TRANSITIONS: Record<CustomerMembershipStatus, CustomerMembershipStatus[]> = {
  pending_activation: ["active", "exited", "closed"],
  active: ["suspended", "risk_restricted", "exited", "closed"],
  suspended: ["active", "risk_restricted", "exited", "closed"],
  risk_restricted: ["active", "suspended", "exited", "closed"],
  exited: ["active", "closed"],
  // 注销是终态：只能显式 reopen 回 pending_activation，重新走激活流程。
  closed: ["pending_activation"]
};

/** 账号状态的合法迁移。注销后同样只能重新激活，不能直接跳回 active。 */
const ACCOUNT_TRANSITIONS: Record<CustomerAccountStatus, CustomerAccountStatus[]> = {
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: []
};

/** 状态 → 动作。审计里记录的是「做了什么」，不是「变成了什么」。 */
function membershipAction(from: CustomerMembershipStatus, to: CustomerMembershipStatus): CustomerStatusAction {
  if (to === "risk_restricted") return "restrict";
  if (to === "suspended") return "suspend";
  if (to === "exited") return "exit";
  if (to === "closed") return "close";
  if (to === "pending_activation") return "reopen";
  // → active：从受限/暂停回来是「解除」，从待激活过来是「激活」。
  return from === "pending_activation" ? "activate" : "release";
}

function accountAction(to: CustomerAccountStatus): CustomerStatusAction {
  if (to === "suspended") return "suspend";
  if (to === "closed") return "close";
  return "release";
}

/** 主档、账号与会员均按租户共享，但各自状态独立；业务事实继续按空间归属。 */
@Injectable()
export class CustomerOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SharedCustomerRepository) private readonly customers: SharedCustomerRepository,
    @Inject(CustomerOperationsRepository) private readonly operations: CustomerOperationsRepository,
    // CUSTOMER-01D：注销前置检查。可选注入——既有测试用位置参数构造本服务；
    // 缺失时**拒绝注销**而不是放行（见 assertClosableForClose）。
    @Optional() private readonly closability?: CustomerMergeService
  ) {}

  /**
   * 注销专用门禁（需求 4.8.13）。
   *
   * 缺注入时拒绝而不是跳过：注销是不可逆动作，拿不到检查能力就不该继续。
   * 硬阻断项非空一律拒绝；人工核对项必须由调用方显式确认，否则同样拒绝并回传清单。
   */
  private async assertClosableForClose(
    tenantId: string,
    customerId: string,
    acknowledged: boolean | undefined,
    tx?: CustomerTx
  ) {
    if (!this.closability) {
      throw new ConflictException("注销前置检查服务未就绪，已拒绝本次注销");
    }
    const result = await this.closability.assertClosable(tenantId, customerId, tx);
    if (!result.closable) {
      throw new ConflictException(
        `注销前必须先处理：${result.blockers.map((row) => row.message).join("；")}`
      );
    }
    if (!acknowledged) {
      throw new ConflictException(
        `以下项系统无法自动核对，必须人工确认后重试：${result.manualConfirmations.map((row) => row.message).join("；")}`
      );
    }
  }

  private mask(value: string) {
    const trimmed = value.trim();
    if (trimmed.length <= 4) return "****";
    return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
  }

  /**
   * 会员主档按租户共享，但受限账号只能看到与其当前工作范围有关的客户。
   * 目前可验证的关联是：本人在本空间建立的主档，或本空间/授权地点内已有订单。
   * 不用“知道 customerId 就能查”作为访问凭据。
   */
  private async visibleCustomerIds(
    tenantId: string,
    workspaceId: string,
    scope: "all" | "organization" | "store" | "own",
    userId?: string
  ): Promise<string[] | undefined> {
    const locationIds = getRequestLocationIds();
    if (scope === "all" && locationIds === undefined) return undefined;
    if (scope === "organization" && locationIds === undefined) {
      throw new ForbiddenException("组织客户范围未解析为授权履约地点，已拒绝访问");
    }
    if ((scope === "own" && !userId) || !workspaceId) {
      throw new ForbiddenException("客户数据范围缺少已验证的账号或经营空间");
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
    const orderRows = await this.prisma.rentalOrder.findMany({
      where: {
        tenantId,
        workspaceId,
        customerId: { not: null },
        ...(orderScope.length ? { AND: orderScope } : {})
      },
      select: { customerId: true },
      distinct: ["customerId"]
    });
    const ids = new Set(orderRows.flatMap((row) => row.customerId ? [row.customerId] : []));
    // 无履约地点限制时，可见自己创建的客户主档；有地点限制时没有“客户所属地点”字段，
    // 因而只认该授权地点已有订单，不猜测新建客户属于哪一个地点。
    if (locationIds === undefined && (scope === "own" || scope === "store")) {
      const created = await this.prisma.customerProfile.findMany({
        where: {
          tenantId,
          createdInWorkspaceId: workspaceId,
          ...(scope === "own" ? { createdByUserId: userId! } : {})
        },
        select: { id: true }
      });
      created.forEach((row) => ids.add(row.id));
    }
    return [...ids];
  }

  private async assertCustomerVisibleInRequestScope(
    tenantId: string,
    workspaceId: string | undefined,
    customerId: string,
    scope: "all" | "organization" | "store" | "own",
    userId?: string
  ) {
    const currentWorkspaceId = workspaceId;
    if (!currentWorkspaceId || (scope === "own" && !userId)) {
      throw new ForbiddenException("客户数据范围缺少已验证的账号或经营空间");
    }
    const locationIds = getRequestLocationIds();
    if (scope === "organization" && locationIds === undefined) {
      throw new ForbiddenException("组织客户范围未解析为授权履约地点，已拒绝访问");
    }
    const profileVisible = locationIds === undefined && (scope === "own" || scope === "store")
      ? await this.prisma.customerProfile.findFirst({
          where: {
            id: customerId,
            tenantId,
            createdInWorkspaceId: currentWorkspaceId,
            ...(scope === "own" ? { createdByUserId: userId! } : {})
          },
          select: { id: true }
        })
      : null;
    const orderScope: Prisma.RentalOrderWhereInput[] = [];
    if (locationIds !== undefined) {
      const safeIds = locationIds.length ? locationIds : ["__no_authorized_location__"];
      orderScope.push({ OR: [
        { fulfillmentLocationId: { in: safeIds } },
        { returnLocationId: { in: safeIds } }
      ] });
    }
    if (scope === "own") {
      const currentUserId = userId;
      orderScope.push(currentUserId ? { OR: [
        { createdBy: currentUserId },
        { workOrders: { some: { OR: [{ createdBy: currentUserId }, { assigneeId: currentUserId }] } } }
      ] } : { id: "__no_current_user__" });
    }
    const orderVisible = profileVisible ? true : await this.prisma.rentalOrder.findFirst({
      where: {
        tenantId,
        workspaceId: currentWorkspaceId,
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
    if (!profileVisible && !orderVisible) throw new NotFoundException("客户不存在或不在当前账号的数据范围内");
  }

  /** 附件不做脱敏投影，因此必须同时具备原资料查看和敏感资料权限。 */
  async assertCustomerFileReadAccess(tenantId: string, customerId: string, corporate = false) {
    const identity = getRequestIdentity();
    const permissions = new Set(identity?.permissions ?? []);
    const has = (code: string) => identity?.isPlatformAdmin || permissions.has("*") || permissions.has(code);
    if (!identity?.userId || identity.tenantId !== tenantId || identity.isSaasAdmin
      || !["operator", "staff"].includes(identity.audience ?? "") || !identity.workspaceId || !identity.dataScope || !identity.locationScope
      || (identity.dataScope === "organization" && identity.locationScope.mode !== "selected")
      || !has(CUSTOMER_REVEAL_PERMISSION)
      || !(corporate ? has("rental-os:corporate:view") || has("rental-os:corporate:manage") : has("rental-os:member:view"))) {
      throw new ForbiddenException("缺少原客户资料查看与敏感附件读取权限");
    }
    if (identity.dataScope !== "all" || getRequestLocationIds() !== undefined) {
      await this.assertCustomerVisibleInRequestScope(tenantId, identity.workspaceId, customerId, identity.dataScope, identity.userId);
    }
    const customer = await this.prisma.customerProfile.findFirst({ where: { tenantId, id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException("客户不存在或不在当前账号的数据范围内");
  }

  private canReveal(user?: SystemUserRow) {
    if (!user) return false;
    if (user.isSaasAdmin) return false;
    return Boolean(
      user.isPlatformAdmin || user.permissions?.includes("*") || user.permissions?.includes(CUSTOMER_REVEAL_PERMISSION)
    );
  }

  /**
   * 读客户详情，并按权限决定敏感字段是否脱敏；每次读取都写访问审计。
   *
   * 审计写在**服务层**而不是控制器：控制器只知道 HTTP，不知道这次读取实际带出了
   * 哪些敏感字段；而绕过控制器的内部调用（导出、后台任务）同样要留痕。
   */
  async getCustomerDetail(
    tenantId: string,
    workspaceId: string | undefined,
    customerId: string,
    user?: SystemUserRow,
    options: { action?: "detail" | "export"; reason?: string } = {}
  ): Promise<SharedCustomerProfile> {
    const scope = getRequestDataScope() ?? user?.dataScope;
    if (scope && (scope !== "all" || getRequestLocationIds() !== undefined)) {
      await this.assertCustomerVisibleInRequestScope(
        tenantId,
        workspaceId ?? getRequestWorkspaceId(),
        customerId,
        scope,
        getRequestUserId() ?? user?.id
      );
    }
    const profile = await this.customers.findById(tenantId, customerId);
    // 查不到即拒绝，且不区分「不存在」与「属于别的租户」——后者会变成一个
    // 探测他租户客户是否存在的信道。
    if (!profile) throw new NotFoundException("客户不存在");
    const revealed = this.canReveal(user);
    await this.operations.recordSensitiveAccess(tenantId, {
      workspaceId,
      customerId,
      field: "customer_detail",
      action: options.action ?? "detail",
      revealed,
      operator: user?.displayName,
      permission: revealed ? CUSTOMER_REVEAL_PERMISSION : undefined,
      reason: options.reason,
      at: stamp()
    });
    if (revealed) return profile;
    // 无解密权限时连明文手机号都不返回：`phone` 是登录标识，等同于身份凭据。
    return {
      ...profile,
      phone: profile.phoneMasked,
      email: profile.email ? this.mask(profile.email) : undefined,
      identityNoMasked: profile.identityNoMasked,
      corporateTaxNo: profile.corporateTaxNo ? this.mask(profile.corporateTaxNo) : undefined
    };
  }

  /** 列表同样脱敏并留痕。主档与会员均按租户共享。 */
  async listCustomers(
    tenantId: string,
    workspaceId: string | undefined,
    user?: SystemUserRow
  ): Promise<SharedCustomerProfile[]> {
    const scope = getRequestDataScope() ?? user?.dataScope;
    const visibleIds = scope
      ? await this.visibleCustomerIds(tenantId, workspaceId ?? getRequestWorkspaceId() ?? "", scope, getRequestUserId() ?? user?.id)
      : undefined;
    const rows = await this.customers.listByTenant(tenantId, undefined, visibleIds);
    const revealed = this.canReveal(user);
    // 列表只记一条汇总审计：逐客户一条会让一次翻页产生上百行噪声，
    // 反而淹没真正需要追责的单客户明文查看。
    if (rows.length) {
      await this.operations.recordSensitiveAccess(tenantId, {
        workspaceId,
        customerId: rows[0].id,
        field: "customer_list",
        action: "list",
        revealed,
        operator: user?.displayName,
        permission: revealed ? CUSTOMER_REVEAL_PERMISSION : undefined,
        reason: `列出 ${rows.length} 位客户`,
        at: stamp()
      });
    }
    if (revealed) return rows;
    return rows.map((row) => ({
      ...row,
      phone: row.phoneMasked,
      email: row.email ? this.mask(row.email) : undefined,
      corporateTaxNo: row.corporateTaxNo ? this.mask(row.corporateTaxNo) : undefined
    }));
  }

  /** 为客户开通登录账号。幂等：已有账号直接返回，不重复建。 */
  async ensureAccount(
    tenantId: string,
    customerId: string,
    operator?: string
  ): Promise<CustomerAccount> {
    const profile = await this.customers.findById(tenantId, customerId);
    if (!profile) throw new NotFoundException("客户不存在");
    if (profile.mergedIntoCustomerId) {
      throw new ConflictException("该客户主档已被合并，请为保留主档开通账号");
    }
    const existing = await this.operations.findAccountByCustomer(tenantId, customerId);
    if (existing) return existing;
    try {
      return await this.operations.createAccount(tenantId, {
        customerId,
        loginPhone: profile.phone,
        loginPhoneMasked: profile.phoneMasked,
        operator
      });
    } catch (error) {
      // 并发开通或登录号已被别的客户占用：前者应幂等返回，后者必须明确拒绝。
      const code = (error as { code?: string }).code;
      if (code !== "P2002") throw error;
      const mine = await this.operations.findAccountByCustomer(tenantId, customerId);
      if (mine) return mine;
      throw new ConflictException("该登录手机号已被本租户其他客户账号占用");
    }
  }

  /** Status writes share the enterprise authorization fence before the original
   * customer gate. Do not put this exclusive lock in Core's shared gate or upgrade S→X. */
  private async lockCustomerStatusGate(tenantId: string, customerId: string, tx: CustomerTx) {
    const tenants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;
    if (!tenants.length || !(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
      throw new NotFoundException("客户不存在");
    }
  }

  /**
   * 改**账号**状态。影响该客户在全部空间的登录，因此不接受 workspaceId。
   *
   * 状态、历史和企业授权失效同事务；安全停用不受最后管理员交接阻断，恢复不重授旧权限。
   * 乐观并发以读到的状态为条件，落败方拿 409 而不是静默覆盖。
   */
  async changeAccountStatus(
    tenantId: string,
    customerId: string,
    input: ChangeCustomerAccountStatusRequest,
    operator?: string
  ): Promise<CustomerAccount> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("变更客户账号状态必须填写原因");
    if (!CUSTOMER_ACCOUNT_STATUSES.includes(input.status)) {
      throw new BadRequestException(`未知的客户账号状态：${input.status}`);
    }
    const at = stamp();
    const changed = await this.prisma.$transaction(async (tx) => {
      await this.lockCustomerStatusGate(tenantId, customerId, tx);
      const account = await this.operations.findAccountByCustomer(tenantId, customerId, tx);
      if (!account) throw new NotFoundException("该客户尚未开通登录账号");
      if (account.status === input.status) {
        throw new ConflictException(`客户账号已处于 ${input.status} 状态`);
      }
      if (!ACCOUNT_TRANSITIONS[account.status].includes(input.status)) {
        throw new ConflictException(
          `客户账号不能从 ${account.status} 直接变为 ${input.status}` +
            (account.status === "closed" ? "：已注销账号需重新开户" : "")
        );
      }
      // 注销检查与状态落库必须同锁、同事务。否则检查通过后仍可插入一张新订单。
      if (input.status === "closed") {
        await this.assertClosableForClose(
          tenantId,
          customerId,
          input.acknowledgedManualChecks,
          tx
        );
      }
      const count = await this.operations.updateAccountStatus(
        tenantId,
        account.id,
        {
          status: input.status,
          // 时间戳只在进入该状态时写；解除时**不清空**原时间戳，历史必须留痕。
          suspendedAt: input.status === "suspended" ? at : undefined,
          closedAt: input.status === "closed" ? at : undefined,
          reason,
          operator
        },
        account.status,
        {
          customerId,
          scope: "account",
          action: accountAction(input.status),
          fromStatus: account.status,
          toStatus: input.status,
          reason,
          operator,
          at
        },
        tx
      );
      if (count && input.status !== "active") {
        await this.customers.invalidatePersonalEnterpriseAuthority(tenantId, customerId, tx);
      }
      return count;
    });
    if (changed === 0) {
      throw new ConflictException("客户账号状态已被其他人修改，请刷新后重试");
    }
    const updated = await this.operations.findAccountByCustomer(tenantId, customerId);
    if (!updated) throw new NotFoundException("客户账号读取失败");
    return updated;
  }

  /** 改租户统一会员状态，影响全部空间的新业务；不联动账号登录状态。 */
  async changeMembershipStatus(
    tenantId: string,
    customerId: string,
    input: ChangeCustomerMembershipStatusRequest,
    operator?: string
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("变更租户会员状态必须填写原因");
    if (!CUSTOMER_MEMBERSHIP_STATUSES.includes(input.status)) {
      throw new BadRequestException(`未知的租户会员状态：${input.status}`);
    }
    const at = stamp();
    const changed = await this.prisma.$transaction(async (tx) => {
      await this.lockCustomerStatusGate(tenantId, customerId, tx);
      const membership = await this.customers.findMembership(tenantId, customerId, tx);
      if (!membership) throw new NotFoundException("该客户尚未开通租户会员");
      if (membership.status === input.status) {
        throw new ConflictException(`该客户在本租户已处于 ${input.status} 状态`);
      }
      if (!MEMBERSHIP_TRANSITIONS[membership.status].includes(input.status)) {
        throw new ConflictException(
          `租户会员状态不能从 ${membership.status} 直接变为 ${input.status}` +
            (membership.status === "closed" ? "：已注销的会员关系需先重新激活" : "")
        );
      }
      if (input.status === "closed") {
        // 注销统一会员必须在客户锁内检查全租户未完订单、资金与风险事实。
        await this.assertClosableForClose(
          tenantId,
          customerId,
          input.acknowledgedManualChecks,
          tx
        );
      }

      const customer = await tx.customerProfile.findFirst({ where: { tenantId, id: customerId }, select: { customerType: true } });
      if (!customer) throw new NotFoundException("客户不存在");
      const count = await this.operations.updateMembershipStatus(
        tenantId,
        membership.id,
        {
          status: input.status,
          // 等级只允许在回到 active 时调整：暂停或注销时改等级会让历史等级失去解释。
          levelName: input.status === "active" ? input.levelName : undefined,
          suspendedAt: input.status === "suspended" ? at : undefined,
          restrictedAt: input.status === "risk_restricted" ? at : undefined,
          exitedAt: input.status === "exited" ? at : undefined,
          closedAt: input.status === "closed" ? at : undefined
        },
        membership.status,
        {
          customerId,
          scope: "membership",
          action: membershipAction(membership.status, input.status),
          captureEnterpriseRecipients: customer.customerType === "corporate",
          fromStatus: membership.status,
          toStatus: input.status,
          reason,
          operator,
          at
        },
        tx
      );
      if (count && input.status !== "active") {
        // The locked server-side master selects the authority owner. Corporate
        // membership changes revoke this enterprise's relations, not its employees'
        // personal accounts or their relationships with another enterprise.
        if (customer.customerType === "corporate") {
          await this.customers.invalidateCorporateEnterpriseAuthority(tenantId, customerId, tx);
        } else {
          await this.customers.invalidatePersonalEnterpriseAuthority(tenantId, customerId, tx);
        }
      }
      return count;
    });
    if (changed === 0) {
      throw new ConflictException("租户会员状态已被其他人修改，请刷新后重试");
    }
    const updated = await this.customers.findMembership(tenantId, customerId);
    if (!updated) throw new NotFoundException("租户会员关系读取失败");
    return updated;
  }

  /**
   * 该客户此刻能否在目标空间开展新业务；会员状态读取全租户唯一事实。
   *
   * 判定顺序即优先级：主档已合并 → 账号不可用 → 未开通会员 → 租户会员不可用。
   * 返回结构化结论区分账号与会员限制，不把两种独立状态混为一谈。
   *
   * 本方法**只读**、不写审计：它会被下单、报价等高频路径调用，
   * 每次判定都写一行会把审计表变成流量日志。真正的动作留痕在各自的业务审计里。
   */
  async assertTransactable(
    tenantId: string,
    workspaceId: string,
    customerId: string
  ): Promise<CustomerTransactability> {
    return this.evaluateTransactability(tenantId, workspaceId, customerId);
  }

  /** 订单事务内的权威门禁：先取得与状态变更共用的行锁，再读取最新事实。 */
  async assertTransactableForNewBusiness(
    tenantId: string,
    workspaceId: string,
    customerId: string,
    tx: CustomerTx
  ): Promise<CustomerTransactability> {
    if (!(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
      return { allowed: false, reasonCode: "customer_not_found", message: "客户不存在" };
    }
    return this.evaluateTransactability(tenantId, workspaceId, customerId, tx);
  }

  private async evaluateTransactability(
    tenantId: string,
    workspaceId: string,
    customerId: string,
    tx?: CustomerTx
  ): Promise<CustomerTransactability> {
    const gate = await this.customers.findBusinessGate(tenantId, workspaceId, customerId, tx);
    if (!gate) {
      return { allowed: false, reasonCode: "customer_not_found", message: "客户不存在" };
    }
    if (gate.mergedIntoCustomerId) {
      return {
        allowed: false,
        reasonCode: "customer_merged",
        message: "该客户主档已被合并，请使用保留主档下单"
      };
    }
    const account = gate.account;
    // 没有账号不阻止业务：线下客户可以由门店代客下单，需求并未要求人人有登录账号。
    if (account && account.status !== "active") {
      return {
        allowed: false,
        reasonCode: account.status === "closed" ? "account_closed" : "account_suspended",
        message:
          account.status === "closed"
            ? "该客户账号已注销，全部经营空间均不可开展新业务"
            : "该客户账号已停用，全部经营空间均不可开展新业务",
        accountStatus: account.status
      };
    }
    const membership = gate.membership;
    if (!membership) {
      return {
        allowed: false,
        reasonCode: "membership_missing",
        message: "该客户尚未开通租户会员",
        accountStatus: account?.status
      };
    }
    if (membership.status !== "active") {
      return {
        allowed: false,
        reasonCode: `membership_${membership.status}`,
        message:
          membership.status === "risk_restricted"
            ? "该客户在本租户处于风险受限状态，需先完成复核"
            : `该客户在本租户的会员关系为 ${membership.status}，不可开展新业务`,
        accountStatus: account?.status,
        membershipStatus: membership.status
      };
    }
    return { allowed: true, accountStatus: account?.status, membershipStatus: membership.status };
  }

  private assertIdentityVerificationPermission(user: SystemUserRow | undefined, manage: boolean) {
    if (!user || user.isSaasAdmin) throw new ForbiddenException("无权访问客户实名核验资料");
    const permissions = new Set(user.permissions ?? []);
    const has = (permission: string) => user.isPlatformAdmin || permissions.has("*") || permissions.has(permission);
    if (!has(CUSTOMER_REVEAL_PERMISSION) || !has(manage ? "rental-os:member:manage" : "rental-os:member:view")) {
      throw new ForbiddenException("需要会员查看/管理与客户敏感资料解密权限");
    }
  }

  /** 实名记录和证据影像仍受会员数据范围限制，知道客户 ID 不构成跨空间访问授权。 */
  async assertIdentityVerificationCustomerAccess(
    tenantId: string,
    customerId: string,
    user: SystemUserRow | undefined,
    manage: boolean
  ) {
    this.assertIdentityVerificationPermission(user, manage);
    const scope = getRequestDataScope() ?? user?.dataScope;
    if (scope && (scope !== "all" || getRequestLocationIds() !== undefined)) {
      await this.assertCustomerVisibleInRequestScope(
        tenantId,
        getRequestWorkspaceId(),
        customerId,
        scope,
        getRequestUserId() ?? user?.id
      );
    }
    const customer = await this.prisma.customerProfile.findFirst({
      where: { tenantId, id: customerId },
      select: { id: true }
    });
    if (!customer) throw new NotFoundException("客户不存在或不在当前账号的数据范围内");
  }

  private identityVerificationSummary(row: {
    id: string; tenantId: string; customerId: string; credentialType: string; result: string;
    evidenceFileAssetIds: Prisma.JsonValue; reason: string; reviewerUserId: string; reviewerName: string;
    reviewedAt: Date; verifiedAt: Date | null;
  }): CustomerIdentityVerificationSummary {
    const evidenceFileAssetIds = Array.isArray(row.evidenceFileAssetIds)
      ? row.evidenceFileAssetIds.filter((value): value is string => typeof value === "string")
      : [];
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      credentialType: row.credentialType,
      result: row.result as CustomerIdentityVerificationSummary["result"],
      evidenceFileAssetIds,
      reason: row.reason,
      reviewerUserId: row.reviewerUserId,
      reviewerName: row.reviewerName,
      reviewedAt: row.reviewedAt.toISOString(),
      verifiedAt: row.verifiedAt?.toISOString()
    };
  }

  async listIdentityVerifications(tenantId: string, customerId: string, user?: SystemUserRow) {
    await this.assertIdentityVerificationCustomerAccess(tenantId, customerId, user, false);
    const rows = await this.prisma.customerIdentityVerification.findMany({
      where: { tenantId, customerId },
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]
    });
    await this.operations.recordSensitiveAccess(tenantId, {
      workspaceId: getRequestWorkspaceId(), customerId, field: "customer_identity_verifications", action: "reveal",
      revealed: true, operator: user?.displayName, permission: CUSTOMER_REVEAL_PERMISSION,
      reason: "查看客户实名核验记录", at: stamp()
    });
    return rows.map((row) => this.identityVerificationSummary(row));
  }

  async saveIdentityVerification(
    tenantId: string,
    customerId: string,
    input: SaveCustomerIdentityVerificationRequest,
    user?: SystemUserRow
  ) {
    await this.assertIdentityVerificationCustomerAccess(tenantId, customerId, user, true);
    const credentialType = input.credentialType.trim().toLowerCase();
    const reason = input.reason.trim();
    const evidenceFileAssetIds = [...new Set(input.evidenceFileAssetIds.map((id) => id.trim()).filter(Boolean))];
    if (!/^[a-z][a-z0-9_-]{0,31}$/u.test(credentialType)) throw new BadRequestException("证件类型编码无效");
    if (!reason || reason.length > 500) throw new BadRequestException("核验原因必填且不能超过 500 个字符");
    if (evidenceFileAssetIds.length > 5) throw new BadRequestException("每次核验最多关联 5 个证据文件");
    if (input.result === "verified" && evidenceFileAssetIds.length === 0) throw new BadRequestException("核验通过必须关联至少一份证据文件");
    if (!user?.id) throw new ForbiddenException("无法确认核验操作人");

    if (evidenceFileAssetIds.length) {
      const assets = await this.prisma.fileAsset.findMany({
        where: {
          tenantId, id: { in: evidenceFileAssetIds }, status: "active", businessModule: "membership",
          businessType: "customer", businessId: customerId, uploadScene: "identity-verification",
          mimeType: { in: ["image/jpeg", "image/png", "image/webp", "application/pdf"] }
        },
        select: { id: true }
      });
      if (assets.length !== evidenceFileAssetIds.length) throw new BadRequestException("证据文件未完成上传，或不属于该客户的实名核验资料");
    }

    const now = new Date();
    const saved = await this.prisma.$transaction(async (tx) => {
      if (input.result === "revoked") {
        const latestForCredential = await tx.customerIdentityVerification.findFirst({
          where: { tenantId, customerId, credentialType },
          orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          select: { result: true }
        });
        if (latestForCredential?.result !== "verified") throw new ConflictException("只有当前已通过的证件核验可以撤销");
      }
      const row = await tx.customerIdentityVerification.create({
        data: {
          tenantId, customerId, credentialType, result: input.result,
          evidenceFileAssetIds: evidenceFileAssetIds as Prisma.InputJsonValue,
          reason, reviewerUserId: user.id, reviewerName: user.displayName, reviewedAt: now,
          verifiedAt: input.result === "verified" ? now : null
        }
      });
      if (["identity_card", "passport", "national_id"].includes(credentialType)) {
        // 多种法定证件是各自独立的核验状态。撤销护照不能把仍有效的身份证
        // 一并变成未认证；主档布尔只表达“至少有一种主要身份证件当前已通过”。
        const identityRecords = await tx.customerIdentityVerification.findMany({
          where: { tenantId, customerId, credentialType: { in: ["identity_card", "passport", "national_id"] } },
          orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          select: { credentialType: true, result: true }
        });
        const latestByCredential = new Map<string, string>();
        for (const record of identityRecords) {
          if (!latestByCredential.has(record.credentialType)) latestByCredential.set(record.credentialType, record.result);
        }
        await this.customers.setIdentityVerificationState(
          tenantId,
          customerId,
          [...latestByCredential.values()].some((result) => result === "verified"),
          tx
        );
      }
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.identityVerificationSummary(saved);
  }

  private async assertRiskCustomerVisible(
    tenantId: string,
    workspaceId: string,
    customerId: string,
    user?: SystemUserRow
  ) {
    const scope = getRequestDataScope() ?? user?.dataScope;
    const locationIds = getRequestLocationIds();
    if (scope && (scope !== "all" || locationIds !== undefined)) {
      await this.assertCustomerVisibleInRequestScope(
        tenantId,
        workspaceId,
        customerId,
        scope,
        getRequestUserId() ?? user?.id
      );
    }
  }

  private assertTenantWideRiskPermission(user?: SystemUserRow) {
    const scope = getRequestDataScope() ?? user?.dataScope;
    const unrestricted = user?.isPlatformAdmin || user?.permissions?.includes("*") ||
      (scope === "all" && getRequestLocationIds() === undefined);
    if (!unrestricted) {
      throw new ForbiddenException("创建或处理租户级风险记录需要不受空间与地点限制的管理范围");
    }
  }

  async listRiskRecords(
    tenantId: string,
    workspaceId: string | undefined,
    customerId: string,
    user?: SystemUserRow
  ): Promise<CustomerRiskRecordSummary[]> {
    if (!workspaceId) throw new ForbiddenException("查看会员风险记录需要已授权的经营空间");
    await this.assertRiskCustomerVisible(tenantId, workspaceId, customerId, user);
    return this.operations.listRiskRecords(tenantId, customerId, workspaceId);
  }

  /**
   * 添加风险事实必须与订单最终风控检查争用同一客户主档锁。
   * MySQL 外键只保证关联存在，不保证子表 INSERT 等待这个业务锁；
   * 因此所有受支持的风险写入都必须通过本事务入口。
   */
  async createRiskRecord(
    tenantId: string,
    workspaceId: string | undefined,
    customerId: string,
    input: CreateCustomerRiskRecordRequest,
    operator?: string,
    user?: SystemUserRow
  ): Promise<CustomerRiskRecordSummary> {
    if (!workspaceId) throw new ForbiddenException("添加会员风险记录需要已授权的经营空间");
    if (!CUSTOMER_RISK_TYPES.includes(input.riskType) || !CUSTOMER_RISK_LEVELS.includes(input.level)) {
      throw new BadRequestException("风险类型或等级无效");
    }
    const detail = input.detail?.trim();
    if (!detail) throw new BadRequestException("风险说明不能为空");
    if (input.scope === "tenant") this.assertTenantWideRiskPermission(user);
    await this.assertRiskCustomerVisible(tenantId, workspaceId, customerId, user);

    return this.prisma.$transaction(async (tx) => {
      // The risk INSERT checks a Tenant FK. Take its shared fence before the customer
      // gate so a concurrent Tenant→customer merge/status write cannot reverse the order.
      // This path never upgrades the shared fence to an exclusive authorization lock.
      const tenants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id=${tenantId} LOCK IN SHARE MODE`;
      if (!tenants.length || !(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
        throw new NotFoundException("客户不存在或不属于当前租户");
      }
      return this.operations.createRiskRecord({
        tenantId,
        customerId,
        workspaceId: input.scope === "tenant" ? null : workspaceId,
        riskType: input.riskType,
        level: input.level,
        detail,
        source: "manual",
        raisedBy: operator,
        raisedAt: new Date()
      }, tx);
    });
  }

  async reviewRiskRecord(
    tenantId: string,
    workspaceId: string | undefined,
    customerId: string,
    riskRecordId: string,
    input: ReviewCustomerRiskRecordRequest,
    operator?: string,
    user?: SystemUserRow
  ): Promise<CustomerRiskRecordSummary> {
    if (!workspaceId) throw new ForbiddenException("处理会员风险记录需要已授权的经营空间");
    if (input.status !== "reviewing" && input.status !== "closed") {
      throw new BadRequestException("风险记录只能进入复核中或关闭状态");
    }
    const reason = input.reason?.trim();
    if (input.status === "closed" && !reason) {
      throw new BadRequestException("关闭风险记录必须填写处理结果");
    }
    await this.assertRiskCustomerVisible(tenantId, workspaceId, customerId, user);

    return this.prisma.$transaction(async (tx) => {
      if (!(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
        throw new NotFoundException("客户不存在或不属于当前租户");
      }
      const current = await this.operations.findRiskRecord(tenantId, customerId, riskRecordId, workspaceId, tx);
      if (!current) throw new NotFoundException("风险记录不存在或不在当前经营空间");
      if (!current.workspaceId) this.assertTenantWideRiskPermission(user);
      if (current.status === "closed") throw new ConflictException("已关闭的风险记录不可再次处理");
      if (input.status === "reviewing" && current.status !== "open") {
        throw new ConflictException("只有待处理的风险记录可以进入复核中");
      }

      const reviewedAt = new Date();
      const updated = await this.operations.updateRiskRecordDecision(
        tenantId,
        customerId,
        riskRecordId,
        {
          status: input.status,
          reviewedBy: operator,
          reviewedAt,
          ...(input.status === "closed" ? { closeReason: reason, closedAt: reviewedAt } : {})
        },
        tx
      );
      if (!updated) throw new ConflictException("风险记录已被其他操作更新，请刷新后重试");
      return updated;
    });
  }

  /** 客户状态时间线：账号、会员全局事件与可选的历史空间事件。 */
  listStatusHistory(tenantId: string, customerId: string, workspaceId?: string, includeWorkspaceEvents = true) {
    return this.operations.listStatusHistory(tenantId, customerId, workspaceId, includeWorkspaceEvents);
  }

  /** 敏感资料访问时间线。只有具备解密权限的人才能查——否则它本身就是一份访问画像。 */
  async listSensitiveAccess(tenantId: string, customerId: string, user?: SystemUserRow) {
    if (!this.canReveal(user)) {
      throw new ForbiddenException("查看敏感资料访问审计需要「客户敏感资料解密」权限");
    }
    const locationIds = getRequestLocationIds();
    if (locationIds !== undefined) {
      // 审计记录尚无履约地点维度，不能把同空间其他地点的敏感访问轨迹
      // 返回给地点受限账号；不以“客户在某地点可见”推导其整份审计可见。
      throw new ForbiddenException("敏感资料访问审计尚未按履约地点归属，地点受限账号暂不可查看");
    }
    const scope = getRequestDataScope() ?? user?.dataScope;
    const workspaceId = getRequestWorkspaceId();
    if (!workspaceId) throw new ForbiddenException("查看敏感资料访问审计需要已授权的经营空间");
    if (scope && (scope !== "all" || locationIds !== undefined)) {
      await this.assertCustomerVisibleInRequestScope(
        tenantId,
        workspaceId,
        customerId,
        scope,
        getRequestUserId() ?? user?.id
      );
    }
    return this.operations.listSensitiveAccess(tenantId, customerId, workspaceId);
  }

  /**
   * 客户资料页的聚合读模型。
   *
   * 这是管理端查看资料的唯一汇总入口：身份主档按租户读取，订单、地址、
   * 会员方案授予、积分、奖励和优惠券都保留 workspace 维度，避免页面把不同
   * 品类空间的经营事实错误地合并成一个余额或一张“总订单”。
   */
  async getProfileOverview(
    tenantId: string,
    workspaceId: string | undefined,
    customerId: string,
    user?: SystemUserRow,
    query: CustomerProfileOrderQuery = {}
  ): Promise<CustomerProfileOverview> {
    if (!workspaceId || !user?.isActive || user.isSaasAdmin || user.tenantId !== tenantId
      || getRequestWorkspaceId() !== workspaceId) throw new ForbiddenException("查看会员经营资料需要已授权的经营空间");
    const identity = getRequestIdentity();
    if (identity?.tenantId !== tenantId || identity.userId !== user.id || !getRequestDataScope()) {
      throw new ForbiddenException("会员经营投影缺少当前已验证的租户、账号或数据范围");
    }
    const requestLocations = getRequestLocationIds();
    if (user.dataScope !== getRequestDataScope() || user.locationScope?.mode === "selected"
      && (requestLocations === undefined || requestLocations.some(id => !user.locationScope!.locationIds.includes(id)))) {
      throw new ForbiddenException("会员经营数据范围已变化，须重新核对当前请求授权");
    }
    const hasPermission = (code: string) => Boolean(user.isPlatformAdmin || user.permissions?.includes("*") || user.permissions?.includes(code))
      && (identity.permissions === undefined || identity.isPlatformAdmin === true || identity.permissions.includes("*") || identity.permissions.includes(code));
    if (!hasPermission("rental-os:member:view")) throw new ForbiddenException("客户资料需要当前会员查看权限");
    // 无订单/地点归属的权益与审计不可裁剪为本人事实；仅订单使用已有数据库谓词。
    const restricted = user.dataScope !== "all" || user.locationScope?.mode === "selected"
      || getRequestDataScope() !== "all" || getRequestLocationIds() !== undefined;
    const canReadOrders = hasPermission("rental-os:order:view");
    const canReadAmounts = canReadOrders && hasPermission("rental-os:finance:view");
    const canReadBenefits = !restricted && hasPermission("rental-os:marketing:manage") && hasPermission("rental-os:finance:view");
    const canReadQualifications = !restricted;
    const canReadAudit = !restricted;
    const profile = await this.getCustomerDetail(tenantId, workspaceId, customerId, user);
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 20)));
    const orderVisibility: Prisma.RentalOrderWhereInput[] = [];
    const locationIds = getRequestLocationIds();
    if (locationIds !== undefined) {
      const safeIds = locationIds.length ? locationIds : ["__no_authorized_location__"];
      orderVisibility.push({ OR: [
        { fulfillmentLocationId: { in: safeIds } },
        { returnLocationId: { in: safeIds } }
      ] });
    }
    if (getRequestDataScope() === "own") {
      const userId = getRequestUserId();
      orderVisibility.push(userId ? { OR: [
        { createdBy: userId },
        { workOrders: { some: { OR: [{ createdBy: userId }, { assigneeId: userId }] } } }
      ] } : { id: "__no_current_user__" });
    }
    const orderWhere: Prisma.RentalOrderWhereInput = {
      tenantId,
      workspaceId,
      OR: [
        { customerId },
        { contractSubjectCustomerId: customerId },
        { payerSubjectCustomerId: customerId },
        { userSubjectCustomerId: customerId },
        { membershipSnapshot: { path: "$.personalCustomerId", equals: customerId } }
      ],
      ...(orderVisibility.length ? { AND: orderVisibility } : {})
    };

    const [
      addresses,
      qualificationRevisions,
      statusHistory,
      ordersTotal,
      orders,
      benefitAccounts,
      rewards,
      coupons,
      assignments,
      corporateRelations,
      sensitiveAccess,
      insights
    ] = await Promise.all([
      this.prisma.customerDeliveryAddress.findMany({
        where: { tenantId, customerId, status: "active" },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
      }),
      canReadQualifications ? this.prisma.customerQualificationRevision.findMany({
        where: { tenantId, workspaceId, customerId },
        orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }]
      }) : Promise.resolve([]),
      canReadAudit ? this.operations.listStatusHistory(tenantId, customerId, workspaceId, true) : Promise.resolve([]),
      canReadOrders ? this.prisma.rentalOrder.count({ where: orderWhere }) : Promise.resolve(0),
      canReadOrders ? this.prisma.rentalOrder.findMany({
        where: orderWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNo: true,
          workspaceId: true,
          categoryCode: true,
          status: true,
          customerId: true,
          contractSubjectCustomerId: true,
          payerSubjectCustomerId: true,
          userSubjectCustomerId: true,
          membershipSnapshot: true,
          startAt: true,
          endAt: true,
          effectiveEndAt: true,
          finalPayableAmount: canReadAmounts,
          currency: true,
          createdAt: true,
          workspace: { select: { id: true, name: true } }
        }
      }) : Promise.resolve([]),
      canReadBenefits ? this.prisma.rentalBenefitAccount.findMany({
        where: { tenantId, workspaceId, customerId },
        orderBy: [{ updatedAt: "desc" }],
        include: { workspace: { select: { id: true, name: true, categoryCode: true } } }
      }) : Promise.resolve([]),
      canReadBenefits ? this.prisma.rentalRewardLedgerEntry.findMany({
        where: { tenantId, workspaceId, customerId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
        include: { workspace: { select: { id: true, name: true } } }
      }) : Promise.resolve([]),
      canReadBenefits ? this.prisma.rentalCustomerCoupon.findMany({
        where: { tenantId, workspaceId, customerId },
        orderBy: [{ claimedAt: "desc" }, { id: "desc" }],
        take: 200,
        include: { workspace: { select: { id: true, name: true } } }
      }) : Promise.resolve([]),
      this.prisma.customerMembershipPlanAssignment.findMany({
        where: { tenantId, customerId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { plan: { select: { name: true } } }
      }),
      this.prisma.customerCorporateMembership.findMany({
        where: { tenantId, OR: [{ corporateCustomerId: customerId }, { personalCustomerId: customerId }] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          corporateCustomer: { select: { id: true, name: true } },
          personalCustomer: { select: { id: true, name: true } }
        }
      }),
      this.canReveal(user) && canReadAudit
        ? this.operations.listSensitiveAccess(tenantId, customerId, workspaceId)
        : Promise.resolve(undefined),
      readCustomerInsights(this.prisma, orderWhere)
    ]);

    return {
      access: { orders: canReadOrders ? "available" : "restricted", orderAmounts: canReadAmounts ? "available" : "restricted",
        benefits: canReadBenefits ? "available" : "restricted", qualifications: canReadQualifications ? "available" : "restricted",
        audit: canReadAudit ? "available" : "restricted" },
      profile,
      addresses: addresses.map((row) => ({
        id: row.id,
        revision: row.revision,
        recipient: row.recipient,
        phoneMasked: row.phoneMasked,
        countryCode: row.countryCode,
        province: row.province,
        city: row.city,
        district: row.district ?? undefined,
        detail: row.detail,
        postalCode: row.postalCode ?? undefined,
        latitude: row.latitude === null ? undefined : Number(row.latitude),
        longitude: row.longitude === null ? undefined : Number(row.longitude),
        isDefault: row.isDefault,
        updatedAt: row.updatedAt.toISOString()
      })),
      qualificationRevisions: qualificationRevisions.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
        customerId: row.customerId,
        qualificationType: row.qualificationType,
        categoryCode: String(row.categoryCode).toLowerCase() as CustomerProfileOverview["qualificationRevisions"][number]["categoryCode"],
        capabilityCode: row.capabilityCode ?? undefined,
        applicableScope: row.applicableScope as never,
        referenceNoMasked: row.referenceNoMasked ?? undefined,
        issuedAt: row.issuedAt?.toISOString(),
        expiresAt: row.expiresAt?.toISOString(),
        evidenceRef: row.evidenceRef ?? undefined,
        source: row.source,
        submittedBy: row.submittedBy ?? undefined,
        submittedAt: row.submittedAt.toISOString(),
        qualificationStatus: row.qualificationStatus as never,
        reviewStatus: row.reviewStatus as never,
        reviewReason: row.reviewReason ?? undefined,
        reviewedBy: row.reviewedBy ?? undefined,
        reviewedAt: row.reviewedAt?.toISOString(),
        reviewId: row.reviewId ?? undefined,
        createdAt: row.createdAt.toISOString()
      })),
      statusHistory,
      sensitiveAccess,
      corporateRelations: corporateRelations.map((row) => ({
        id: row.id,
        corporateCustomerId: row.corporateCustomerId,
        corporateName: row.corporateCustomer.name,
        personalCustomerId: row.personalCustomerId,
        personalCustomerName: row.personalCustomer.name,
        role: row.role,
        department: row.department ?? undefined,
        employeeNo: row.employeeNo ?? undefined,
        status: row.status,
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: row.effectiveTo?.toISOString(),
        reason: row.reason ?? undefined
      })),
      membershipPlanAssignments: assignments.map((row) => ({
        id: row.id,
        planId: row.planId,
        planVersionId: row.planVersionId,
        planName: row.plan.name,
        source: row.source,
        status: row.status,
        effectiveFrom: row.effectiveFrom.toISOString(),
        effectiveTo: row.effectiveTo?.toISOString(),
        reason: row.reason ?? undefined,
        revokedAt: row.revokedAt?.toISOString(),
        revokeReason: row.revokeReason ?? undefined,
        snapshot: (row.snapshot ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString()
      })),
      benefits: {
        accounts: benefitAccounts.map((row) => ({
          workspaceId: row.workspace.id,
          workspaceName: row.workspace.name,
          categoryCode: String(row.workspace.categoryCode).toLowerCase() as CustomerProfileOverview["benefits"]["accounts"][number]["categoryCode"],
          pointsBalance: Number(row.pointsBalance),
          marketingBalance: Number(row.marketingBalance),
          availableRewardCouponCount: row.availableRewardCouponCount,
          updatedAt: row.updatedAt.toISOString()
        })),
        rewards: rewards.map((row) => ({
          id: row.id,
          workspaceId: row.workspace.id,
          workspaceName: row.workspace.name,
          rewardType: row.rewardType,
          amount: Number(row.amount),
          triggerType: row.triggerType,
          status: row.status,
          reason: row.reason,
          appliedAt: row.appliedAt?.toISOString(),
          createdAt: row.createdAt.toISOString(),
          reversedAt: row.reversedAt?.toISOString()
        })),
        coupons: coupons.map((row) => ({
          id: row.id,
          workspaceId: row.workspace.id,
          workspaceName: row.workspace.name,
          templateName: row.templateName,
          templateCode: row.templateCode,
          templateVersion: row.templateVersion,
          discountType: row.discountType,
          discountValue: Number(row.discountValue),
          status: row.status,
          grantReason: row.grantReason,
          effectiveFrom: row.effectiveFrom.toISOString(),
          effectiveTo: row.effectiveTo.toISOString(),
          lockedOrderId: row.lockedOrderId ?? undefined,
          redeemedOrderId: row.redeemedOrderId ?? undefined,
          lockedDiscountAmount: row.lockedDiscountAmount === null ? undefined : Number(row.lockedDiscountAmount),
          createdAt: row.claimedAt.toISOString()
        }))
      },
      insights,
      orders: {
        items: orders.map((row) => {
          const snapshot = row.membershipSnapshot as { personalCustomerId?: unknown } | null;
          const relation = new Set<"customer" | "contract_subject" | "payer" | "user" | "booking_identity">();
          if (row.customerId === customerId) relation.add("customer");
          if (row.contractSubjectCustomerId === customerId) relation.add("contract_subject");
          if (row.payerSubjectCustomerId === customerId) relation.add("payer");
          if (row.userSubjectCustomerId === customerId) relation.add("user");
          if (snapshot?.personalCustomerId === customerId) relation.add("booking_identity");
          return {
            id: row.id,
            orderNo: row.orderNo,
            workspaceId: row.workspace.id,
            workspaceName: row.workspace.name,
            categoryCode: String(row.categoryCode).toLowerCase() as CustomerProfileOverview["orders"]["items"][number]["categoryCode"],
            status: String(row.status).toLowerCase(),
            relation: [...relation],
            startAt: row.startAt.toISOString(),
            endAt: row.endAt.toISOString(),
            effectiveEndAt: row.effectiveEndAt?.toISOString(),
            ...(canReadAmounts ? { finalPayableAmount: Number(row.finalPayableAmount) } : {}),
            currency: row.currency,
            createdAt: row.createdAt.toISOString()
          };
        }),
        page,
        pageSize,
        total: ordersTotal
      }
    };
  }

  private addressPhone(value: string | undefined, existing?: string | null) {
    const candidate = value?.trim() || existing?.trim() || "";
    if (!candidate) throw new BadRequestException("联系电话不能为空");
    const phone = candidate.replace(/[\s-]/gu, "");
    if (/\*/u.test(phone) || !/^\+?[0-9]{6,20}$/u.test(phone)) {
      throw new BadRequestException("联系电话格式无效；编辑时留空表示保留原电话");
    }
    return phone;
  }

  private addressText(value: string | undefined, label: string, max: number, required: boolean) {
    const text = value?.trim() ?? "";
    if (!text && required) throw new BadRequestException(`${label}不能为空`);
    if (text.length > max) throw new BadRequestException(`${label}最多 ${max} 个字符`);
    return text || undefined;
  }

  private addressView(row: {
    id: string; revision: number; recipient: string; phoneMasked: string; countryCode: string;
    province: string; city: string; district: string | null; detail: string; postalCode: string | null;
    latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null; isDefault: boolean; updatedAt: Date;
  }) {
    return {
      id: row.id,
      revision: row.revision,
      recipient: row.recipient,
      phoneMasked: row.phoneMasked,
      countryCode: row.countryCode,
      province: row.province,
      city: row.city,
      district: row.district ?? undefined,
      detail: row.detail,
      postalCode: row.postalCode ?? undefined,
      latitude: row.latitude === null ? undefined : Number(row.latitude),
      longitude: row.longitude === null ? undefined : Number(row.longitude),
      isDefault: row.isDefault,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  async saveCustomerAddress(tenantId: string, customerId: string, input: SaveCustomerProfileAddressRequest) {
    const customer = await this.prisma.customerProfile.findFirst({ where: { tenantId, id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException("客户不存在");
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = input.id
        ? await tx.customerDeliveryAddress.findFirst({ where: { tenantId, customerId, id: input.id, status: "active" } })
        : null;
      if (input.id && !existing) throw new NotFoundException("地址不存在");
      if (existing && input.revision !== undefined && input.revision !== existing.revision) throw new ConflictException("地址已被修改，请刷新后重试");
      if (!existing && !input.phone) {
        throw new BadRequestException("新地址必须填写联系电话");
      }
      if (!existing) {
        const count = await tx.customerDeliveryAddress.count({ where: { tenantId, customerId, status: "active" } });
        if (count >= 20) throw new ConflictException("最多保存 20 个配送地址");
      }
      const phone = this.addressPhone(input.phone, existing?.phone);
      const countryCode = (this.addressText(input.countryCode, "国家/地区", 8, false) ?? "CN").toUpperCase();
      if (!/^[A-Z]{2,8}$/u.test(countryCode)) throw new BadRequestException("国家/地区编码无效");
      const data = {
        recipient: this.addressText(input.recipient, "收件人", 120, true)!,
        phone,
        phoneMasked: this.mask(phone),
        countryCode,
        province: this.addressText(input.province, "省/直辖市", 64, true)!,
        city: this.addressText(input.city, "城市", 64, true)!,
        district: this.addressText(input.district, "区/县", 64, false) ?? null,
        detail: this.addressText(input.detail, "详细地址", 255, true)!,
        postalCode: this.addressText(input.postalCode, "邮编", 16, false) ?? null,
        latitude: input.latitude === undefined ? null : new Prisma.Decimal(input.latitude),
        longitude: input.longitude === undefined ? null : new Prisma.Decimal(input.longitude)
      };
      const makeDefault = input.isDefault === true || (!existing && (await tx.customerDeliveryAddress.count({ where: { tenantId, customerId, status: "active", isDefault: true } })) === 0);
      if (makeDefault) {
        await tx.customerDeliveryAddress.updateMany({
          where: { tenantId, customerId, status: "active", isDefault: true, ...(existing ? { id: { not: existing.id } } : {}) },
          data: { isDefault: false }
        });
      }
      if (existing) {
        const updated = await tx.customerDeliveryAddress.updateMany({
          where: { id: existing.id, tenantId, customerId, status: "active", revision: existing.revision },
          data: { ...data, isDefault: input.isDefault === undefined ? existing.isDefault : input.isDefault, revision: existing.revision + 1 }
        });
        if (updated.count !== 1) throw new ConflictException("地址已被修改，请刷新后重试");
        return tx.customerDeliveryAddress.findUniqueOrThrow({ where: { id: existing.id } });
      }
      return tx.customerDeliveryAddress.create({ data: { tenantId, customerId, ...data, isDefault: makeDefault, status: "active" } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.addressView(saved);
  }

  async removeCustomerAddress(tenantId: string, customerId: string, addressId: string) {
    const updated = await this.prisma.customerDeliveryAddress.updateMany({
      where: { tenantId, customerId, id: addressId, status: "active" },
      data: { status: "deleted", isDefault: false }
    });
    if (updated.count !== 1) throw new NotFoundException("地址不存在");
    return { success: true as const };
  }
}
