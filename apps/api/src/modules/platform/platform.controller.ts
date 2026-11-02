import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  PlatformAuditLogQuery,
  PlatformFilterPresetQuery,
  SystemUserRow,
} from "@rental-os/shared";
import { PlatformService } from "./platform.service";
import { CustomerOperationsService } from "./customer-operations.service";
import {
  ChangeCustomerAccountStatusDto,
  ChangeCustomerMembershipStatusDto,
  CreateCustomerRiskRecordDto,
  ReviewCustomerRiskRecordDto,
  SaveCustomerProfileAddressDto,
  SaveCustomerIdentityVerificationDto
} from "./customer-operations-request.dto";
import {
  RecordCustomerCorporateCreditPaymentDto,
  ReverseCustomerCorporateCreditPaymentDto,
  RecordCustomerCorporateCreditMaturityDto,
  SaveCustomerContractDto,
  SaveCustomerCreditDto,
  SaveCustomerInvoiceProfileDto
} from "./customer-corporate-request.dto";
import { MergeCustomersDto } from "./customer-merge-request.dto";
import { CreateBusinessWorkspaceDto, SaveSharedCustomerDto, SaveWorkspaceMemberDto, UpdateBusinessWorkspaceDto } from "./workspace-request.dto";
import {
  GeneratePlatformNumberDto,
  OperatorInputDto,
  OrganizationStatusInputDto,
  ResetUserPasswordInputDto,
  SaveOrganizationDto,
  SavePlatformDictionaryBodyInputDto,
  SavePlatformFilterPresetDto,
  SavePlatformNumberRuleBodyInputDto,
  SaveRolePermissionsInputDto,
  SaveSecurityBaselineInputDto,
  SaveSystemRoleDto,
  SaveSystemUserAccessDto,
  SaveSystemRuleSectionBodyInputDto,
  SaveSystemUserDto,
  SecondConfirmationInputDto,
  SetUserStatusInputDto,
  TenantBootstrapDto,
  UpdateTenantDto,
  UpdateTenantStatusDto
} from "./platform-request.dto";

interface RequestWithUser {
  user?: SystemUserRow;
}

