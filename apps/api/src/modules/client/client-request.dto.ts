import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";
import { Type } from "class-transformer";
import {
  CLIENT_VERIFICATION_METHODS,
  RENTAL_PRICING_UNIT_CODES,
  type ClientAgreementConsent,
  type ClientAvailabilityRequest,
  type ClientCancelOrderRequest,
  type ClientChangePasswordRequest,
  type ClientContactRequest,
  type ClientCreateOrderRequest,
  type ClientCreateQuoteRequest,
  type ClientMembershipLoginRequest,
  type ClientProfileUpdateRequest,
  type ClientOrderExtensionRequest,
  type ClientPaymentSimulationRequest,
  type ClientPaymentIntentRequest,
  type ClientPersonalMembershipRegistrationRequest,
  type ClientRefreshRequest,
  type ClientRegistrationChallengeRequest,
  type ClientSwitchWorkspaceRequest,
  type ClientWorkspaceTarget,
  type VerifyClientRegistrationChallengeRequest,
  type SubmitCustomerQualificationRequest,
  type ClientQualificationUploadSessionRequest,
  type ClientQualificationUploadCompleteRequest
} from "@rental-os/shared";

const FULFILLMENT_MODES = ["store_pickup_return", "partner_pickup_return", "warehouse_pickup_return", "locker_pickup_return", "delivery", "onsite_delivery"] as const;

export class ClientWorkspaceTargetDto implements ClientWorkspaceTarget {
  @IsString() @IsNotEmpty() @MaxLength(64)
  tenantCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(64)
  workspaceCode!: string;
}

export class ClientRegistrationChallengeRequestDto implements ClientRegistrationChallengeRequest {
  @IsString() @IsNotEmpty() @MaxLength(64)
  tenantCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(64)
  workspaceCode!: string;

  @IsIn(CLIENT_VERIFICATION_METHODS)
  method!: ClientRegistrationChallengeRequest["method"];

  @IsString() @IsNotEmpty() @MaxLength(191)
  identifier!: string;

  @IsString() @IsNotEmpty() @MaxLength(191)
  idempotencyKey!: string;
}

export class VerifyClientRegistrationChallengeRequestDto implements VerifyClientRegistrationChallengeRequest {
  /** challengeId 已经在 URL 路径中传入，控制器以路径参数为准。 */
  @IsOptional() @IsString() @MaxLength(191)
  challengeId!: string;

  @IsString() @IsNotEmpty() @MaxLength(6) @MinLength(6)
  code!: string;
}

export class ClientAgreementConsentInputDto {
  @IsString() @IsNotEmpty() @MaxLength(64)
  userAgreementVersion!: string;

  @IsString() @IsNotEmpty() @MaxLength(64)
  privacyPolicyVersion!: string;

  @IsISO8601()
  agreedAt!: string;
}

export class ClientPersonalMembershipRegistrationRequestDto implements ClientPersonalMembershipRegistrationRequest {
  @IsString() @IsNotEmpty() @MaxLength(64)
  tenantCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(64)
  workspaceCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;

  @IsString() @IsNotEmpty() @MaxLength(32)
  phone!: string;

  @IsOptional() @IsEmail() @MaxLength(191)
  email?: string;

  @IsOptional() @IsString() @MaxLength(128)
  identityNo?: string;

  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  password!: string;

  @IsString() @IsNotEmpty() @MaxLength(191)
  verificationToken!: string;

  @ValidateNested() @Type(() => ClientAgreementConsentInputDto)
  consent!: ClientAgreementConsent;

  @IsString() @IsNotEmpty() @MaxLength(191)
  idempotencyKey!: string;
}

export class ClientMembershipLoginRequestDto implements ClientMembershipLoginRequest {
  @IsString() @IsNotEmpty() @MaxLength(64)
  tenantCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(64)
  loginIdentifier!: string;

  @IsString() @IsNotEmpty() @MaxLength(128)
  password!: string;

  @IsOptional() @IsString() @MaxLength(64)
  workspaceCode?: string;

  @IsOptional() @IsString() @MaxLength(128)
  clientId?: string;
}

export class ClientRefreshRequestDto implements ClientRefreshRequest {
  @IsString() @IsNotEmpty() @MaxLength(512)
  refreshToken!: string;
}

export class ClientSwitchWorkspaceRequestDto implements ClientSwitchWorkspaceRequest {
  @IsString() @IsNotEmpty() @MaxLength(64)
  workspaceCode!: string;
}

export class ClientChangePasswordRequestDto implements ClientChangePasswordRequest {
  @IsString() @IsNotEmpty() @MaxLength(128)
  currentPassword!: string;

  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  newPassword!: string;
}

export class ClientProfileUpdateRequestDto implements ClientProfileUpdateRequest {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120)
  name?: string;

  @IsOptional() @IsEmail() @MaxLength(191)
  email?: string | null;
}

export class ClientContactRequestDto implements ClientContactRequest {
  @IsOptional() @IsString() @MaxLength(191)
  id?: string;

  @IsIn(["emergency", "corporate", "other"])
  kind!: ClientContactRequest["kind"];

  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;

  @IsString() @IsNotEmpty() @MaxLength(32)
  phone!: string;

  @IsOptional() @IsEmail() @MaxLength(191)
  email?: string;

  @IsOptional() @IsString() @MaxLength(120)
  relation?: string;

  @IsOptional() @IsBoolean()
  isPrimary?: boolean;
}

export class ClientBookingIdentityInputDto {
  @IsOptional() @IsIn(["personal", "enterprise_employee"])
  bookingIdentity?: "personal" | "enterprise_employee";

