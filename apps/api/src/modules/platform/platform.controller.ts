import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  PlatformAuditLogQuery,
  PlatformFilterPresetQuery,
  SystemUserRow,
} from "@store-rental/shared";
import { PlatformService } from "./platform.service";
import { CreateBusinessWorkspaceDto, LinkCustomerToWorkspaceDto, SaveSharedCustomerDto, SaveWorkspaceMemberDto, UpdateBusinessWorkspaceDto } from "./workspace-request.dto";
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
  constructor(private readonly platformService: PlatformService) {}

  @Get("tenants")
  tenants(@Req() req: RequestWithUser) {
    return this.platformService.listTenants(req.user);
  }

  @Get("tenants/:id")
  tenant(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.platformService.getTenant(id, req.user);
  }

  @Put("tenants/:id")
  updateTenant(@Param("id") id: string, @Body() body: UpdateTenantDto, @Req() req: RequestWithUser) {
    return this.platformService.updateTenant(id, body, req.user);
  }

  @Put("tenants/:id/status")
  updateTenantStatus(@Param("id") id: string, @Body() body: UpdateTenantStatusDto, @Req() req: RequestWithUser) {
    return this.platformService.updateTenantStatus(id, body, req.user);
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

  @Get("workspace-customers")
  workspaceCustomers(@Req() req: RequestWithUser) {
    return this.platformService.listWorkspaceCustomers(req.user);
  }

  @Post("customers")
  registerCustomer(@Body() body: SaveSharedCustomerDto, @Req() req: RequestWithUser) {
    return this.platformService.registerSharedCustomer(body, req.user);
  }

  @Post("workspace-customers")
  linkCustomer(@Body() body: LinkCustomerToWorkspaceDto, @Req() req: RequestWithUser) {
    return this.platformService.linkCustomerToWorkspace(body, req.user);
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
    @Body() body: SaveSecurityBaselineInputDto
  ) {
    return this.platformService.saveSecurityBaseline(
      body.config,
      body.operator ?? "平台管理员"
    );
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
    return this.platformService.saveRole(body, req.user);
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
