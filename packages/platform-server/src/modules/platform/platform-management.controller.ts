/** 无Core公共管理HTTP，路径权限由同源政策登记，主体和提交点在应用服务重新核验。 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { requireRequestTenantId } from "../../common/request-identity";
import { PlatformManagementService } from "./platform-management.service";
import { CreatePlatformTenantDto, PlatformTenantStatusDto, PlatformUserStatusDto, SavePlatformRoleDto,
  SavePlatformSelfProfileDto, SavePlatformUserDto, UpdatePlatformTenantDto, SaveOrganizationDto,
  OrganizationStatusInputDto, SaveSecurityBaselineInputDto, SecondConfirmationInputDto,
  PlatformRolePermissionsDto, PlatformUserPasswordResetDto } from "./platform-management.dto";

@Controller("platform")
export class PlatformManagementController {
  constructor(private readonly service: PlatformManagementService) {}

  @Get("organizations") organizations(@Query("tenantId") tenantId?: string) { return this.service.listOrganizations(tenantId); }
  @Post("organizations") createOrganization(@Body() body: SaveOrganizationDto) { return this.service.saveOrganization(body); }
  @Put("organizations/:id") saveOrganization(@Param("id") id: string, @Body() body: SaveOrganizationDto) {
    return this.service.saveOrganization({ ...body, id });
  }
  @Put("organizations/:id/status") setOrganizationStatus(@Param("id") id: string, @Body() body: OrganizationStatusInputDto) {
    return this.service.setOrganizationStatus(id, body.status, body.operator);
  }
  @Get("security-baseline") securityBaseline() { return this.service.readSecurityBaseline(); }
  @Put("security-baseline") saveSecurityBaseline(@Body() body: SaveSecurityBaselineInputDto) { return this.service.saveSecurityBaseline(body.config); }
  @Post("security-baseline/second-confirmation/check") checkSecondConfirmation(@Body() body: SecondConfirmationInputDto) {
    return this.service.checkSecondConfirmation(body.action, body.confirmationCode);
  }

  @Get("tenants") tenants() { return this.service.listTenants(); }
  @Get("tenants/:id") getTenant(@Param("id") id: string) { return this.service.getTenant(id); }
  @Post("tenants") createTenant(@Body() body: CreatePlatformTenantDto) { return this.service.createTenant(body); }
  @Put("tenants/:id") updateTenant(@Param("id") id: string, @Body() body: UpdatePlatformTenantDto) {
    return this.service.updateTenant(id, body, true);
  }
  @Put("tenants/:id/status") tenantStatus(@Param("id") id: string, @Body() body: PlatformTenantStatusDto) {
    return this.service.tenantStatus(id, body);
  }
  @Post("tenants/:id/admin/reset-password") resetTenantAdminPassword(@Param("id") id: string) {
    return this.service.resetTenantAdminPassword(id);
  }
  @Get("tenant") tenant() { return this.service.readTenant(); }
  @Put("tenant") updateOwnTenant(@Body() body: UpdatePlatformTenantDto) {
    return this.service.updateTenant(requireRequestTenantId(), body, false);
  }
  @Get("self-profile") selfProfile() { return this.service.readSelfProfile(); }
  @Put("self-profile") saveSelfProfile(@Body() body: SavePlatformSelfProfileDto) { return this.service.saveSelfProfile(body); }
  @Get("users") users(@Query("tenantId") tenantId?: string) { return this.service.listUsers(tenantId); }
  @Post("users") createUser(@Body() body: SavePlatformUserDto) { return this.service.saveUser(body); }
  @Put("users/:id") saveUser(@Param("id") id: string, @Body() body: SavePlatformUserDto) { return this.service.saveUser({ ...body, id }); }
  @Put("users/:id/status") userStatus(@Param("id") id: string, @Body() body: PlatformUserStatusDto) {
    return this.service.userStatus(id, body.isActive, body.tenantId);
  }
  @Post("users/:id/reset-password") resetPassword(@Param("id") id: string, @Body() body: PlatformUserPasswordResetDto) {
    return this.service.resetUserPassword(id, body?.tenantId);
  }
  @Get("roles") roles(@Query("tenantId") tenantId?: string) { return this.service.listRoles(tenantId); }
  @Post("roles") createRole(@Body() body: SavePlatformRoleDto) { return this.service.saveRole(body); }
  @Put("roles/:id") saveRole(@Param("id") id: string, @Body() body: SavePlatformRoleDto) { return this.service.saveRole({ ...body, id }); }
  @Put("roles/:id/permissions") saveRolePermissions(@Param("id") id: string, @Body() body: PlatformRolePermissionsDto) {
    return this.service.saveRolePermissions(id, body?.permissions ?? [], body?.tenantId);
  }
  @Delete("roles/:id") deleteRole(@Param("id") id: string, @Query("tenantId") tenantId?: string) {
    return this.service.deleteRole(id, tenantId);
  }
  @Get("permission-tree") permissionTree() { return this.service.permissionTree(); }
}
