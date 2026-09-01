import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@store-rental/shared";
import { requireRequestTenantId, requireRequestWorkspaceId } from "../../common/request-identity";
import {
  AssignCustomerMembershipPlanDto,
  RegisterPersonalMembershipDto,
  ReviewCustomerMembershipDto,
  SaveCustomerCorporateMembershipDto,
  SaveCorporateMembershipDto,
  SaveCustomerMembershipPlanDto,
  SaveCustomerMembershipQualificationTypeDto,
  SetCustomerMembershipTemporaryPasswordDto,
  SavePersonalMembershipDto,
  SubmitCustomerQualificationDto,
  UpdateCustomerMembershipRegistrationSettingsDto
} from "./membership-request.dto";
import { MembershipService } from "./membership.service";

interface RequestWithUser { user?: SystemUserRow; }

/**
 * 新会员体系的独立 API 面。目标空间只从会话读取，任何请求体都没有 workspaceId，
 * 因此管理端与后续 APP 都不能把操作越权写到别的经营空间。
 */
@Controller("membership")
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}

  private scope() {
    return { tenantId: requireRequestTenantId(), workspaceId: requireRequestWorkspaceId() };
  }

  @Get("registration-settings")
  registrationSettings() {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.getRegistrationSettings(tenantId, workspaceId);
  }

  @Put("registration-settings")
  saveRegistrationSettings(@Body() body: UpdateCustomerMembershipRegistrationSettingsDto) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.saveRegistrationSettings(tenantId, workspaceId, body.registrationMode);
  }

  @Get("personal")
  personalMembers() {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.listPersonalMembers(tenantId, workspaceId);
  }

  @Post("personal")
  registerPersonal(@Body() body: RegisterPersonalMembershipDto, @Req() req: RequestWithUser) {
    const { tenantId, workspaceId } = this.scope();
    const canDirectApprove = Boolean(req.user?.isPlatformAdmin || req.user?.permissions.includes("*") || req.user?.permissions.includes("store-rental:member:review"));
    const canManageAccount = Boolean(req.user?.isPlatformAdmin || req.user?.permissions.includes("*") || req.user?.permissions.includes("store-rental:member:account-manage"));
    return this.memberships.registerPersonal(tenantId, workspaceId, body, req.user?.displayName, canDirectApprove, canManageAccount);
  }

  @Put("personal/:customerId")
  savePersonal(@Param("customerId") customerId: string, @Body() body: SavePersonalMembershipDto) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.savePersonalMember(tenantId, workspaceId, customerId, body);
  }

  @Put("personal/:customerId/temporary-password")
  setTemporaryPassword(
    @Param("customerId") customerId: string,
    @Body() body: SetCustomerMembershipTemporaryPasswordDto,
    @Req() req: RequestWithUser
  ) {
    const { tenantId } = this.scope();
    return this.memberships.setTemporaryPassword(tenantId, customerId, body.temporaryPassword, req.user?.displayName);
  }

  @Post("personal/:customerId/qualifications")
  submitQualification(
    @Param("customerId") customerId: string,
    @Body() body: SubmitCustomerQualificationDto,
    @Req() req: RequestWithUser
  ) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.submitQualification(tenantId, workspaceId, customerId, body, "admin", req.user?.displayName);
  }

  @Get("reviews")
  reviews(@Query("status") status?: string, @Query("type") type?: string) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.listReviews(tenantId, workspaceId, status, type);
  }

  @Post("reviews/:reviewId/decision")
  review(@Param("reviewId") reviewId: string, @Body() body: ReviewCustomerMembershipDto, @Req() req: RequestWithUser) {
    const { tenantId, workspaceId } = this.scope();
    const all = Boolean(req.user?.isPlatformAdmin || req.user?.permissions.includes("*"));
    return this.memberships.review(tenantId, workspaceId, reviewId, body, req.user?.displayName, {
      registration: all || Boolean(req.user?.permissions.includes("store-rental:member:review")),
      qualification: all || Boolean(req.user?.permissions.includes("store-rental:member:qualification-review"))
    });
  }

  @Get("qualification-types")
  qualificationTypes() {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.listQualificationTypes(tenantId, workspaceId);
  }

  @Put("qualification-types")
  saveQualificationType(@Body() body: SaveCustomerMembershipQualificationTypeDto) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.saveQualificationType(tenantId, workspaceId, body);
  }

  @Get("corporate")
  corporateMembers() {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.listCorporateMembers(tenantId, workspaceId);
  }

  @Put("corporate")
  saveCorporate(@Body() body: SaveCorporateMembershipDto) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.saveCorporateMember(tenantId, workspaceId, body);
  }

  @Get("corporate/:corporateCustomerId/employees")
  corporateEmployees(@Param("corporateCustomerId") corporateCustomerId: string) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.listCorporateEmployees(tenantId, workspaceId, corporateCustomerId);
  }

  @Put("corporate/:corporateCustomerId/employees")
  saveCorporateEmployee(
    @Param("corporateCustomerId") corporateCustomerId: string,
    @Body() body: SaveCustomerCorporateMembershipDto,
    @Req() req: RequestWithUser
  ) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.saveCorporateEmployee(tenantId, workspaceId, corporateCustomerId, body, req.user?.displayName);
  }

  @Get("plans")
  plans() {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.listPlans(tenantId, workspaceId);
  }

  @Put("plans")
  savePlan(@Body() body: SaveCustomerMembershipPlanDto, @Req() req: RequestWithUser) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.savePlan(tenantId, workspaceId, body, req.user?.displayName);
  }

  @Post("plans/:planId/versions/:versionId/publish")
  publishPlan(@Param("planId") planId: string, @Param("versionId") versionId: string, @Req() req: RequestWithUser) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.publishPlan(tenantId, workspaceId, planId, versionId, req.user?.displayName);
  }

  @Post("plans/assignments")
  assignPlan(@Body() body: AssignCustomerMembershipPlanDto, @Req() req: RequestWithUser) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.assignPlan(tenantId, workspaceId, body, req.user?.displayName);
  }

  /** 后续报价/订单接口调用同一判定，企业权益必须显式指定企业且员工关系有效。 */
  @Get("personal/:customerId/benefits")
  benefits(@Param("customerId") customerId: string, @Query("corporateCustomerId") corporateCustomerId?: string) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.resolveBenefits(tenantId, workspaceId, customerId, corporateCustomerId);
  }

  @Get("personal/:customerId/booking-options")
  bookingOptions(@Param("customerId") customerId: string) {
    const { tenantId, workspaceId } = this.scope();
    return this.memberships.listBookingOptions(tenantId, workspaceId, customerId);
  }
}
