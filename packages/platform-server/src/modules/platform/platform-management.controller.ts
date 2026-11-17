/** 无Core公共管理HTTP，路径权限由同源政策登记，主体和提交点在应用服务重新核验。 */
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { requireRequestTenantId } from "../../common/request-identity";
import { PlatformManagementService } from "./platform-management.service";
import { CreatePlatformTenantDto, PlatformTenantStatusDto, PlatformUserStatusDto, SavePlatformRoleDto,
  SavePlatformSelfProfileDto, SavePlatformUserDto, UpdatePlatformTenantDto, SaveOrganizationDto,
  OrganizationStatusInputDto, SaveSecurityBaselineInputDto, SecondConfirmationInputDto } from "./platform-management.dto";

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
  @Post("tenants") createTenant(@Body() body: CreatePlatformTenantDto) { return this.service.createTenant(body); }
  @Put("tenants/:id") updateTenant(@Param("id") id: string, @Body() body: UpdatePlatformTenantDto) {
    return this.service.updateTenant(id, body, true);
  }
  @Put("tenants/:id/status") tenantStatus(@Param("id") id: string, @Body() body: PlatformTenantStatusDto) {
    return this.service.tenantStatus(id, body);
  }
  @Get("tenant") tenant() { return this.service.readTenant(); }
  @Put("tenant") updateOwnTenant(@Body() body: UpdatePlatformTenantDto) {
    return this.service.updateTenant(requireRequestTenantId(), body, false);
  }
  @Get("self-profile") selfProfile() { return this.service.readSelfProfile(); }
  @Put("self-profile") saveSelfProfile(@Body() body: SavePlatformSelfProfileDto) { return this.service.saveSelfProfile(body); }
  @Get("users") users() { return this.service.listUsers(); }
  @Post("users") createUser(@Body() body: SavePlatformUserDto) { return this.service.saveUser(body); }
  @Put("users/:id") saveUser(@Param("id") id: string, @Body() body: SavePlatformUserDto) { return this.service.saveUser({ ...body, id }); }
  @Put("users/:id/status") userStatus(@Param("id") id: string, @Body() body: PlatformUserStatusDto) { return this.service.userStatus(id, body.isActive); }
  @Post("users/:id/reset-password") resetPassword(@Param("id") id: string) { return this.service.resetUserPassword(id); }
  @Get("roles") roles() { return this.service.listRoles(); }
  @Post("roles") createRole(@Body() body: SavePlatformRoleDto) { return this.service.saveRole(body); }
  @Put("roles/:id") saveRole(@Param("id") id: string, @Body() body: SavePlatformRoleDto) { return this.service.saveRole({ ...body, id }); }
  @Delete("roles/:id") deleteRole(@Param("id") id: string) { return this.service.deleteRole(id); }
  @Get("permission-tree") permissionTree() { return this.service.permissionTree(); }
}
