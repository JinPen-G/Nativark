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
  TenantBootstrapRequest
} from "@store-rental/shared";
import { PlatformService } from "./platform.service";

interface RequestWithUser {
  user?: SystemUserRow;
}

@Controller("platform")
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get("tenants")
  tenants() {
    return this.platformService.listTenants();
  }

  @Get("organizations")
  organizations(@Query("tenantId") tenantId?: string, @Req() req?: RequestWithUser) {
    return this.platformService.listOrganizations(tenantId, req?.user);
  }

  @Post("organizations")
  createOrganization(@Body() body: SaveOrganizationRequest) {
    return this.platformService.saveOrganization(body);
  }

  @Put("organizations/:id/status")
  setOrganizationStatus(
    @Param("id") id: string,
    @Body() body: { status: "enabled" | "disabled"; operator?: string }
  ) {
    return this.platformService.setOrganizationStatus(
      id,
      body.status,
      body.operator ?? "平台管理员"
    );
  }

  @Put("organizations/:id")
  saveOrganization(
    @Param("id") id: string,
    @Body() body: Omit<SaveOrganizationRequest, "id">
  ) {
    return this.platformService.saveOrganization({ ...body, id });
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
  auditLogs(@Query() query: PlatformAuditLogQuery) {
    return this.platformService.listAuditLogs(query);
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
  bootstrapTenant(@Body() body: TenantBootstrapRequest) {
    return this.platformService.bootstrapTenant(body);
  }

  @Get("roles")
  roles() {
    return this.platformService.listRoles();
  }

  @Post("roles")
  createRole(@Body() body: SaveSystemRoleRequest) {
    return this.platformService.saveRole(body);
  }

  @Put("roles/:id")
  updateRole(@Param("id") id: string, @Body() body: SaveSystemRoleRequest) {
    return this.platformService.saveRole({ ...body, id });
  }

  @Delete("roles/:id")
  deleteRole(@Param("id") id: string) {
    return this.platformService.deleteRole(id);
  }

  @Put("roles/:id/permissions")
  saveRolePermissions(
    @Param("id") id: string,
    @Body() body: { permissions?: string[] }
  ) {
    return this.platformService.saveRolePermissions(id, body.permissions ?? []);
  }

  @Get("users")
  users(@Query("tenantId") tenantId?: string, @Req() req?: RequestWithUser) {
    return this.platformService.listUsers(tenantId, req?.user);
  }

  @Post("users")
  createUser(@Body() body: SaveSystemUserRequest) {
    return this.platformService.saveUser(body);
  }

  @Put("users/:id")
  updateUser(@Param("id") id: string, @Body() body: SaveSystemUserRequest) {
    return this.platformService.saveUser({ ...body, id });
  }

  @Put("users/:id/status")
  setUserStatus(
    @Param("id") id: string,
    @Body() body: { isActive?: boolean }
  ) {
    return this.platformService.setUserStatus(id, Boolean(body.isActive));
  }

  @Post("users/:id/reset-password")
  resetUserPassword(@Param("id") id: string) {
    return this.platformService.resetUserPassword(id);
  }
}
