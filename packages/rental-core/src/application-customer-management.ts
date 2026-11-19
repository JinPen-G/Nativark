/** 原平台客户门面的唯一实现：租户/经营空间解析、目标状态权限、敏感资料与财务范围沿原流程。
 * 宿主供给同一客户应用与当前空间主体读取器；此层不构造仓储，不替代原 Guard 或业务事务。
 */
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestDataScope, getRequestLocationIds, getRequestWorkspaceId, requireRequestTenantId,
  requireRequestWorkspaceId } from "@rental-os/platform-server/request-identity";
import type { CustomerProfileOrderQuery, SaveCustomerProfileAddressRequest, ChangeCustomerAccountStatusRequest, ChangeCustomerMembershipStatusRequest, SaveCustomerIdentityVerificationRequest, CreateCustomerRiskRecordRequest, ReviewCustomerRiskRecordRequest, MergeCustomersRequest, SaveCustomerInvoiceProfileRequest, SaveCustomerContractRequest, SaveCustomerCreditRequest, SaveSharedCustomerRequest, RecordCustomerCorporateCreditMaturityRequest, ReverseCustomerCorporateCreditPaymentRequest, RecordCustomerCorporateCreditPaymentRequest } from "./contracts";
import type { RentalAuthenticationSource } from "./auth-source";
import type { SharedCustomerRepository } from "./mysql-customer-master";
import type { CustomerOperationsService } from "./mysql-customer-governance";
import type { CustomerMergeService } from "./mysql-customer-merge";
import type { CustomerCorporateService } from "./mysql-customer-corporate";
import type { CustomerCorporateSettlementService } from "./mysql-customer-corporate-settlement";
import type { MembershipService } from "./mysql-membership";
import type { RentalApplication } from "./application";

export interface RentalCustomerManagementDependencies {
  configService: Pick<ConfigService, "get">;
  principals: Pick<RentalAuthenticationSource, "findWorkspaceScopedUser">;
  sharedCustomers?: Pick<SharedCustomerRepository, "findById">;
  customerOperations?: Pick<CustomerOperationsService, "listCustomers" | "getCustomerDetail" | "getProfileOverview" | "saveCustomerAddress" | "removeCustomerAddress" | "ensureAccount" | "changeAccountStatus" | "changeMembershipStatus" | "listStatusHistory" | "listIdentityVerifications" | "saveIdentityVerification" | "listRiskRecords" | "createRiskRecord" | "reviewRiskRecord" | "listSensitiveAccess" | "assertTransactable">;
  customerMerge?: Pick<CustomerMergeService, "findDuplicates" | "previewMerge" | "mergeCustomers" | "assertClosable">;
  customerCorporate?: Pick<CustomerCorporateService<Prisma.TransactionClient>, "listInvoiceProfiles" | "saveInvoiceProfile" | "listContracts" | "saveContract" | "getCredit" | "saveCredit">;
  customerCorporateSettlement?: Pick<CustomerCorporateSettlementService<Prisma.TransactionClient>, "financialAccount" | "listLedger" | "recordMaturity" | "readMaturity" | "readPaymentReversal" | "reversePayment" | "recordPayment">;
  memberships?: Pick<MembershipService, "saveCorporateMember" | "registerPersonal">;
}

/** 完整宿主只选择已经构造的实例；原组合宿主仍可用上方依赖合同保留原可选依赖语义。 */
export function createRentalCustomerManagementApplication(application: RentalApplication) {
  return new RentalCustomerManagementApplication({ configService: application.configuration,
    principals: application.authSource, sharedCustomers: application.customers.customers,
    customerOperations: application.customers.customerOperations, customerMerge: application.customers.customerMerge,
    customerCorporate: application.customers.corporate, customerCorporateSettlement: application.customers.corporateSettlement,
    memberships: application.customers.memberships });
}

export class RentalCustomerManagementApplication {
  constructor(private readonly input: RentalCustomerManagementDependencies) {}

