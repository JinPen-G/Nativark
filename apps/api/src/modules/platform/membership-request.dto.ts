import {
  CUSTOMER_GENDERS,
  CUSTOMER_MEMBERSHIP_PLAN_TARGET_TYPES,
  CUSTOMER_MEMBERSHIP_REGISTRATION_MODES,
  CUSTOMER_MEMBERSHIP_REVIEW_STATUSES,
  CUSTOMER_SOURCE_CHANNELS,
  type CustomerMembershipBenefit,
  type AssignCustomerMembershipPlanRequest,
  type CustomerMembershipPlanVersionActionRequest,
  type CustomerMembershipPlanAssignmentActionRequest,
  type RegisterPersonalMembershipRequest,
  type SaveCorporateMembershipRequest,
  type SavePersonalMembershipRequest,
  type ReviewCustomerMembershipRequest,
  type SaveCustomerCorporateMembershipRequest,
  type SaveCustomerMembershipPlanRequest,
  type SaveCustomerMembershipQualificationTypeRequest,
  type SetCustomerMembershipTemporaryPasswordRequest,
  type SubmitCustomerQualificationRequest,
  type UpdateCustomerMembershipRegistrationSettingsRequest
} from "@rental-os/shared";
import { Type } from "class-transformer";
import {
  IsArray,
  IsNumber,
  ValidateNested,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from "class-validator";

export class UpdateCustomerMembershipRegistrationSettingsDto implements UpdateCustomerMembershipRegistrationSettingsRequest {
  @IsIn(CUSTOMER_MEMBERSHIP_REGISTRATION_MODES as unknown as string[])
  registrationMode!: UpdateCustomerMembershipRegistrationSettingsRequest["registrationMode"];
}

export class RegisterPersonalMembershipDto implements RegisterPersonalMembershipRequest {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;
  @IsString() @IsNotEmpty() @MaxLength(40)
  phone!: string;
  @IsOptional() @IsString() @MaxLength(160)
  email?: string;
  @IsOptional() @IsString() @MaxLength(80)
  identityNo?: string;
  @IsOptional() @IsIn(CUSTOMER_GENDERS)
  gender?: RegisterPersonalMembershipRequest["gender"];
  @IsOptional() @IsDateString()
  birthday?: string;
  @IsOptional() @IsIn(CUSTOMER_SOURCE_CHANNELS)
  sourceChannel?: RegisterPersonalMembershipRequest["sourceChannel"];
  @IsOptional() @IsString() @MaxLength(64)
  region?: string;
  @IsIn(["admin", "app"])
  channel!: "admin" | "app";
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128)
  temporaryPassword?: string;
  @IsOptional() @IsBoolean()
  directApprove?: boolean;
  @IsOptional() @IsString() @MaxLength(100)
  idempotencyKey?: string;
}

export class SavePersonalMembershipDto implements SavePersonalMembershipRequest {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40)
  phone?: string;
  @IsOptional() @IsString() @MaxLength(160)
  email?: string;
  @IsOptional() @IsString() @MaxLength(80)
  identityNo?: string;
  @IsOptional() @IsIn(CUSTOMER_GENDERS)
  gender?: SavePersonalMembershipRequest["gender"];
  @IsOptional() @IsDateString()
  birthday?: string;
  @IsOptional() @IsIn(CUSTOMER_SOURCE_CHANNELS)
  sourceChannel?: SavePersonalMembershipRequest["sourceChannel"];
  @IsOptional() @IsString() @MaxLength(64)
  region?: string;
}

export class SaveCorporateMembershipDto implements SaveCorporateMembershipRequest {
  @IsOptional() @IsString()
  id?: string;
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40)
  phone?: string;
  @IsOptional() @IsString() @MaxLength(160)
  email?: string;
  @IsString() @IsNotEmpty() @MaxLength(180)
  corporateName!: string;
  @IsOptional() @IsString() @MaxLength(80)
  unifiedSocialCreditCode?: string;
  @IsOptional() @IsString() @MaxLength(500)
  registeredAddress?: string;
  @IsOptional() @IsString() @MaxLength(120)
  legalRepName?: string;
  @IsOptional() @IsString() @MaxLength(40)
  legalRepPhone?: string;
  @IsOptional() @IsString() @MaxLength(120)
  industry?: string;
  @IsOptional() @IsIn(["1-10", "11-50", "51-200", "200+"])
  scale?: SaveCorporateMembershipRequest["scale"];
  @IsOptional() @IsBoolean()
  clearEmail?: boolean;
  @IsOptional() @IsString() @MaxLength(80)
  /** Legacy alias. New data is written only to the structured corporate profile. */
  corporateTaxNo?: string;
}

