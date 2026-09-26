import {
  FeatureOwnership,
  FeatureReleaseStatus,
  SubscriptionPlan,
  SubscriptionRequestStatus,
  SubscriptionRequestType,
  SubscriptionSource,
  type ExtendSubscriptionRequest,
  type GrantTenantFeatureRequest,
  type HandleSubscriptionRequestRequest,
  type ProvisionSubscriptionRequest,
  type RenewSubscriptionRequest,
  type RevokeTenantFeatureRequest,
  type ScheduleNextSubscriptionRequest,
  type SetStandardPriceRequest,
  type SubmitSubscriptionRequestRequest,
  type UpgradeSubscriptionProRequest,
  type UpsertFeatureCatalogRequest
} from "@rental-os/shared";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min
} from "class-validator";

/**
 * SUB-01 写操作 DTO。每个类 `implements` 共享写契约，逐字段带校验装饰器——
 * `ValidationPipe({ whitelist: true })` 会剥离无装饰器字段，`scripts/validate-dto-coverage.cjs`
 * 静态兜住漏声明。金额可空=待确认（§14.2），非正数由服务层归 null，这里只做类型与下界校验。
 */

/** 至少一个非空白字符：`@IsNotEmpty` 只拦空串，`" "` 会原样落库、等于没记原因。 */
const NON_BLANK = /\S/;

/** 直接开通（§7.1/§8.2）。start 必填；serviceYears 与 endAt 二选一（服务层校验）。 */
export class ProvisionSubscriptionDto implements ProvisionSubscriptionRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsISO8601() startAt!: string;
  @IsOptional() @IsInt() @Min(1) serviceYears?: number;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsString() @IsNotEmpty() timeZone?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsOptional() @IsInt() @Min(0) expectedRevision?: number;
}

/** 续期（§4.4）。有效期内缺 startAt 接续当前截止；已过期须显式 startAt（服务层校验）。 */
export class RenewSubscriptionDto implements RenewSubscriptionRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsInt() @Min(1) serviceYears?: number;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsOptional() @IsInt() @Min(0) expectedRevision?: number;
}

/** 升级为 PRO（§4.4）：保持原统一截止，仅记录人工补差金额（可空）。 */
export class UpgradeSubscriptionProDto implements UpgradeSubscriptionProRequest {
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
  @IsOptional() @IsInt() @Min(0) expectedRevision?: number;
}
/** 临时延长当前套餐截止（§4.4/§8.2）。须填原因；不伪造收款。 */
export class ExtendSubscriptionDto implements ExtendSubscriptionRequest {
  @IsISO8601() endAt!: string;
  @IsString() @Matches(NON_BLANK, { message: "临时延长必须填写原因" }) @MaxLength(512) reason!: string;
  @IsOptional() @IsInt() @Min(0) expectedRevision?: number;
}

/** 登记下一段套餐（续费或下期降级，§4.4）。当前付费期不提前结束，到 effectiveAt 切换。 */
export class ScheduleNextSubscriptionDto implements ScheduleNextSubscriptionRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsEnum(SubscriptionSource) source!: SubscriptionSource;
  @IsISO8601() effectiveAt!: string;
  @IsOptional() @IsInt() @Min(1) serviceYears?: number;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
}

/** 租户提交升级/续费/降级/不续费/咨询申请（§7.2）。dedupeKey 幂等去重。 */
export class SubmitSubscriptionRequestDto implements SubmitSubscriptionRequestRequest {
  @IsEnum(SubscriptionRequestType) type!: SubscriptionRequestType;
  @IsOptional() @IsEnum(SubscriptionPlan) targetPlan?: SubscriptionPlan;
  @IsOptional() @IsArray() @IsString({ each: true }) moduleIntent?: string[];
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsString() @Matches(NON_BLANK, { message: "缺少幂等去重键" }) @MaxLength(191) dedupeKey!: string;
}
/** SaaS 管理员办理申请（§7.3）：转已办理/已拒绝，附可公开原因；实际开通另走开通接口。 */
export class HandleSubscriptionRequestDto implements HandleSubscriptionRequestRequest {
  @IsEnum(SubscriptionRequestStatus) status!: SubscriptionRequestStatus;
  @IsOptional() @IsString() @MaxLength(512) publicReason?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

/** 单租户额外授权（§3.5 tenant_specific）。目标租户走路径参数。 */
export class GrantTenantFeatureDto implements GrantTenantFeatureRequest {
  @IsString() @IsNotEmpty() @MaxLength(191) featureCode!: string;
  @IsOptional() @IsString() @MaxLength(512) reason?: string;
}

/** 撤销单租户额外授权（§3.5.8）。记录原因，保护既有承诺。 */
export class RevokeTenantFeatureDto implements RevokeTenantFeatureRequest {
  @IsString() @IsNotEmpty() @MaxLength(191) featureCode!: string;
  @IsString() @Matches(NON_BLANK, { message: "撤销单租户授权必须填写原因" }) @MaxLength(512) reason!: string;
}
/** 维护功能目录条目并设当前归属（§3.3/§8）。currentOwnership=standard 即公共下放基础版。全量 PUT。 */
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

/** 维护标准套餐年费（§5.2/§8）。未发布省略 annualFee、不落 0（§14.2 S-D01）。 */
export class SetStandardPriceDto implements SetStandardPriceRequest {
  @IsEnum(SubscriptionPlan) plan!: SubscriptionPlan;
  @IsOptional() @IsNumber() @Min(0) annualFee?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsBoolean() published!: boolean;
  @IsOptional() @IsString() @MaxLength(64) priceVersion?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
