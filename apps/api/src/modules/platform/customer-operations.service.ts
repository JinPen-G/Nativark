import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ChangeCustomerAccountStatusRequest,
  ChangeCustomerMembershipStatusRequest,
  CustomerAccount,
  CustomerAccountStatus,
  CustomerMembershipStatus,
  CustomerStatusAction,
  CustomerTransactability,
  SharedCustomerProfile,
  SystemUserRow
} from "@rental-os/shared";
import { CUSTOMER_ACCOUNT_STATUSES, CUSTOMER_MEMBERSHIP_STATUSES } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { CustomerOperationsRepository, type CustomerTx } from "./customer-operations.repository";
import { SharedCustomerRepository } from "./shared-customer.repository";
import { CustomerMergeService } from "./customer-merge.service";

/** 敏感字段的解密查看权限。与「查看客户」分开授权（需求 4.8.5）。 */
export const CUSTOMER_REVEAL_PERMISSION = "rental-os:customer:reveal-sensitive";

const stamp = () => new Date().toISOString();

/**
 * 空间会员状态的合法迁移。
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

/**
 * CUSTOMER-01B：客户服务端与隔离。
 *
 * 本层要守住的核心口径是**三个层次互不代替**：
 *   1. 主档（`tenantId`）：同租户任一空间都看得到同一个客户——这是需求要的复用；
 *   2. 账号（`tenantId`）：停用账号阻止登录**全部**空间，但不动任何会员关系；
 *   3. 空间会员（`tenantId + workspaceId`）：暂停只影响**目标空间**，不影响登录与其他空间。
 *
 * 把三者压成一个 status 是本任务明确要避免的建模错误，因此这里的每个入口
 * 都显式表明自己作用在哪一层，且空间级入口一律从会话取 `workspaceId`，
 * 不接受调用方传入——否则可以改到自己无权进入的空间。
 */
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
    workspaceId?: string,
    tx?: CustomerTx
  ) {
    if (!this.closability) {
      throw new ConflictException("注销前置检查服务未就绪，已拒绝本次注销");
    }
    const result = await this.closability.assertClosable(tenantId, customerId, workspaceId, tx);
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
    workspaceId: string,
    customerId: string,
    user?: SystemUserRow,
    options: { action?: "detail" | "export"; reason?: string } = {}
  ): Promise<SharedCustomerProfile> {
    const profile = await this.customers.findById(tenantId, customerId, workspaceId);
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

  /** 列表同样脱敏并留痕。列表按租户共享（设计），但关系只带当前空间。 */
  async listCustomers(
    tenantId: string,
    workspaceId: string,
    user?: SystemUserRow
  ): Promise<SharedCustomerProfile[]> {
    const rows = await this.customers.listByTenant(tenantId, workspaceId);
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

  /**
   * 改**账号**状态。影响该客户在全部空间的登录，因此不接受 workspaceId。
   *
   * 状态变更与历史同事务；乐观并发以读到的状态为条件，落败方拿 409 而不是静默覆盖。
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
      if (!(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
        throw new NotFoundException("客户不存在");
      }
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
          undefined,
          tx
        );
      }
      return this.operations.updateAccountStatus(
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
    });
    if (changed === 0) {
      throw new ConflictException("客户账号状态已被其他人修改，请刷新后重试");
    }
    const updated = await this.operations.findAccountByCustomer(tenantId, customerId);
    if (!updated) throw new NotFoundException("客户账号读取失败");
    return updated;
  }

  /**
   * 改**空间会员**状态。只影响当前会话空间——`workspaceId` 由调用方从会话解析后传入，
   * 不来自请求体。
   *
   * 刻意**不**联动账号状态：需求 4.8.6 明确「空间会员状态变化只影响该经营空间，
   * 不自动停用租户级客户账号或其他空间会员关系」。
   */
  async changeMembershipStatus(
    tenantId: string,
    workspaceId: string,
    customerId: string,
    input: ChangeCustomerMembershipStatusRequest,
    operator?: string
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("变更空间会员状态必须填写原因");
    if (!CUSTOMER_MEMBERSHIP_STATUSES.includes(input.status)) {
      throw new BadRequestException(`未知的空间会员状态：${input.status}`);
    }
    const at = stamp();
    const changed = await this.prisma.$transaction(async (tx) => {
      if (!(await this.operations.lockCustomerBusinessGate(tenantId, customerId, tx))) {
        throw new NotFoundException("客户不存在");
      }
      const link = await this.customers.findLink(tenantId, workspaceId, customerId, tx);
      if (!link) throw new NotFoundException("该客户尚未接入当前经营空间");
      if (link.status === input.status) {
        throw new ConflictException(`该客户在本空间已处于 ${input.status} 状态`);
      }
      if (!MEMBERSHIP_TRANSITIONS[link.status].includes(input.status)) {
        throw new ConflictException(
          `空间会员状态不能从 ${link.status} 直接变为 ${input.status}` +
            (link.status === "closed" ? "：已注销的会员关系需先重新激活" : "")
        );
      }
      if (input.status === "closed") {
        // 传 workspaceId：注销的是**本空间**会员关系，只检查本空间的在途业务，
        // 用全租户口径会让另一个空间的在途订单挡住本空间的正常注销。
        await this.assertClosableForClose(
          tenantId,
          customerId,
          input.acknowledgedManualChecks,
          workspaceId,
          tx
        );
      }
      return this.operations.updateMembershipStatus(
        tenantId,
        link.id,
        {
          status: input.status,
          // 等级只允许在回到 active 时调整：暂停或注销时改等级会让历史等级失去解释。
          levelName: input.status === "active" ? input.levelName : undefined,
          suspendedAt: input.status === "suspended" ? at : undefined,
          restrictedAt: input.status === "risk_restricted" ? at : undefined,
          exitedAt: input.status === "exited" ? at : undefined,
          closedAt: input.status === "closed" ? at : undefined
        },
        link.status,
        {
          customerId,
          scope: "workspace",
          workspaceId,
          action: membershipAction(link.status, input.status),
          fromStatus: link.status,
          toStatus: input.status,
          reason,
          operator,
          at
        },
        tx
      );
    });
    if (changed === 0) {
      throw new ConflictException("空间会员状态已被其他人修改，请刷新后重试");
    }
    const updated = await this.customers.findLink(tenantId, workspaceId, customerId);
    if (!updated) throw new NotFoundException("空间会员关系读取失败");
    return updated;
  }

  /**
   * 该客户此刻能否在本空间开展**新业务**（需求验收「停用客户会阻止目标空间新业务」）。
   *
   * 判定顺序即优先级：主档已合并 → 账号不可用 → 未接入本空间 → 本空间会员不可用。
   * 返回结构化结论而不是布尔：被拒时客服要能立刻知道该找谁处理，
   * 「账号被风控停了」和「这个空间把他暂停了」是两个完全不同的工单。
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
    const link = gate.workspaceLinks[0];
    if (!link) {
      return {
        allowed: false,
        reasonCode: "membership_missing",
        message: "该客户尚未接入本经营空间",
        accountStatus: account?.status
      };
    }
    if (link.status !== "active") {
      return {
        allowed: false,
        reasonCode: `membership_${link.status}`,
        message:
          link.status === "risk_restricted"
            ? "该客户在本空间处于风险受限状态，需先完成复核"
            : `该客户在本空间的会员关系为 ${link.status}，不可开展新业务`,
        accountStatus: account?.status,
        membershipStatus: link.status
      };
    }
    return { allowed: true, accountStatus: account?.status, membershipStatus: link.status };
  }

  /** 客户状态时间线：账号级与空间级同一条线（账号级变更同样影响本空间）。 */
  listStatusHistory(tenantId: string, customerId: string, workspaceId?: string) {
    return this.operations.listStatusHistory(tenantId, customerId, workspaceId);
  }

  /** 敏感资料访问时间线。只有具备解密权限的人才能查——否则它本身就是一份访问画像。 */
  async listSensitiveAccess(tenantId: string, customerId: string, user?: SystemUserRow) {
    if (!this.canReveal(user)) {
      throw new ForbiddenException("查看敏感资料访问审计需要「客户敏感资料解密」权限");
    }
    return this.operations.listSensitiveAccess(tenantId, customerId);
  }
}
