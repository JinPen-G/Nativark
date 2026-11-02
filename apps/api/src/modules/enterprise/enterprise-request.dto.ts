import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsDefined, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import type { EnterpriseApplicationInput, EnterpriseChangeRequest, SaveEnterpriseApplicationRequest, ReviewEnterpriseApplicationRequest, EnterpriseInvitePolicy, SaveEnterpriseInvitePolicyRequest, CreateEnterpriseInviteRequest, JoinEnterpriseRequest, ReviewEnterpriseJoinRequest, ChangeEnterpriseMemberRequest, TransferEnterpriseAdministratorRequest, DecideEnterpriseTransferRequest, EnterpriseScopePolicy, SaveEnterpriseScopePolicyRequest, EnterpriseDisclosure, RequestEnterpriseBookingApproval, DecideEnterpriseBookingApproval, SubmitEnterpriseApprovedBooking, EnterpriseAuthorityUploadRequest } from "@rental-os/shared";
import { RentalCategoryCode, ENTERPRISE_PORTAL_ACTIONS, type CloseEnterpriseApprovalExecution, type EnterpriseManagementProposal, type SaveEnterpriseManagementRequest, type ReviewEnterpriseManagementRequest, type PreviewEnterpriseInviteRequest, type ChangeEnterpriseAdministratorRequest } from "@rental-os/shared";
export class EnterpriseManagementProposalDto implements EnterpriseManagementProposal {
  @IsOptional() @IsString() @MaxLength(191) legalName?: string;
  @IsOptional() @IsString() @MaxLength(1000) registeredAddress?: string;
  @IsOptional() @IsEmail() @MaxLength(191) email?: string;
  @IsOptional() @IsString() @MaxLength(32) requestedCreditLimit?: string;
  @IsOptional() @IsIn(["CNY"]) currency?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsString({ each: true }) @MaxLength(191, { each: true }) workspaceIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsIn(Object.values(RentalCategoryCode), { each: true }) categoryCodes?: string[];
}
export class SaveEnterpriseManagementRequestDto implements SaveEnterpriseManagementRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(191) requestId?: string;
  @IsIn(["profile_change", "credit_change", "scope_change"]) requestType!: import("@rental-os/shared").EnterpriseManagementRequestType;
  @IsString() @IsNotEmpty() @MaxLength(191) objectRevision!: string;
  @IsDefined() @ValidateNested() @Type(() => EnterpriseManagementProposalDto) proposal!: EnterpriseManagementProposalDto;
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) @MaxLength(191, { each: true }) evidenceFileIds!: string[];
  @IsBoolean() submit!: boolean;
}
export class ReviewEnterpriseManagementRequestDto implements ReviewEnterpriseManagementRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn(["approve", "reject", "supplement"]) decision!: import("@rental-os/shared").ReviewEnterpriseManagementRequest["decision"];
}
export class PreviewEnterpriseInviteRequestDto implements PreviewEnterpriseInviteRequest {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/u) inviteCode!: string;
}
export class ChangeEnterpriseAdministratorRequestDto implements ChangeEnterpriseAdministratorRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn(["admin", "employee"]) role!: ChangeEnterpriseAdministratorRequest["role"];
  @IsArray() @ArrayUnique() @ArrayMaxSize(ENTERPRISE_PORTAL_ACTIONS.length) @IsIn(ENTERPRISE_PORTAL_ACTIONS, { each: true }) actions!: ChangeEnterpriseAdministratorRequest["actions"];
  @IsISO8601() expectedUpdatedAt!: string;
}
export class EnterpriseAuthorityUploadRequestDto implements EnterpriseAuthorityUploadRequest {
  @IsString() @IsNotEmpty() @MaxLength(180) fileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(127) mimeType!: string;
  @IsInt() @Min(1) @Max(20 * 1024 * 1024) sizeBytes!: number;
  @IsString() @IsNotEmpty() @MaxLength(191) idempotencyKey!: string;
}
export class RequestEnterpriseBookingApprovalDto implements RequestEnterpriseBookingApproval {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) quoteId!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) purpose!: string;
}
export class DecideEnterpriseBookingApprovalDto implements DecideEnterpriseBookingApproval {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn(["approve", "reject", "withdraw"]) decision!: DecideEnterpriseBookingApproval["decision"];
}
export class SubmitEnterpriseApprovedBookingDto implements SubmitEnterpriseApprovedBooking {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) approvalId!: string;
  @IsIn([true]) confirm!: true;
}
export class CloseEnterpriseApprovalExecutionDto implements CloseEnterpriseApprovalExecution {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn([true]) confirm!: true;
}
export class EnterpriseDisclosureDto implements EnterpriseDisclosure {
  @IsString() @IsNotEmpty() @MaxLength(191) noticeVersion!: string;
  @IsBoolean() acknowledged!: boolean;
}
export class EnterpriseApplicationInputDto implements EnterpriseApplicationInput {
  @IsString() @IsNotEmpty() @MaxLength(191) legalName!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) region!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) legalIdentifier!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) contactName!: string;
  @IsString() @IsNotEmpty() @MaxLength(32) contactPhone!: string;
  @IsOptional() @IsEmail() @MaxLength(191) email?: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) authorityStatement!: string;
  @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({ each: true }) evidenceFileIds!: string[];
  @IsString() @IsNotEmpty() @MaxLength(191) agreementVersion!: string;
  @IsOptional() @IsBoolean() agreementAcknowledged?: boolean;
  @IsOptional() @IsString() @MaxLength(191) existingCorporateCustomerId?: string;
}
export class EnterpriseChangeRequestDto implements EnterpriseChangeRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
export class SaveEnterpriseApplicationRequestDto implements SaveEnterpriseApplicationRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(191) requestId?: string;
  @IsBoolean() submit!: boolean;
  @IsDefined() @ValidateNested() @Type(() => EnterpriseApplicationInputDto) application!: EnterpriseApplicationInputDto;
}
export class ReviewEnterpriseApplicationRequestDto implements ReviewEnterpriseApplicationRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn(["approve","reject","supplement"]) decision!: ReviewEnterpriseApplicationRequest["decision"];
  @IsBoolean() verifiedRepresentative!: boolean;
}
export class EnterpriseInvitePolicyInputDto implements EnterpriseInvitePolicy {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4000) noticeText?: string;
  @IsInt() @Min(1) @Max(8760) maxLifetimeHours!: number;
  @IsInt() @Min(1) @Max(1000) maxUses!: number;
  @IsInt() @Min(1) @Max(100) guessesPerWindow!: number;
  @IsInt() @Min(60) @Max(86400) windowSeconds!: number;
  @IsString() @IsNotEmpty() @MaxLength(191) agreementVersion!: string;
}
export class SaveEnterpriseInvitePolicyRequestDto implements SaveEnterpriseInvitePolicyRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsDefined() @ValidateNested() @Type(() => EnterpriseInvitePolicyInputDto) policy!: EnterpriseInvitePolicyInputDto;
}
export class CreateEnterpriseInviteRequestDto implements CreateEnterpriseInviteRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsInt() @Min(1) @Max(8760) lifetimeHours!: number;
  @IsInt() @Min(1) @Max(1000) maxUses!: number;
}
export class JoinEnterpriseRequestDto implements JoinEnterpriseRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/u) inviteCode!: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsString() @MaxLength(80) employeeNo?: string;
  @IsString() @IsNotEmpty() @MaxLength(191) agreementVersion!: string;
  @IsString() @IsNotEmpty() @Matches(/^[a-f0-9]{64}$/u) noticeHash!: string;
  @IsBoolean() acknowledged!: boolean;
}
export class ReviewEnterpriseJoinRequestDto implements ReviewEnterpriseJoinRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn(["approve","reject"]) decision!: ReviewEnterpriseJoinRequest["decision"];
}
export class ChangeEnterpriseMemberRequestDto implements ChangeEnterpriseMemberRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsString() @MaxLength(80) employeeNo?: string;
  @IsIn(["active","suspended","exited"]) status!: ChangeEnterpriseMemberRequest["status"];
  @IsOptional() @IsISO8601() effectiveTo?: string;
  @IsISO8601() expectedUpdatedAt!: string;
}
export class TransferEnterpriseAdministratorRequestDto implements TransferEnterpriseAdministratorRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) targetMembershipId!: string;
}
export class EnterpriseScopePolicyInputDto implements EnterpriseScopePolicy {
  @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsString({ each: true }) @MaxLength(191, { each: true }) workspaceIds!: string[];
  @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsIn(Object.values(RentalCategoryCode), { each: true }) categoryCodes!: RentalCategoryCode[];
  @IsBoolean() personalPaymentAllowed!: boolean;
  @IsBoolean() enterprisePaymentAllowed!: boolean;
  @IsIn(["per_order", "without_per_order", "unconfigured"]) approvalMode!: EnterpriseScopePolicy["approvalMode"];
  @IsString() @IsNotEmpty() @MaxLength(191) noticeVersion!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) noticeText!: string;
  @IsOptional() @IsString() @MaxLength(15) maxRequestAmount?: string;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10080) approvalLifetimeMinutes?: number;
}
export class SaveEnterpriseScopePolicyRequestDto implements SaveEnterpriseScopePolicyRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsDefined() @ValidateNested() @Type(() => EnterpriseScopePolicyInputDto) policy!: EnterpriseScopePolicyInputDto;
}
export class DecideEnterpriseTransferRequestDto implements DecideEnterpriseTransferRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsBoolean() accept!: boolean;
}