@Controller("platform")
export class PlatformController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly customerOperations: CustomerOperationsService
  ) {}

  @Get("tenants")
  tenants(@Req() req: RequestWithUser) {
    return this.platformService.listTenants(req.user);
  }

  @Get("tenants/:id")
  tenant(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.platformService.getTenant(id, req.user);
  }

  @Get("tenants/:id/workspaces")
  tenantWorkspaces(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.platformService.listTenantBusinessWorkspaces(id, req.user);
  }

  @Post("tenants/:id/workspaces")
  createTenantWorkspace(
    @Param("id") id: string,
    @Body() body: CreateBusinessWorkspaceDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.createTenantBusinessWorkspace(id, body, req.user);
  }

  @Put("tenants/:id/workspaces/:workspaceId")
  updateTenantWorkspace(
    @Param("id") id: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: UpdateBusinessWorkspaceDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.updateTenantBusinessWorkspace(id, workspaceId, body, req.user);
  }

  @Put("tenants/:id")
  updateTenant(@Param("id") id: string, @Body() body: UpdateTenantDto, @Req() req: RequestWithUser) {
    return this.platformService.updateTenant(id, body, req.user);
  }

  @Put("tenants/:id/status")
  updateTenantStatus(@Param("id") id: string, @Body() body: UpdateTenantStatusDto, @Req() req: RequestWithUser) {
    return this.platformService.updateTenantStatus(id, body, req.user);
  }

  @Post("tenants/:id/admin/reset-password")
  resetTenantAdminPassword(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.platformService.resetTenantAdminPassword(id, req.user);
  }

  @Get("organizations")
  organizations(@Query("tenantId") tenantId?: string, @Req() req?: RequestWithUser) {
    return this.platformService.listOrganizations(tenantId, req?.user);
  }

  /**
   * SPACE-01 的最小管理面。
   *
   * 刻意不提供「切换当前空间」接口——会话空间上下文属 SPACE-02。
   * 这里只让租户管理员维护空间主档与成员关系，空间范围一律取自服务端会话的
   * tenantId，不接受客户端提交的 tenantId 覆盖。
   */
  @Get("workspaces")
  workspaces(@Req() req: RequestWithUser) {
    return this.platformService.listBusinessWorkspaces(req.user);
  }

  /**
   * SPACE-04 的最小管理面：租户共享客户主档 + 空间接入。
   *
   * 两个列表接口的隔离口径**刻意不同**，不是疏漏：
   * - `customers` 按租户列全部主档，跨空间可见——这正是「同一客户无需重复注册」
   *   所要求的：运营在露营空间必须能查到他已在摄影空间注册过。
   * - `workspace-customers` 只列当前空间的业务关系，空间取自会话。
   *
   * 不提供跨空间的订单/权益汇总（需求明确排除本阶段建设）。
   */
  @Get("customers")
  sharedCustomers(@Req() req: RequestWithUser) {
    return this.platformService.listSharedCustomers(req.user);
  }

  @Post("customers")
  registerCustomer(@Body() body: SaveSharedCustomerDto, @Req() req: RequestWithUser) {
    return this.platformService.registerSharedCustomer(body, req.user);
  }

  /**
   * CUSTOMER-01B：客户详情。
   *
   * 敏感字段按权限脱敏，且每次读取都写访问审计（需求 4.8.5 / 4.8.14）。
   * 审计在服务层写，不在这里——绕过控制器的内部调用同样要留痕。
   */
  @Get("customers/:customerId")
  customerDetail(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.getCustomerDetail(customerId, req.user);
  }

  /** CUSTOMER-PROFILE-01：资料页聚合读取。订单只返回轻量摘要，完整订单仍走订单中心权限。 */
  @Get("customers/:customerId/profile")
  customerProfileOverview(
    @Param("customerId") customerId: string,
    @Query("page") page: string | undefined,
    @Query("pageSize") pageSize: string | undefined,
    @Req() req: RequestWithUser
  ) {
    const parse = (value: string | undefined) => {
      if (value === undefined || value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    return this.platformService.getCustomerProfileOverview(customerId, { page: parse(page), pageSize: parse(pageSize) }, req.user);
  }

  @Get("customers/:customerId/identity-verifications")
  customerIdentityVerifications(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.listCustomerIdentityVerifications(customerId, req.user);
  }

  @Post("customers/:customerId/identity-verifications")
  saveCustomerIdentityVerification(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerIdentityVerificationDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveCustomerIdentityVerification(customerId, body, req.user);
  }

  /** 客户资料页维护配送地址；电话缺省表示保留原值，服务端始终只返回脱敏电话。 */
  @Put("customers/:customerId/addresses")
  saveCustomerProfileAddress(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerProfileAddressDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveCustomerProfileAddress(customerId, body, req.user);
  }

  @Delete("customers/:customerId/addresses/:addressId")
  removeCustomerProfileAddress(
    @Param("customerId") customerId: string,
    @Param("addressId") addressId: string,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.removeCustomerProfileAddress(customerId, addressId, req.user);
  }

  /** CUSTOMER-01B：为客户开通登录账号。幂等，已有账号直接返回。 */
  @Post("customers/:customerId/account")
  ensureCustomerAccount(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.ensureCustomerAccount(customerId, req.user);
  }

  /**
   * CUSTOMER-01B：改**账号**状态。影响该客户在全部经营空间的登录。
   * 与下面的空间会员状态是两个入口，刻意不合并——合并就无法表达
   * 「只停这个空间」与「停掉全部空间的登录」的区别。
   */
  @Put("customers/:customerId/account-status")
  changeCustomerAccountStatus(
    @Param("customerId") customerId: string,
    @Body() body: ChangeCustomerAccountStatusDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.changeCustomerAccountStatus(customerId, body, req.user);
  }

  @Put("customers/:customerId/membership-status")
  changeCustomerMembershipStatus(
    @Param("customerId") customerId: string,
    @Body() body: ChangeCustomerMembershipStatusDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.changeCustomerMembershipStatus(customerId, body, req.user);
  }

  @Get("customers/:customerId/risk-records")
  customerRiskRecords(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.listCustomerRiskRecords(customerId, req.user);
  }

  @Post("customers/:customerId/risk-records")
  createCustomerRiskRecord(
    @Param("customerId") customerId: string,
    @Body() body: CreateCustomerRiskRecordDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.createCustomerRiskRecord(customerId, body, req.user);
  }

  @Post("customers/:customerId/risk-records/:riskRecordId/decision")
  reviewCustomerRiskRecord(
    @Param("customerId") customerId: string,
    @Param("riskRecordId") riskRecordId: string,
    @Body() body: ReviewCustomerRiskRecordDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.reviewCustomerRiskRecord(customerId, riskRecordId, body, req.user);
  }

  /** CUSTOMER-01B：客户状态时间线（账号级 + 当前空间级同一条线）。 */
  @Get("customers/:customerId/status-history")
  customerStatusHistory(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.listCustomerStatusHistory(customerId, req.user);
  }

  /** CUSTOMER-01B：敏感资料访问审计。本身就是访问画像，需解密权限才能查。 */
  @Get("customers/:customerId/sensitive-access")
  customerSensitiveAccess(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.listCustomerSensitiveAccess(customerId, req.user);
  }


  /**
   * CUSTOMER-01D：重复客户候选（需求 4.8.3）。只在同租户内查找。
   * 候选带 matchedBy——运营要知道「为什么系统认为这两个是同一人」，否则人工合并变成盲签。
   */
  @Get("customers/:customerId/duplicates")
  customerDuplicates(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.findCustomerDuplicates(customerId, req.user);
  }

  /** CUSTOMER-01D：合并冲突预览。只读，不写任何东西；供人工确认后再提交。 */
  @Get("customers/:customerId/merge-preview")
  customerMergePreview(
    @Param("customerId") customerId: string,
    @Query("targetCustomerId") targetCustomerId: string,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.previewCustomerMerge(customerId, targetCustomerId, req.user);
  }

  /** CUSTOMER-01D：提交人工合并。不搬订单、不合并空间权益，只写映射并标记被合并方。 */
  @Post("customers/merge")
  mergeCustomers(@Body() body: MergeCustomersDto, @Req() req: RequestWithUser) {
    return this.platformService.mergeCustomers(body, req.user);
  }

  /**
   * CUSTOMER-01D：注销前置检查（需求 4.8.13）。
   * blockers 来自真实事实，非空即禁止注销；manualConfirmations 是本系统尚无数据源的类别，
   * 必须人工确认——把它们当成「检查通过」就是借注销规避欠款。
   */
  @Get("customers/:customerId/closability")
  customerClosability(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.getCustomerClosability(customerId, req.user);
  }

  @Get("customers/:customerId/membership-closability")
  customerMembershipClosability(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.getCustomerMembershipClosability(customerId, req.user);
  }

  /** CUSTOMER-01B：该客户此刻能否在本空间开展新业务，以及被拒的具体原因。 */
  @Get("customers/:customerId/transactability")
  customerTransactability(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.getCustomerTransactability(customerId, req.user);
  }

  /**
   * CUSTOMER-01C：企业开票资料、合同、授信账期。
   *
   * 三者各自成表而不是平铺进企业资料：一家企业可以同时持有多份开票资料与多份有效合同，
   * 而订单引用的是「下单当时生效的那一份」。
   */
  @Get("customers/:customerId/invoice-profiles")
  customerInvoiceProfiles(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.listCustomerInvoiceProfiles(customerId, req.user);
  }

  @Put("customers/:customerId/invoice-profiles")
  saveCustomerInvoiceProfile(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerInvoiceProfileDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveCustomerInvoiceProfile(customerId, body, req.user);
  }

  @Get("customers/:customerId/contracts")
  customerContracts(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.listCustomerContracts(customerId, req.user);
  }

  @Put("customers/:customerId/contracts")
  saveCustomerContract(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerContractDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveCustomerContract(customerId, body, req.user);
  }

  @Get("customers/:customerId/credit")
  customerCredit(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.getCustomerCredit(customerId, req.user);
  }

  @Put("customers/:customerId/credit")
  saveCustomerCredit(
    @Param("customerId") customerId: string,
    @Body() body: SaveCustomerCreditDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveCustomerCredit(customerId, body, req.user);
  }

  @Get("customers/:customerId/credit/account")
  customerCreditAccount(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.getCustomerCreditAccount(customerId, req.user);
  }

  @Get("customers/:customerId/credit/ledger")
  customerCreditLedger(@Param("customerId") customerId: string, @Req() req: RequestWithUser) {
    return this.platformService.listCustomerCreditLedger(customerId, req.user);
  }

  @Post("customers/:customerId/credit/maturities")
  recordCustomerCreditMaturity(@Param("customerId") customerId: string, @Body() body: RecordCustomerCorporateCreditMaturityDto,
    @Req() req: RequestWithUser) {
    return this.platformService.recordCustomerCreditMaturity(customerId, body, req.user);
  }

  @Get("customers/:customerId/credit/maturities/:ledgerId")
  customerCreditMaturity(@Param("customerId") customerId: string, @Param("ledgerId") ledgerId: string, @Req() req: RequestWithUser) {
    return this.platformService.readCustomerCreditMaturity(customerId, ledgerId, req.user);
  }

  @Get("customers/:customerId/credit/payments/:paymentId/reverse")
  customerCreditPaymentReversal(@Param("customerId") customerId: string, @Param("paymentId") paymentId: string,
    @Req() req: RequestWithUser) {
    return this.platformService.readCustomerCreditPaymentReversal(customerId, paymentId, req.user);
  }

  @Post("customers/:customerId/credit/payments/:paymentId/reverse")
  reverseCustomerCreditPayment(@Param("customerId") customerId: string, @Param("paymentId") paymentId: string,
    @Body() body: ReverseCustomerCorporateCreditPaymentDto, @Req() req: RequestWithUser) {
    return this.platformService.reverseCustomerCreditPayment(customerId, paymentId, body, req.user);
  }

  @Post("customers/:customerId/credit/payments")
  recordCustomerCreditPayment(
    @Param("customerId") customerId: string,
    @Body() body: RecordCustomerCorporateCreditPaymentDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.recordCustomerCreditPayment(customerId, body, req.user);
  }

  @Post("workspaces")
  createWorkspace(@Body() body: CreateBusinessWorkspaceDto, @Req() req: RequestWithUser) {
    return this.platformService.createBusinessWorkspace(body, req.user);
  }

  @Put("workspaces/:id")
  updateWorkspace(
    @Param("id") id: string,
    @Body() body: UpdateBusinessWorkspaceDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.updateBusinessWorkspace(id, body, req.user);
  }

  @Get("workspaces/:id/members")
  workspaceMembers(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.platformService.listWorkspaceMembers(id, req.user);
  }

  @Get("workspaces/:id/fulfillment-locations")
  workspaceFulfillmentLocations(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.platformService.listWorkspaceFulfillmentLocations(id, req.user);
  }

  @Put("workspaces/:id/members")
  saveWorkspaceMember(
    @Param("id") id: string,
    @Body() body: SaveWorkspaceMemberDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveWorkspaceMember(id, body, req.user);
  }

  @Post("organizations")
  createOrganization(@Body() body: SaveOrganizationDto, @Req() req: RequestWithUser) {
    return this.platformService.saveOrganization(body, req.user);
  }

  @Put("organizations/:id/status")
  setOrganizationStatus(
    @Param("id") id: string,
    @Body() body: OrganizationStatusInputDto,
    @Req() req?: RequestWithUser
  ) {
    return this.platformService.setOrganizationStatus(
      id,
      body.status,
      body.operator ?? "租户管理员",
      req?.user
    );
  }

  @Put("organizations/:id")
  saveOrganization(
    @Param("id") id: string,
    @Body() body: SaveOrganizationDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveOrganization({ ...body, id }, req.user);
  }

  @Get("permission-tree")
  permissionTree() {
    return this.platformService.listPermissionTree();
  }

  @Get("system-rules")
  systemRules() {
    return this.platformService.getSystemRules();
  }

  @Put("system-rules/:sectionKey")
  saveSystemRuleSection(
    @Param("sectionKey") sectionKey: string,
    @Body() body: SaveSystemRuleSectionBodyInputDto
  ) {
    return this.platformService.saveSystemRuleSection({ ...body, sectionKey });
  }

  @Post("system-rules/ai-test")
  testAiConnection(@Body() body: OperatorInputDto) {
    return this.platformService.testAiConnection(body.operator);
  }

  @Get("security-baseline")
  securityBaseline() {
    return this.platformService.getSecurityBaseline();
  }

  @Put("security-baseline")
  saveSecurityBaseline(
    @Body() body: SaveSecurityBaselineInputDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveSecurityBaseline(body.config, req.user);
  }

  @Post("security-baseline/second-confirmation/check")
  checkSecondConfirmation(
    @Body() body: SecondConfirmationInputDto
  ) {
    return this.platformService.checkSecondConfirmation(
      body.action,
      body.confirmationCode
    );
  }

  @Get("data-permission-preview")
  dataPermissionPreview(@Req() req?: RequestWithUser) {
    return this.platformService.getDataPermissionPreview(req?.user);
  }

  @Get("audit-logs")
  auditLogs(@Query() query: PlatformAuditLogQuery, @Req() req: RequestWithUser) {
    return this.platformService.listAuditLogs(query, req.user);
  }

  @Get("filter-presets")
  filterPresets(@Query() query: PlatformFilterPresetQuery, @Req() req?: RequestWithUser) {
    return this.platformService.listFilterPresets(query, req?.user);
  }

  @Post("filter-presets")
  saveFilterPreset(
    @Body() body: SavePlatformFilterPresetDto,
    @Req() req?: RequestWithUser
  ) {
    return this.platformService.saveFilterPreset(body, req?.user);
  }

  @Put("filter-presets/:id/default")
  setDefaultFilterPreset(
    @Param("id") id: string,
    @Body() body: OperatorInputDto,
    @Req() req?: RequestWithUser
  ) {
    return this.platformService.setDefaultFilterPreset(id, body.operator, req?.user);
  }

  @Delete("filter-presets/:id")
  deleteFilterPreset(
    @Param("id") id: string,
    @Query("operator") operator?: string,
    @Req() req?: RequestWithUser
  ) {
    return this.platformService.deleteFilterPreset(id, operator, req?.user);
  }

  @Get("dictionaries")
  dictionaries() {
    return this.platformService.listDictionaries();
  }

  @Put("dictionaries/:code")
  saveDictionary(
    @Param("code") code: string,
    @Body() body: SavePlatformDictionaryBodyInputDto
  ) {
    return this.platformService.saveDictionaryGroup({ ...body, code });
  }

  @Get("number-rules")
  numberRules() {
    return this.platformService.listNumberRules();
  }

  @Put("number-rules/:code")
  saveNumberRule(
    @Param("code") code: string,
    @Body() body: SavePlatformNumberRuleBodyInputDto
  ) {
    return this.platformService.saveNumberRule({ ...body, code });
  }

  @Post("number-rules/generate")
  generateNumber(@Body() body: GeneratePlatformNumberDto) {
    return this.platformService.generateNumber(body);
  }

  @Get("tenant-bootstrap/preview")
  tenantBootstrapPreview() {
    return this.platformService.getTenantBootstrapPreview();
  }

  @Post("tenant-bootstrap")
  bootstrapTenant(@Body() body: TenantBootstrapDto, @Req() req: RequestWithUser) {
    return this.platformService.bootstrapTenant(body, req.user);
  }

  @Get("roles")
  roles(@Query("tenantId") tenantId: string | undefined, @Req() req: RequestWithUser) {
    return this.platformService.listRoles(tenantId, req.user);
  }

  @Post("roles")
  createRole(@Body() body: SaveSystemRoleDto, @Req() req: RequestWithUser) {
    return this.platformService.saveRole({ ...body, id: undefined }, req.user);
  }

  @Put("roles/:id")
  updateRole(@Param("id") id: string, @Body() body: SaveSystemRoleDto, @Req() req: RequestWithUser) {
    return this.platformService.saveRole({ ...body, id }, req.user);
  }

  @Delete("roles/:id")
  deleteRole(@Param("id") id: string, @Query("tenantId") tenantId: string | undefined, @Req() req: RequestWithUser) {
    return this.platformService.deleteRole(id, tenantId, req.user);
  }

  @Put("roles/:id/permissions")
  saveRolePermissions(
    @Param("id") id: string,
    @Body() body: SaveRolePermissionsInputDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveRolePermissions(id, body.permissions ?? [], body.tenantId, req.user);
  }

  @Get("users")
  users(@Query("tenantId") tenantId?: string, @Req() req?: RequestWithUser) {
    return this.platformService.listUsers(tenantId, req?.user);
  }

  @Post("users")
  createUser(@Body() body: SaveSystemUserDto, @Req() req: RequestWithUser) {
    return this.platformService.saveUser(body, req.user);
  }

  @Put("users/:id")
  updateUser(@Param("id") id: string, @Body() body: SaveSystemUserDto, @Req() req: RequestWithUser) {
    return this.platformService.saveUser({ ...body, id }, req.user);
  }

  @Post("users/access")
  createUserWithWorkspaceAccess(@Body() body: SaveSystemUserAccessDto, @Req() req: RequestWithUser) {
    return this.platformService.saveUserWithWorkspaceAccess(body, req.user);
  }

  @Put("users/:id/access")
  updateUserWithWorkspaceAccess(
    @Param("id") id: string,
    @Body() body: SaveSystemUserAccessDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveUserWithWorkspaceAccess({ ...body, id }, req.user);
  }

  @Put("users/:id/status")
  setUserStatus(
    @Param("id") id: string,
    @Body() body: SetUserStatusInputDto,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.setUserStatus(id, body.isActive, body.tenantId, req.user);
  }

  @Post("users/:id/reset-password")
  resetUserPassword(@Param("id") id: string, @Body() body: ResetUserPasswordInputDto, @Req() req: RequestWithUser) {
    return this.platformService.resetUserPassword(id, body.tenantId, req.user);
  }
}
