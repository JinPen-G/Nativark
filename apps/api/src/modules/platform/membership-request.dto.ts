import {
  CUSTOMER_MEMBERSHIP_PLAN_TARGET_TYPES,
  CUSTOMER_MEMBERSHIP_REGISTRATION_MODES,
  CUSTOMER_MEMBERSHIP_REVIEW_STATUSES,
  CUSTOMER_QUALIFICATION_STATUSES,
  type AssignCustomerMembershipPlanRequest,
  type CustomerMembershipPlanVersionActionRequest,
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
} from "@store-rental/shared";
import {
  IsArray,
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
  @IsArray()
  benefits!: SaveCustomerMembershipPlanRequest["benefits"];
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