  @IsOptional() @IsString() @MaxLength(191)
  corporateCustomerId?: string;

  @IsOptional() @IsBoolean()
  enterpriseContractAndPayer?: boolean;
}

export class ClientQuoteLineInputDto {
  @IsOptional() @IsString() @MaxLength(191)
  pricingGroupId?: string;

  @IsOptional() @IsString() @MaxLength(191)
  itemGroupId?: string;

  @IsInt() @Min(1)
  quantity!: number;

  @IsOptional() @IsIn(RENTAL_PRICING_UNIT_CODES)
  pricingUnit?: (typeof RENTAL_PRICING_UNIT_CODES)[number];

  @IsOptional() @IsNumber() @Min(0)
  usageQuantity?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}

export class ClientQuoteServiceInputDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  serviceId!: string;

  @IsInt() @Min(1)
  quantity!: number;

  @IsOptional() @IsISO8601()
  scheduledStartAt?: string;

  @IsOptional() @IsISO8601()
  scheduledEndAt?: string;

  @IsOptional() @IsString() @MaxLength(191)
  serviceLocationId?: string;
}

export class ClientCreateQuoteRequestDto implements ClientCreateQuoteRequest {
  @IsOptional() @ValidateNested() @Type(() => ClientBookingIdentityInputDto)
  bookingIdentity?: ClientBookingIdentityInputDto;

  @IsIn(FULFILLMENT_MODES)
  fulfillmentMode!: ClientCreateQuoteRequest["fulfillmentMode"];

  @IsString() @IsNotEmpty() @MaxLength(191)
  fulfillmentLocationId!: string;

  @IsOptional() @IsString() @MaxLength(191)
  returnLocationId?: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsOptional() @IsString() @MaxLength(191)
  pricingPlanId?: string;

  @IsOptional() @IsString() @MaxLength(191)
  discountPlanId?: string;

  @IsOptional() @IsString() @MaxLength(191)
  customerCouponId?: string;

  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => ClientQuoteLineInputDto)
  lines!: ClientQuoteLineInputDto[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ClientQuoteServiceInputDto)
  services?: ClientQuoteServiceInputDto[];
}

export class ClientAvailabilityLineInputDto {
  @IsString() @IsNotEmpty() @MaxLength(191)
  itemGroupId!: string;

  @IsInt() @Min(1)
  quantity!: number;
}

export class ClientAvailabilityRequestDto implements ClientAvailabilityRequest {
  @IsString() @IsNotEmpty() @MaxLength(191)
  locationId!: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => ClientAvailabilityLineInputDto)
  lines!: ClientAvailabilityLineInputDto[];
}

export class ClientCreateOrderRequestDto implements ClientCreateOrderRequest {
  @IsString() @IsNotEmpty() @MaxLength(191)
  quoteId!: string;

  @IsOptional() @IsString() @MaxLength(32)
  contactPhone?: string;
}

export class ClientCancelOrderRequestDto implements ClientCancelOrderRequest {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}

export class ClientOrderExtensionRequestDto implements ClientOrderExtensionRequest {
  @IsISO8601()
  newEndAt!: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ClientQuoteServiceInputDto)
  services?: ClientQuoteServiceInputDto[];

  @IsOptional() @IsString() @MaxLength(1000)
  memo?: string;
}

export class ClientSubmitQualificationRequestDto implements SubmitCustomerQualificationRequest {
  @IsString() @IsNotEmpty() @MaxLength(128)
  qualificationType!: string;

  @IsOptional() @IsString() @MaxLength(128)
  referenceNo?: string;

  @IsOptional() @IsISO8601()
  issuedAt?: string;

  @IsOptional() @IsISO8601()
  expiresAt?: string;

  @IsOptional() @IsString() @MaxLength(512)
  evidenceRef?: string;
}

export class ClientQualificationUploadSessionRequestDto implements ClientQualificationUploadSessionRequest {
  @IsString() @IsNotEmpty() @MaxLength(128)
  qualificationType!: string;

  @IsString() @IsNotEmpty() @MaxLength(180)
  fileName!: string;

  @IsString() @IsNotEmpty() @MaxLength(127)
  mimeType!: string;

  @IsInt() @Min(1) @Max(20 * 1024 * 1024)
  sizeBytes!: number;

  @IsString() @IsNotEmpty() @MaxLength(191)
  idempotencyKey!: string;
}

export class ClientQualificationUploadCompleteRequestDto implements ClientQualificationUploadCompleteRequest {
  @IsOptional() @IsString() @MaxLength(191)
  checksum?: string;
}

export class ClientPaymentSimulationRequestDto implements ClientPaymentSimulationRequest {
  @IsIn(["rental", "deposit", "preauthorization"])
  instrument!: ClientPaymentSimulationRequest["instrument"];

  @IsIn(["initiate", "append", "capture", "refund", "release", "fail"])
  action!: ClientPaymentSimulationRequest["action"];

  @IsOptional() @IsNumber() @Min(0)
  amount?: number;

  @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;

  @IsOptional() @IsString() @MaxLength(128)
  failureCode?: string;
}

export class ClientPaymentIntentRequestDto implements ClientPaymentIntentRequest {
  @IsIn(["rental", "deposit", "preauthorization"])
  instrument!: ClientPaymentIntentRequest["instrument"];

  @IsIn(["alipay", "wechat_pay"])
  method!: ClientPaymentIntentRequest["method"];

  @IsString() @IsNotEmpty() @MaxLength(191)
  idempotencyKey!: string;
}