export class ReviewCustomerMembershipDto implements ReviewCustomerMembershipRequest {
  @IsIn(CUSTOMER_MEMBERSHIP_REVIEW_STATUSES.filter((value) => value !== "pending") as unknown as string[])
  status!: ReviewCustomerMembershipRequest["status"];
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class SaveCustomerMembershipQualificationTypeDto implements SaveCustomerMembershipQualificationTypeRequest {
  @IsOptional() @IsString()
  id?: string;
  @IsString() @IsNotEmpty() @MaxLength(80)
  code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;
  @IsOptional() @IsString() @MaxLength(80)
  capabilityCode?: string;
  @IsOptional() @IsBoolean()
  requiredForBooking?: boolean;
  @IsOptional() @IsIn(["enabled", "disabled"])
  status?: "enabled" | "disabled";
}

export class SubmitCustomerQualificationDto implements SubmitCustomerQualificationRequest {
  @IsString() @IsNotEmpty() @MaxLength(80)
  qualificationType!: string;
  @IsOptional() @IsString() @MaxLength(120)
  referenceNo?: string;
  @IsOptional() @IsDateString()
  issuedAt?: string;
  @IsOptional() @IsDateString()
  expiresAt?: string;
  @IsOptional() @IsString() @MaxLength(512)
  evidenceRef?: string;
}

export class SetCustomerMembershipTemporaryPasswordDto implements SetCustomerMembershipTemporaryPasswordRequest {
  @IsString() @MinLength(8) @MaxLength(128)
  temporaryPassword!: string;
}

export class SaveCustomerCorporateMembershipDto implements SaveCustomerCorporateMembershipRequest {
  @IsString() @IsNotEmpty()
  personalCustomerId!: string;
  @IsIn(["admin", "employee"])
  role!: "admin" | "employee";
  @IsOptional() @IsString() @MaxLength(120)
  department?: string;
  @IsOptional() @IsString() @MaxLength(80)
  employeeNo?: string;
  @IsOptional() @IsIn(["active", "suspended", "exited"])
  status?: "active" | "suspended" | "exited";
  @IsOptional() @IsDateString()
  effectiveFrom?: string;
  @IsOptional() @IsDateString()
  effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class CustomerMembershipBenefitDto implements CustomerMembershipBenefit {
  @IsIn(["rental_discount", "deposit_reduction", "preauth_reduction", "service_benefit", "priority_reservation", "quote_validity_extension"])
  type!: CustomerMembershipBenefit["type"];
  @IsIn(["percentage", "amount", "quota", "priority"])
  calculation!: CustomerMembershipBenefit["calculation"];
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0)
  value!: number;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0)
  maximum?: number;
  @IsOptional() @IsArray() @IsString({ each: true })
  applicableServiceIds?: string[];
  @IsOptional() @IsBoolean()
  stackable?: boolean;
  @IsOptional() @IsObject()
  conditions?: Record<string, unknown>;
  // 完整判别联合及空间归属由服务层验证，不能让 DTO 白名单静默丢弃非法 shape。
  @IsOptional() @IsObject()
  scope?: CustomerMembershipBenefit["scope"];
}

export class SaveCustomerMembershipPlanDto implements SaveCustomerMembershipPlanRequest {
  @IsOptional() @IsString()
  id?: string;
  @IsString() @IsNotEmpty() @MaxLength(80)
  code!: string;
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;
  @IsIn(CUSTOMER_MEMBERSHIP_PLAN_TARGET_TYPES as unknown as string[])
  targetType!: SaveCustomerMembershipPlanRequest["targetType"];
  @IsInt() @Min(1) @Max(999)
  levelRank!: number;
  @IsOptional() @IsBoolean()
  isDefault?: boolean;
  @IsOptional() @IsBoolean()
  isRecommended?: boolean;
  @IsOptional() @IsBoolean()
  appVisible?: boolean;
  @IsOptional() @IsDateString()
  effectiveFrom?: string;
  @IsOptional() @IsDateString()
  effectiveTo?: string;
  @IsOptional() @IsObject()
  eligibility?: Record<string, unknown>;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CustomerMembershipBenefitDto)
  benefits!: CustomerMembershipBenefitDto[];
}

export class AssignCustomerMembershipPlanDto implements AssignCustomerMembershipPlanRequest {
  @IsString() @IsNotEmpty()
  customerId!: string;
  @IsString() @IsNotEmpty()
  planVersionId!: string;
  @IsOptional() @IsIn(["manual", "system", "corporate_contract"])
  source?: "manual" | "system" | "corporate_contract";
  @IsOptional() @IsDateString()
  effectiveFrom?: string;
  @IsOptional() @IsDateString()
  effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class CustomerMembershipPlanVersionActionDto implements CustomerMembershipPlanVersionActionRequest {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}

export class CustomerMembershipPlanAssignmentActionDto implements CustomerMembershipPlanAssignmentActionRequest {
  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}
