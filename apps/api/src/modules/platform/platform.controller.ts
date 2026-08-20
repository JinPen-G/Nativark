import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  GeneratePlatformNumberRequest,
  PlatformAuditLogQuery,
  PlatformFilterPresetQuery,
  SaveOrganizationRequest,
  SavePlatformFilterPresetRequest,
  SaveSystemRoleRequest,
  SaveSystemRuleSectionRequest,
  SaveSystemUserRequest,
  SavePlatformDictionaryGroupRequest,
  SavePlatformNumberRuleRequest,
  SystemSecurityBaselineConfig,
  SystemUserRow,
  TenantBootstrapRequest,
  UpdateTenantRequest,
  UpdateTenantStatusRequest,
  CreateBusinessWorkspaceRequest,
  UpdateBusinessWorkspaceRequest,
  SaveWorkspaceMemberRequest
} from "@store-rental/shared";
import { PlatformService } from "./platform.service";

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
  updateTenant(@Param("id") id: string, @Body() body: UpdateTenantRequest, @Req() req: RequestWithUser) {
    return this.platformService.updateTenant(id, body, req.user);
  }

  @Put("tenants/:id/status")
  updateTenantStatus(@Param("id") id: string, @Body() body: UpdateTenantStatusRequest, @Req() req: RequestWithUser) {
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

  @Post("workspaces")
  createWorkspace(@Body() body: CreateBusinessWorkspaceRequest, @Req() req: RequestWithUser) {
    return this.platformService.createBusinessWorkspace(body, req.user);
  }

  @Put("workspaces/:id")
  updateWorkspace(
    @Param("id") id: string,
    @Body() body: UpdateBusinessWorkspaceRequest,
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
    @Body() body: SaveWorkspaceMemberRequest,
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveWorkspaceMember(id, body, req.user);
  }

  @Post("organizations")
  createOrganization(@Body() body: SaveOrganizationRequest, @Req() req: RequestWithUser) {
    return this.platformService.saveOrganization(body, req.user);
  }

  @Put("organizations/:id/status")
  setOrganizationStatus(
    @Param("id") id: string,
    @Body() body: { status: "enabled" | "disabled"; operator?: string; tenantId?: string },
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
    @Body() body: Omit<SaveOrganizationRequest, "id">,
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
    @Body() body: Omit<SaveSystemRuleSectionRequest, "sectionKey">
  ) {
    return this.platformService.saveSystemRuleSection({ ...body, sectionKey });
  }

  @Post("system-rules/ai-test")
  testAiConnection(@Body() body: { operator?: string }) {
    return this.platformService.testAiConnection(body.operator);
  }

  @Get("security-baseline")
  securityBaseline() {
    return this.platformService.getSecurityBaseline();
  }

  @Put("security-baseline")
  saveSecurityBaseline(
    @Body() body: { config: SystemSecurityBaselineConfig; operator?: string }
  ) {
    return this.platformService.saveSecurityBaseline(
      body.config,
      body.operator ?? "平台管理员"
    );
  }

  @Post("security-baseline/second-confirmation/check")
  checkSecondConfirmation(
    @Body() body: { action: string; confirmationCode?: string }
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
    @Body() body: SavePlatformFilterPresetRequest,
    @Req() req?: RequestWithUser
  ) {
    return this.platformService.saveFilterPreset(body, req?.user);
  }

  @Put("filter-presets/:id/default")
  setDefaultFilterPreset(
    @Param("id") id: string,
    @Body() body: { operator?: string },
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
    @Body() body: Omit<SavePlatformDictionaryGroupRequest, "code">
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
    @Body() body: Omit<SavePlatformNumberRuleRequest, "code">
  ) {
    return this.platformService.saveNumberRule({ ...body, code });
  }

  @Post("number-rules/generate")
  generateNumber(@Body() body: GeneratePlatformNumberRequest) {
    return this.platformService.generateNumber(body);
  }

  @Get("tenant-bootstrap/preview")
  tenantBootstrapPreview() {
    return this.platformService.getTenantBootstrapPreview();
  }

  @Post("tenant-bootstrap")
  bootstrapTenant(@Body() body: TenantBootstrapRequest, @Req() req: RequestWithUser) {
    return this.platformService.bootstrapTenant(body, req.user);
  }

  @Get("roles")
  roles(@Query("tenantId") tenantId: string | undefined, @Req() req: RequestWithUser) {
    return this.platformService.listRoles(tenantId, req.user);
  }

  @Post("roles")
  createRole(@Body() body: SaveSystemRoleRequest, @Req() req: RequestWithUser) {
    return this.platformService.saveRole(body, req.user);
  }

  @Put("roles/:id")
  updateRole(@Param("id") id: string, @Body() body: SaveSystemRoleRequest, @Req() req: RequestWithUser) {
    return this.platformService.saveRole({ ...body, id }, req.user);
  }

  @Delete("roles/:id")
  deleteRole(@Param("id") id: string, @Query("tenantId") tenantId: string | undefined, @Req() req: RequestWithUser) {
    return this.platformService.deleteRole(id, tenantId, req.user);
  }

  @Put("roles/:id/permissions")
  saveRolePermissions(
    @Param("id") id: string,
    @Body() body: { permissions?: string[]; tenantId?: string },
    @Req() req: RequestWithUser
  ) {
    return this.platformService.saveRolePermissions(id, body.permissions ?? [], body.tenantId, req.user);
  }

  @Get("users")
  users(@Query("tenantId") tenantId?: string, @Req() req?: RequestWithUser) {
    return this.platformService.listUsers(tenantId, req?.user);
  }

  @Post("users")
  createUser(@Body() body: SaveSystemUserRequest, @Req() req: RequestWithUser) {
    return this.platformService.saveUser(body, req.user);
  }

  @Put("users/:id")
  updateUser(@Param("id") id: string, @Body() body: SaveSystemUserRequest, @Req() req: RequestWithUser) {
    return this.platformService.saveUser({ ...body, id }, req.user);
  }

  @Put("users/:id/status")
  setUserStatus(
    @Param("id") id: string,
    @Body() body: { isActive?: boolean; tenantId?: string },
    @Req() req: RequestWithUser
  ) {
    return this.platformService.setUserStatus(id, Boolean(body.isActive), body.tenantId, req.user);
  }

  @Post("users/:id/reset-password")
  resetUserPassword(@Param("id") id: string, @Body() body: { tenantId?: string }, @Req() req: RequestWithUser) {
    return this.platformService.resetUserPassword(id, body.tenantId, req.user);
  }
}