  /**
   * SPACE-01：经营空间主档与成员关系一律以 MySQL 为事实源。
   *
   * 刻意不提供内存模式实现：内存假数据源在本项目造成过 P0-01（跨租户泄露被
   * 演示固件掩盖），四份文档都写明不得把内存数据源当成持久化的证明。
   * 空间隔离是安全边界，宁可在无库时明确拒绝，也不给一个"看起来能用"的假实现。
   */
  private requireWorkspaceDataSource() {
    if (!this.useMysqlDataSource()) {
      throw new BadRequestException("经营空间管理需要 MySQL 数据源，当前为内存演示模式");
    }
  }
  private useMysqlDataSource() {
    return (
      this.input.configService.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql"
    ).toLowerCase() === "mysql";
  }
  /** Guard 只能按路径放行候选权限；具体目标状态必须在服务层再次授权。 */
  private assertCustomerActionPermission(user: SystemUserRow | undefined, permission: string, action: string) {
    const allowed = Boolean(
      user && (user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes(permission))
    );
    if (!allowed) throw new ForbiddenException(`${action}需要权限：${permission}`);
  }
  /**
   * 共享客户主档仓储只在连库时注入（不连库的单元测试用位置参数构造本服务）。
   * 缺失时明确拒绝，而不是让 `undefined.xxx` 抛成 500。
   */
  private requireSharedCustomers() {
    if (!this.input.sharedCustomers) {
      throw new BadRequestException("共享客户主档需要 MySQL 数据源，当前为内存演示模式");
    }
    return this.input.sharedCustomers;
  }
  /* ---------- SPACE-04：租户共享客户主档 ---------- */

