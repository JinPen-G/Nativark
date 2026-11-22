/** 原空间管理与开业品类选项的 12 条 HTTP 接口；只转交同一门面，权限仍由唯一原 Guard/服务裁定。 */
import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { RentalWorkspaceManagementApplication } from "./application-workspace-management";
import { CreateBusinessWorkspaceDto, SaveWorkspaceMemberDto, UpdateBusinessWorkspaceDto, SaveSystemUserAccessDto, RentalCategoryOpeningOptionsQueryDto } from "./http-workspace-management.dto";
interface RequestWithUser { user?: SystemUserRow; }
export type RentalWorkspacesHttpApplication = Pick<RentalWorkspaceManagementApplication, "listTenantBusinessWorkspaces" | "createTenantBusinessWorkspace" | "updateTenantBusinessWorkspace" | "listBusinessWorkspaces" | "createBusinessWorkspace" | "updateBusinessWorkspace" | "listWorkspaceMembers" | "listWorkspaceFulfillmentLocations" | "saveWorkspaceMember" | "saveUserWithWorkspaceAccess" | "getRentalCategoryOpeningOptions">;
export const RENTAL_WORKSPACES_HTTP_APPLICATION = Symbol("rental.workspaces.http-application");
@Controller("platform")
export class RentalWorkspacesController {
  constructor(@Inject(RENTAL_WORKSPACES_HTTP_APPLICATION) private readonly application: RentalWorkspacesHttpApplication) {}


  @Get("tenant-bootstrap/category-options")
  rentalCategoryOpeningOptions(@Query() query: RentalCategoryOpeningOptionsQueryDto, @Req() req: RequestWithUser) {
    return this.application.getRentalCategoryOpeningOptions(query, req.user);
  }

  @Get("tenants/:id/workspaces")
  tenantWorkspaces(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.application.listTenantBusinessWorkspaces(id, req.user);
  }


  @Post("tenants/:id/workspaces")
  createTenantWorkspace(
    @Param("id") id: string,
    @Body() body: CreateBusinessWorkspaceDto,
    @Req() req: RequestWithUser
  ) {
    return this.application.createTenantBusinessWorkspace(id, body, req.user);
  }


  @Put("tenants/:id/workspaces/:workspaceId")
  updateTenantWorkspace(
    @Param("id") id: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: UpdateBusinessWorkspaceDto,
    @Req() req: RequestWithUser
  ) {
    return this.application.updateTenantBusinessWorkspace(id, workspaceId, body, req.user);
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
    return this.application.listBusinessWorkspaces(req.user);
  }


  @Post("workspaces")
  createWorkspace(@Body() body: CreateBusinessWorkspaceDto, @Req() req: RequestWithUser) {
    return this.application.createBusinessWorkspace(body, req.user);
  }


  @Put("workspaces/:id")
  updateWorkspace(
    @Param("id") id: string,
    @Body() body: UpdateBusinessWorkspaceDto,
    @Req() req: RequestWithUser
  ) {
    return this.application.updateBusinessWorkspace(id, body, req.user);
  }


  @Get("workspaces/:id/members")
  workspaceMembers(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.application.listWorkspaceMembers(id, req.user);
  }


  @Get("workspaces/:id/fulfillment-locations")
  workspaceFulfillmentLocations(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.application.listWorkspaceFulfillmentLocations(id, req.user);
  }


  @Put("workspaces/:id/members")
  saveWorkspaceMember(
    @Param("id") id: string,
    @Body() body: SaveWorkspaceMemberDto,
    @Req() req: RequestWithUser
  ) {
    return this.application.saveWorkspaceMember(id, body, req.user);
  }


  @Post("users/access")
  createUserWithWorkspaceAccess(@Body() body: SaveSystemUserAccessDto, @Req() req: RequestWithUser) {
    return this.application.saveUserWithWorkspaceAccess(body, req.user);
  }


  @Put("users/:id/access")
  updateUserWithWorkspaceAccess(
    @Param("id") id: string,
    @Body() body: SaveSystemUserAccessDto,
    @Req() req: RequestWithUser
  ) {
    return this.application.saveUserWithWorkspaceAccess({ ...body, id }, req.user);
  }
}
