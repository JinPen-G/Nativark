import {
  FeatureOwnership, FeatureReleaseStatus, SubscriptionPlan, SubscriptionRequestStatus,
  SubscriptionRequestType, SubscriptionSource, type ExtendSubscriptionRequest, type GrantTenantFeatureRequest,
  type HandleSubscriptionRequestRequest, type ProvisionSubscriptionRequest, type RenewSubscriptionRequest,
  type RevokeTenantFeatureRequest, type ScheduleNextSubscriptionRequest, type SetStandardPriceRequest,
  type SubmitSubscriptionRequestRequest, type UpgradeSubscriptionProRequest, type UpsertFeatureCatalogRequest
} from "@rental-os/shared";
import { IsArray, IsBoolean, IsEnum, IsISO8601, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, Min } from "class-validator";

const NON_BLANK = /\S/;

export class ProvisionSubscriptionDto implements ProvisionSubscriptionRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsISO8601() startAt!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) serviceYears?: number;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsString() @IsNotEmpty() timeZone?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() @Max(9999999999.99) amount?: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(191) requestId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(64) priceVersion?: string;
}

export class RenewSubscriptionDto implements RenewSubscriptionRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) serviceYears?: number;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() @Max(9999999999.99) amount?: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(191) requestId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(64) priceVersion?: string;
}

export class UpgradeSubscriptionProDto implements UpgradeSubscriptionProRequest {
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() @Max(9999999999.99) amount?: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(191) requestId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(64) priceVersion?: string;
}

export class ExtendSubscriptionDto implements ExtendSubscriptionRequest {
  @IsISO8601() endAt!: string;
  @IsString() @Matches(NON_BLANK) @MaxLength(512) reason!: string;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class ScheduleNextSubscriptionDto implements ScheduleNextSubscriptionRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsISO8601() effectiveAt!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) serviceYears?: number;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() @Max(9999999999.99) amount?: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(191) requestId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsString() @Matches(NON_BLANK) @MaxLength(64) priceVersion?: string;
}

export class SubmitSubscriptionRequestDto implements SubmitSubscriptionRequestRequest {
  @IsEnum(SubscriptionRequestType) type!: SubscriptionRequestType;
  @IsOptional() @IsEnum(SubscriptionPlan) targetPlan?: SubscriptionPlan;
  @IsOptional() @IsArray() @IsString({ each: true }) moduleIntent?: string[];
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsString() @Matches(NON_BLANK) @MaxLength(191) dedupeKey!: string;
}

export class HandleSubscriptionRequestDto implements HandleSubscriptionRequestRequest {
  @IsEnum(SubscriptionRequestStatus) status!: SubscriptionRequestStatus;
  @IsOptional() @IsString() @MaxLength(512) publicReason?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class GrantTenantFeatureDto implements GrantTenantFeatureRequest {
  @IsString() @IsNotEmpty() @MaxLength(191) featureCode!: string;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class RevokeTenantFeatureDto implements RevokeTenantFeatureRequest {
  @IsString() @IsNotEmpty() @MaxLength(191) featureCode!: string;
  @IsString() @Matches(NON_BLANK) @MaxLength(512) reason!: string;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class UpsertFeatureCatalogDto implements UpsertFeatureCatalogRequest {
  @IsString() @IsNotEmpty() @MaxLength(191) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) module!: string;
  @IsArray() @IsString({ each: true }) categories!: string[];
  @IsEnum(FeatureOwnership) defaultOwnership!: FeatureOwnership;
  @IsEnum(FeatureOwnership) currentOwnership!: FeatureOwnership;
  @IsEnum(FeatureReleaseStatus) releaseStatus!: FeatureReleaseStatus;
  @IsOptional() @IsString() valueText?: string;
  @IsOptional() @IsString() prerequisiteText?: string;
  @IsOptional() @IsString() externalFeeNote?: string;
  @IsOptional() @IsString() @MaxLength(64) contentVersion?: string;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
}

export class SetStandardPriceDto implements SetStandardPriceRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() @Max(9999999999.99) annualFee?: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsBoolean() published!: boolean;
  @IsOptional() @IsString() @MaxLength(64) priceVersion?: string;
  @IsOptional() @IsString() @MaxLength(64) expectedPriceVersion?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
