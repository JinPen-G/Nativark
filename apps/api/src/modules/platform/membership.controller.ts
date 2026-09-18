import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { requireRequestTenantId, requireRequestWorkspaceId } from "../../common/request-identity";
import {
  AssignCustomerMembershipPlanDto,
  CustomerMembershipPlanAssignmentActionDto,
  CustomerMembershipPlanVersionActionDto,
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

/** 会员维护按租户共享；证件配置/提交与业务权益解析才需要当前空间上下文。 */
@Controller("membership")
export class MembershipController {
  constructor(private readonly memberships: MembershipService) {}

  private tenantScope() {
    return { tenantId: requireRequestTenantId() };
  }

  private workspaceScope() {
    return { ...this.tenantScope(), workspaceId: requireRequestWorkspaceId() };
  }

  @Get("registration-settings")
  registrationSettings() {
    const { tenantId } = this.tenantScope();
    return this.memberships.getRegistrationSettings(tenantId);
  }

  @Put("registration-settings")
  saveRegistrationSettings(@Body() body: UpdateCustomerMembershipRegistrationSettingsDto) {
    const { tenantId } = this.tenantScope();
    return this.memberships.saveRegistrationSettings(tenantId, body.registrationMode);
  }

  @Get("personal-options")
  personalOptions() {
    const { tenantId } = this.tenantScope();
    return this.memberships.listPersonalOptions(tenantId);
  }

  @Get("personal")
  personalMembers() {
    const { tenantId } = this.tenantScope();
    return this.memberships.listPersonalMembers(tenantId);
  }

  @Post("personal")
  registerPersonal(@Body() body: RegisterPersonalMembershipDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    const canDirectApprove = Boolean(req.user?.isPlatformAdmin || req.user?.permissions.includes("*") || req.user?.permissions.includes("rental-os:member:review"));
    const canManageAccount = Boolean(req.user?.isPlatformAdmin || req.user?.permissions.includes("*") || req.user?.permissions.includes("rental-os:member:account-manage"));
    return this.memberships.registerPersonal(tenantId, body, req.user?.displayName, canDirectApprove, canManageAccount);
  }

  @Put("personal/:customerId")
  savePersonal(@Param("customerId") customerId: string, @Body() body: SavePersonalMembershipDto) {
    const { tenantId } = this.tenantScope();
    return this.memberships.savePersonalMember(tenantId, customerId, body);
  }

  @Put("personal/:customerId/temporary-password")
  setTemporaryPassword(@Param("customerId") customerId: string, @Body() body: SetCustomerMembershipTemporaryPasswordDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.setTemporaryPassword(tenantId, customerId, body.temporaryPassword, req.user?.displayName);
  }

  @Post("personal/:customerId/qualifications")
  submitQualification(@Param("customerId") customerId: string, @Body() body: SubmitCustomerQualificationDto, @Req() req: RequestWithUser) {
    const { tenantId, workspaceId } = this.workspaceScope();
    return this.memberships.submitQualification(tenantId, workspaceId, customerId, body, "admin", req.user?.displayName);
  }

  @Get("personal/:customerId/qualification-history")
  qualificationHistory(@Param("customerId") customerId: string, @Query("qualificationType") qualificationType?: string) {
    const { tenantId } = this.tenantScope();
    return this.memberships.listQualificationRevisions(tenantId, customerId, qualificationType);
  }

  @Get("reviews")
  reviews(@Query("status") status?: string, @Query("type") type?: string) {
    const { tenantId } = this.tenantScope();
    return this.memberships.listReviews(tenantId, status, type);
  }

  @Post("reviews/:reviewId/decision")
  review(@Param("reviewId") reviewId: string, @Body() body: ReviewCustomerMembershipDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    const all = Boolean(req.user?.isPlatformAdmin || req.user?.permissions.includes("*"));
    return this.memberships.review(tenantId, reviewId, body, req.user?.displayName, {
      registration: all || Boolean(req.user?.permissions.includes("rental-os:member:review")),
      qualification: all || Boolean(req.user?.permissions.includes("rental-os:member:qualification-review"))
    });
  }

  @Get("qualification-options")
  qualificationOptions() {
    const { tenantId, workspaceId } = this.workspaceScope();
    return this.memberships.listQualificationTypes(tenantId, workspaceId);
  }

  @Get("qualification-types")
  qualificationTypes() {
    const { tenantId, workspaceId } = this.workspaceScope();
    return this.memberships.listQualificationTypes(tenantId, workspaceId);
  }

  @Put("qualification-types")
  saveQualificationType(@Body() body: SaveCustomerMembershipQualificationTypeDto) {
    const { tenantId, workspaceId } = this.workspaceScope();
    return this.memberships.saveQualificationType(tenantId, workspaceId, body);
  }

  @Get("corporate")
  corporateMembers() {
    const { tenantId } = this.tenantScope();
    return this.memberships.listCorporateMembers(tenantId);
  }

  @Put("corporate")
  saveCorporate(@Body() body: SaveCorporateMembershipDto) {
    const { tenantId } = this.tenantScope();
    return this.memberships.saveCorporateMember(tenantId, body);
  }

  @Get("corporate/:corporateCustomerId/employees")
  corporateEmployees(@Param("corporateCustomerId") corporateCustomerId: string) {
    const { tenantId } = this.tenantScope();
    return this.memberships.listCorporateEmployees(tenantId, corporateCustomerId);
  }

  @Put("corporate/:corporateCustomerId/employees")
  saveCorporateEmployee(@Param("corporateCustomerId") corporateCustomerId: string, @Body() body: SaveCustomerCorporateMembershipDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.saveCorporateEmployee(tenantId, corporateCustomerId, body, req.user?.displayName);
  }

  @Get("benefit-scope-options")
  benefitScopeOptions() {
    const { tenantId } = this.tenantScope();
    return this.memberships.benefitScopeOptions(tenantId);
  }

  @Get("plans")
  plans() {
    const { tenantId } = this.tenantScope();
    return this.memberships.listPlans(tenantId);
  }

  @Put("plans")
  savePlan(@Body() body: SaveCustomerMembershipPlanDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.savePlan(tenantId, body, req.user?.displayName);
  }

  @Post("plans/:planId/versions/:versionId/publish")
  publishPlan(@Param("planId") planId: string, @Param("versionId") versionId: string, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.publishPlan(tenantId, planId, versionId, req.user?.displayName);
  }

  @Post("plans/:planId/versions/:versionId/disable")
  disablePlan(@Param("planId") planId: string, @Param("versionId") versionId: string, @Body() body: CustomerMembershipPlanVersionActionDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.disablePlanVersion(tenantId, planId, versionId, body.reason, req.user?.displayName);
  }

  @Post("plans/:planId/versions/:versionId/restore")
  restorePlan(@Param("planId") planId: string, @Param("versionId") versionId: string, @Body() body: CustomerMembershipPlanVersionActionDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.restorePlanVersion(tenantId, planId, versionId, body.reason, req.user?.displayName);
  }

  @Post("plans/assignments")
  assignPlan(@Body() body: AssignCustomerMembershipPlanDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.assignPlan(tenantId, body, req.user?.displayName);
  }

  @Get("plans/assignments/:customerId")
  planAssignments(@Param("customerId") customerId: string) {
    const { tenantId } = this.tenantScope();
    return this.memberships.listPlanAssignments(tenantId, customerId);
  }

  @Post("plans/assignments/:assignmentId/revoke")
  revokePlanAssignment(@Param("assignmentId") assignmentId: string, @Body() body: CustomerMembershipPlanAssignmentActionDto, @Req() req: RequestWithUser) {
    const { tenantId } = this.tenantScope();
    return this.memberships.revokePlanAssignment(tenantId, assignmentId, body.reason, req.user?.displayName);
  }

  @Get("personal/:customerId/benefits")
  benefits(@Param("customerId") customerId: string, @Query("corporateCustomerId") corporateCustomerId?: string) {
    const { tenantId, workspaceId } = this.workspaceScope();
    return this.memberships.resolveBenefits(tenantId, workspaceId, customerId, corporateCustomerId);
  }

  @Get("personal/:customerId/booking-options")
  bookingOptions(@Param("customerId") customerId: string) {
    const { tenantId, workspaceId } = this.workspaceScope();
    return this.memberships.listBookingOptions(tenantId, workspaceId, customerId);
  }
}