  listSharedCustomers(currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listCustomers(tenantId, getRequestWorkspaceId(), currentUser);
  }
  /**
   * CUSTOMER-01B 的入口一律在这里解析 `tenantId` 与 `workspaceId` 后转交
   * `CustomerOperationsService`，与本文件其他经营入口同一口径：
   * 空间只从会话取，客户端传什么都不作数。
   */
  private requireCustomerOperations() {
    if (!this.input.customerOperations) {
      throw new ConflictException("客户运营服务未就绪");
    }
    return this.input.customerOperations;
  }
  getCustomerDetail(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().getCustomerDetail(
      tenantId,
      getRequestWorkspaceId(),
      customerId,
      currentUser
    );
  }
  async getCustomerProfileOverview(customerId: string, query: CustomerProfileOrderQuery = {}, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    const workspaceId = requireRequestWorkspaceId();
    if (!currentUser || currentUser.isSaasAdmin) throw new ForbiddenException("会员经营资料需要当前空间账号授权");
    const scoped = await this.input.principals.findWorkspaceScopedUser(currentUser.id, workspaceId);
    if (!scoped?.isActive || scoped.tenantId !== tenantId) throw new ForbiddenException("当前经营空间访问权已失效");
    return this.requireCustomerOperations().getProfileOverview(tenantId, workspaceId, customerId, scoped, query);
  }
  saveCustomerProfileAddress(customerId: string, input: SaveCustomerProfileAddressRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().saveCustomerAddress(tenantId, customerId, input);
  }
  removeCustomerProfileAddress(customerId: string, addressId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().removeCustomerAddress(tenantId, customerId, addressId);
  }
  listSharedCustomersMasked(currentUser?: SystemUserRow) {
    return this.listSharedCustomers(currentUser);
  }
  ensureCustomerAccount(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().ensureAccount(tenantId, customerId, currentUser?.displayName);
  }
  changeCustomerAccountStatus(
    customerId: string,
    input: ChangeCustomerAccountStatusRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    this.assertCustomerActionPermission(
      currentUser,
      input.status === "closed" ? "rental-os:customer:close" : "rental-os:member:account-manage",
      input.status === "closed" ? "注销客户账号" : "变更客户账号状态"
    );
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    // 账号级动作**不**解析 workspaceId：它影响全部空间，绑定某个空间会造成误解。
    return this.requireCustomerOperations().changeAccountStatus(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }
  changeCustomerMembershipStatus(
    customerId: string,
    input: ChangeCustomerMembershipStatusRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    this.assertCustomerActionPermission(
      currentUser,
      input.status === "closed"
        ? "rental-os:customer:close"
        : input.status === "risk_restricted"
          ? "rental-os:member:risk-action"
          : "rental-os:member:manage",
      input.status === "closed"
        ? "注销租户会员关系"
        : input.status === "risk_restricted"
          ? "限制客户风险状态"
          : "变更租户会员状态"
    );
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().changeMembershipStatus(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }
  listCustomerStatusHistory(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listStatusHistory(
      tenantId,
      customerId,
      getRequestWorkspaceId(),
      getRequestLocationIds() === undefined
    );
  }
  listCustomerIdentityVerifications(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listIdentityVerifications(tenantId, customerId, currentUser);
  }
  saveCustomerIdentityVerification(customerId: string, input: SaveCustomerIdentityVerificationRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().saveIdentityVerification(tenantId, customerId, input, currentUser);
  }
  listCustomerRiskRecords(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listRiskRecords(
      tenantId,
      getRequestWorkspaceId(),
      customerId,
      currentUser
    );
  }
  createCustomerRiskRecord(customerId: string, input: CreateCustomerRiskRecordRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    this.assertCustomerActionPermission(currentUser, "rental-os:member:risk-action", "登记会员风险");
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().createRiskRecord(
      tenantId,
      getRequestWorkspaceId(),
      customerId,
      input,
      currentUser?.displayName,
      currentUser
    );
  }
  reviewCustomerRiskRecord(
    customerId: string,
    riskRecordId: string,
    input: ReviewCustomerRiskRecordRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    this.assertCustomerActionPermission(currentUser, "rental-os:member:risk-action", "复核会员风险");
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().reviewRiskRecord(
      tenantId,
      getRequestWorkspaceId(),
      customerId,
      riskRecordId,
      input,
      currentUser?.displayName,
      currentUser
    );
  }
  listCustomerSensitiveAccess(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().listSensitiveAccess(tenantId, customerId, currentUser);
  }
  private requireCustomerMerge() {
    if (!this.input.customerMerge) throw new ConflictException("客户合并服务未就绪");
    return this.input.customerMerge;
  }
  findCustomerDuplicates(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerMerge().findDuplicates(tenantId, customerId);
  }
  previewCustomerMerge(customerId: string, targetCustomerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    if (!targetCustomerId?.trim()) throw new BadRequestException("必须指定保留主档 targetCustomerId");
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerMerge().previewMerge(tenantId, customerId, targetCustomerId.trim());
  }
  mergeCustomers(input: MergeCustomersRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    // 合并是租户级动作，不绑定空间：被合并方的空间会员关系原样保留，不做跨空间搬迁。
    return this.requireCustomerMerge().mergeCustomers(tenantId, input, currentUser?.displayName);
  }
  getCustomerClosability(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    // 不传 workspaceId：本接口回答「整个租户客户账号能否注销」。
    // 空间会员注销的检查在改状态时按空间范围各自进行。
    return this.requireCustomerMerge().assertClosable(tenantId, customerId);
  }
  getCustomerMembershipClosability(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerMerge().assertClosable(tenantId, customerId);
  }
  getCustomerTransactability(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerOperations().assertTransactable(
      tenantId,
      requireRequestWorkspaceId(),
      customerId
    );
  }
  /**
   * CUSTOMER-01C：企业资料入口。
   *
   * 与客户主档一样按 `tenantId` 解析——企业资料属于租户级客户身份，不按空间隔离
   * （同一家企业在两个空间是同一家企业，开票与合同不该各存一份）。
   */
  private requireCustomerCorporate() {
    if (!this.input.customerCorporate) {
      throw new ConflictException("企业客户服务未就绪");
    }
    return this.input.customerCorporate;
  }
  private requireCustomerCorporateSettlement() {
    if (!this.input.customerCorporateSettlement) {
      throw new ConflictException("企业授信账务服务未就绪");
    }
    return this.input.customerCorporateSettlement;
  }
  listCustomerInvoiceProfiles(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().listInvoiceProfiles(tenantId, customerId);
  }
  saveCustomerInvoiceProfile(
    customerId: string,
    input: SaveCustomerInvoiceProfileRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().saveInvoiceProfile(tenantId, customerId, input);
  }
  listCustomerContracts(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().listContracts(tenantId, customerId);
  }
  saveCustomerContract(
    customerId: string,
    input: SaveCustomerContractRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().saveContract(tenantId, customerId, input);
  }
  getCustomerCredit(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().getCredit(tenantId, customerId);
  }
  saveCustomerCredit(
    customerId: string,
    input: SaveCustomerCreditRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporate().saveCredit(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }
  async registerSharedCustomer(input: SaveSharedCustomerRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    if (!this.input.memberships) throw new ConflictException("会员服务未就绪");
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    const customerId = input.customerType === "corporate"
      ? (await this.input.memberships.saveCorporateMember(tenantId, {
          name: input.name,
          phone: input.phone,
          email: input.email,
          corporateName: input.corporateName?.trim() || input.name,
          unifiedSocialCreditCode: input.unifiedSocialCreditCode,
          registeredAddress: input.registeredAddress,
          legalRepName: input.legalRepName,
          legalRepPhone: input.legalRepPhone,
          industry: input.industry,
          scale: input.scale,
          corporateTaxNo: input.corporateTaxNo
        })).customerId
      : (await this.input.memberships.registerPersonal(tenantId, {
          name: input.name,
          phone: input.phone,
          email: input.email,
          identityNo: input.identityNo,
          gender: input.gender,
          birthday: input.birthday,
          sourceChannel: input.sourceChannel,
          region: input.region,
          channel: "admin"
        }, currentUser?.displayName)).customerId;
    return this.requireSharedCustomers().findById(tenantId, customerId);
  }
  getCustomerCreditAccount(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporateSettlement().financialAccount(tenantId, customerId);
  }
  listCustomerCreditLedger(customerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporateSettlement().listLedger(tenantId, customerId);
  }
  recordCustomerCreditMaturity(customerId: string, input: RecordCustomerCorporateCreditMaturityRequest, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    if (!currentUser?.id || currentUser.isSaasAdmin || !(currentUser.isPlatformAdmin
      || currentUser.permissions.includes("rental-os:corporate:manage") || currentUser.permissions.includes("*"))) {
      throw new ForbiddenException("核定债权到期日需要当前企业管理权限");
    }
    if (getRequestDataScope() !== "all" || getRequestLocationIds() !== undefined) throw new ForbiddenException("核定债权须当前完整空间财务范围");
    return this.requireCustomerCorporateSettlement().recordMaturity(currentUser.tenantId, customerId, input,
      currentUser.id, requireRequestWorkspaceId());
  }
  readCustomerCreditMaturity(customerId: string, ledgerId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    if (getRequestDataScope() !== "all" || getRequestLocationIds() !== undefined) throw new ForbiddenException("读取债权到期依据须当前完整空间财务范围");
    return this.requireCustomerCorporateSettlement().readMaturity(tenantId, customerId, ledgerId, requireRequestWorkspaceId());
  }
  readCustomerCreditPaymentReversal(customerId: string, paymentId: string, currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    return this.requireCustomerCorporateSettlement().readPaymentReversal(currentUser?.tenantId ?? requireRequestTenantId(), customerId, paymentId);
  }
  reverseCustomerCreditPayment(customerId: string, paymentId: string, input: ReverseCustomerCorporateCreditPaymentRequest,
    currentUser?: SystemUserRow) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporateSettlement().reversePayment(tenantId, customerId, paymentId, input);
  }
  recordCustomerCreditPayment(
    customerId: string,
    input: RecordCustomerCorporateCreditPaymentRequest,
    currentUser?: SystemUserRow
  ) {
    this.requireWorkspaceDataSource();
    const tenantId = currentUser?.tenantId ?? requireRequestTenantId();
    return this.requireCustomerCorporateSettlement().recordPayment(
      tenantId,
      customerId,
      input,
      currentUser?.displayName
    );
  }
}
