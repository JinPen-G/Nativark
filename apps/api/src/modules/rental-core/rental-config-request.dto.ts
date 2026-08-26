import { RENTAL_PRICING_UNIT_CODES, type RentalDayType, type RentalPricingUnit } from "@store-rental/shared";
import type {
  ImportRentalCalendarRequest,
  PublishRentalCalendarRequest,
  VoidRentalCalendarRequest,
  RemoveRentalCalendarDayOverrideRequest,
  RentalRuleConfig,
  SaveRentalCalendarDayRequest,
  SaveRentalDiscountPlanRequest,
  SaveRentalNotificationTemplateRequest,
  SaveRentalPricingPlanRequest,
  SaveRentalRuleVersionRequest,
  SaveRentalValueAddedServiceRequest,
  SaveTenantRentalBusinessSettingsRequest
} from "@store-rental/shared";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateNested
} from "class-validator";

/**
 * 配置类请求 DTO。第三批，也是本分支 rental-core 写端点的最后一批。
 *
 * 这批与前两批的区别：请求体是**嵌套配置对象**，且多数由 `extends Omit<...>`
 * 从领域类型派生。因此每个嵌套分组都要建独立的 DTO 类并配 `@ValidateNested`。
 *
 * 关于 `@Type`：本项目 `apps/api/tsconfig.json` 开了 `emitDecoratorMetadata`，
 * TypeScript 会发出设计期类型，class-transformer 据此能推断出嵌套类，
 * 因此**单个嵌套对象**即使不写 `@Type` 内层校验也会执行（已实测确认）。
 * 但**数组元素**拿不到元素类型（`design:type` 只到 `Array`），必须显式 `@Type`，
 * 否则元素不会被实例化、内层校验静默跳过。为避免依赖编译选项这种远处的开关，
 * 这里两种情形一律显式声明。
 *
 * 嵌套分组一律必填（`business-settings` / `rule-versions` 是整体覆盖写，
 * 不是 PATCH 式局部更新，缺一组就会把该组配置写成 undefined）。
 * 这一点由 `scripts/validate-dto-coverage.cjs` 逐字段兜住。
 *
 * 关于倍率上界：`@Max` 不是凭空加的。倍率会直接乘进金额，写错一个数量级
 * （比如把 1.5 输成 15）不会被任何下游拦住，只会变成一笔离谱的账。
 */

const FULFILLMENT_MODES = [
  "store_pickup_return",
  "partner_pickup_return",
  "warehouse_pickup_return",
  "locker_pickup_return",
  "delivery",
  "onsite_delivery"
] as const;
const BUSINESS_STATUSES = ["open", "limited", "closed", "self_service"] as const;
const DAY_TYPES = ["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"] as const;
const PLAN_STATUSES = ["draft", "enabled", "disabled"] as const;
const ENABLE_STATUSES = ["enabled", "disabled"] as const;
const PAYMENT_TIMINGS = ["order", "confirmation", "pickup", "offline_terms"] as const;
const DEPOSIT_MODES = ["none", "fixed", "price_multiple", "preauthorization"] as const;
const OVERDUE_FEE_MODES = ["none", "hourly", "next_period", "multiplier", "manual_review"] as const;
const CANCELLATION_FEE_TYPES = ["none", "fixed_amount", "percentage"] as const;
const REWARD_TYPES = ["points", "balance", "coupon"] as const;
const REFERRAL_TRIGGERS = ["registration", "identity_verified", "first_order_completed"] as const;
const NOTIFICATION_CHANNELS = ["sms", "app_push", "wechat", "email"] as const;
const DISCOUNT_TYPES = ["percentage", "fixed_amount"] as const;
const CUSTOMER_SCOPES = ["all", "personal", "corporate", "member"] as const;
const SERVICE_TYPES = [
  "insurance",
  "damage_waiver",
  "delivery",
  "consumable",
  "operator",
  "support",
  "other"
] as const;
const BILLING_UNITS = ["per_order", "per_day", "per_unit"] as const;

/** 倍率上限。10 倍已远超任何真实节假日加价，写错数量级会在这里被挡下。 */
const MAX_MULTIPLIER = 10;

/** 日历日期键。只管格式；日期是否真实存在由服务层用回读法确认。 */
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 至少含一个非空白字符。
 *
 * `@IsNotEmpty()` 只拦空串，`" "` 会原样落库——审计栏显示为空，等于没记原因，
 * 而需求 4.5.3 / 4.5.7 要求人工覆盖与发布必须保存可追溯的原因。
 */
const NON_BLANK_PATTERN = /\S/;

/* ---------- 营业时段（被 business-settings 与营业日历共用） ---------- */

/**
 * 声明顺序有硬约束：`emitDecoratorMetadata` 会在被装饰属性处发出
 * `__metadata("design:type", RentalBusinessHoursInputDto)`，而那是**运行时求值**。
 * 若这两个类声明在使用它们的 DTO 之后，加载模块时就会
 * `ReferenceError: Cannot access 'RentalBusinessHoursInputDto' before initialization`
 * ——`class` 是 TDZ 绑定，不像函数会提升。因此它们必须排在所有使用者之前。
 */

/** 营业时段。`HH:mm` 24 小时制，营业时区当地时间。 */
export class RentalTimeWindowInputDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "时段起点必须是 HH:mm（24 小时制）" })
  start!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "时段终点必须是 HH:mm（24 小时制）" })
  end!: string;
}

/** 某天的营业时段与各履约动作可用时段（需求 4.5.1）。动作时段缺省沿用营业时段。 */
export class RentalBusinessHoursInputDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalTimeWindowInputDto)
  windows!: RentalTimeWindowInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalTimeWindowInputDto)
  pickup?: RentalTimeWindowInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalTimeWindowInputDto)
  return?: RentalTimeWindowInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalTimeWindowInputDto)
  delivery?: RentalTimeWindowInputDto[];
}

/* ---------- business-settings 的七个嵌套分组 ---------- */

export class BusinessSettingsPricingInputDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(RENTAL_PRICING_UNIT_CODES, { each: true })
  enabledUnits!: RentalPricingUnit[];

  @IsIn(RENTAL_PRICING_UNIT_CODES)
  defaultUnit!: RentalPricingUnit;

  /** 目前只支持人民币。放开前先确认计价与结算链路是否真的支持多币种。 */
  @IsIn(["CNY"])
  currency!: "CNY";

  @IsBoolean()
  taxIncluded!: boolean;

  @IsBoolean()
  holidayPricingEnabled!: boolean;
}

export class BusinessSettingsFulfillmentInputDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(FULFILLMENT_MODES, { each: true })
  enabledModes!: (typeof FULFILLMENT_MODES)[number][];

  @IsBoolean()
  allowDifferentReturnLocation!: boolean;
}

export class BusinessSettingsPaymentInputDto {
  @IsIn(PAYMENT_TIMINGS)
  timing!: (typeof PAYMENT_TIMINGS)[number];

  @IsIn(DEPOSIT_MODES)
  depositMode!: (typeof DEPOSIT_MODES)[number];

  @IsBoolean()
  preauthorizationRequired!: boolean;
}

export class BusinessSettingsOverdueInputDto {
  @IsInt()
  @Min(0)
  graceMinutes!: number;

  @IsIn(OVERDUE_FEE_MODES)
  feeMode!: (typeof OVERDUE_FEE_MODES)[number];

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  feeMultiplier!: number;
}

export class BusinessSettingsCalendarInputDto {
  /** 0=周日 … 6=周六。超出范围的值会让周末判定静默失效。 */
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekendDays!: number[];

  @IsBoolean()
  holidayPricingEnabled!: boolean;

  @IsIn(["CN", "NONE"])
  officialCalendarRegion!: "CN" | "NONE";

  /**
   * 每周默认营业模板，下标 0=周日 … 6=周六。未配置视为未声明时段限制。
   * 不强制长度为 7：只配工作日的空间不该被迫填满一周。
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalBusinessHoursInputDto)
  weeklyHours?: RentalBusinessHoursInputDto[];

  /**
   * IANA 时区标识。只校验非空字符串，具体是否为已知时区由服务层用 Intl 判定——
   * 把 418 个时区写进 @IsIn 既冗长又会随 ICU 升级过期。
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timeZone?: string;
}

export class BusinessSettingsMembershipInputDto {
  @IsBoolean()
  signupRewardEnabled!: boolean;

  @IsIn(REWARD_TYPES)
  signupRewardType!: (typeof REWARD_TYPES)[number];

  @IsNumber()
  @Min(0)
  signupRewardAmount!: number;

  @IsOptional()
  @IsString()
  signupRewardCouponTemplateId?: string;

  @IsBoolean()
  referralRewardEnabled!: boolean;

  @IsIn(REWARD_TYPES)
  referralRewardType!: (typeof REWARD_TYPES)[number];

  @IsNumber()
  @Min(0)
  referrerRewardAmount!: number;

  @IsNumber()
  @Min(0)
  inviteeRewardAmount!: number;

  @IsOptional()
  @IsString()
  referralRewardCouponTemplateId?: string;

  @IsIn(REFERRAL_TRIGGERS)
  referralTrigger!: (typeof REFERRAL_TRIGGERS)[number];
}

export class BusinessSettingsNotificationsInputDto {
  @IsArray()
  @IsString({ each: true })
  enabledEvents!: string[];

  @IsArray()
  @IsIn(NOTIFICATION_CHANNELS, { each: true })
  editableChannels!: (typeof NOTIFICATION_CHANNELS)[number][];
}

export class SaveTenantRentalBusinessSettingsDto implements SaveTenantRentalBusinessSettingsRequest {
  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSettingsPricingInputDto)
  pricing!: BusinessSettingsPricingInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSettingsFulfillmentInputDto)
  fulfillment!: BusinessSettingsFulfillmentInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSettingsPaymentInputDto)
  payment!: BusinessSettingsPaymentInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSettingsOverdueInputDto)
  overdue!: BusinessSettingsOverdueInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSettingsCalendarInputDto)
  calendar!: BusinessSettingsCalendarInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSettingsMembershipInputDto)
  membership!: BusinessSettingsMembershipInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => BusinessSettingsNotificationsInputDto)
  notifications!: BusinessSettingsNotificationsInputDto;
}

/* ---------- 定价方案 ---------- */

/** 阶梯价档位。嵌套对象必须 `@ValidateNested` + `@Type`，否则内层静默不校验。 */
export class RentalPricingTierInputDto {
  /** 达到该单位数后整单改用 unitAmount。1 起：0 档等于没有阶梯。 */
  @IsNumber()
  @Min(1)
  minUnits!: number;

  @IsNumber()
  @Min(0)
  unitAmount!: number;
}

/** 履约费用档。费用配在价格计划上，随版本发布与快照，理由见共享契约的注释。 */
export class RentalFulfillmentFeeInputDto {
  @IsIn(FULFILLMENT_MODES)
  mode!: (typeof FULFILLMENT_MODES)[number];

  @IsNumber()
  @Min(0)
  amount!: number;

  /** 异地归还附加费。0 是合法值（异地免费），因此判空必须用 undefined。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  crossLocationAmount?: number;
}

export class RentalPricingRateInputDto {
  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsIn(RENTAL_PRICING_UNIT_CODES)
  unit!: RentalPricingUnit;

  @IsNumber()
  @Min(0)
  baseAmount!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  weekendMultiplier!: number;

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  holidayMultiplier!: number;

  @IsNumber()
  @Min(0)
  depositAmount!: number;

  @IsNumber()
  @Min(1)
  minimumUnits!: number;

  /** 阶梯价（需求 4.4）。 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPricingTierInputDto)
  tiers?: RentalPricingTierInputDto[];

  /**
   * 封顶价（需求 4.4）。允许 0（免租），因此判空必须用 undefined 而非真值判断。
   * 不设上界：封顶价本身就是上限，再加人为上界只会挡住合法的高价商品。
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  /**
   * 小时粒度（分钟），仅小时计价使用。1..1440：0 会让单位数变成 Infinity，
   * 超过一天的"小时粒度"没有业务含义。
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  hourGranularityMinutes?: number;

  /** 租金倍数押金的倍数。上界复用 MAX_MULTIPLIER：押金 10 倍租金已远超任何真实场景。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  depositMultiple?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  includedUsage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  excessUsageAmount?: number;
}

export class SaveRentalPricingPlanDto implements SaveRentalPricingPlanRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsIn(PLAN_STATUSES)
  status?: (typeof PLAN_STATUSES)[number];

  /**
   * 必填。此前只校验了 effectiveTo 与 effectiveFrom 的先后，从不校验它本身；
   * 内存实现存 undefined 无碍，落库后 `DateTime NOT NULL` 直接报错，
   * 表现为下单前的定价计划创建 500。
   */
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  /** 变更原因进配置版本记录，空字符串没有追溯价值。 */
  @IsString()
  @IsNotEmpty()
  changeReason!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RentalPricingRateInputDto)
  rates!: RentalPricingRateInputDto[];

  /** 履约费用（需求 4.4）。可选：不配置即该计划不收履约费。 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalFulfillmentFeeInputDto)
  fulfillmentFees?: RentalFulfillmentFeeInputDto[];
}

/* ---------- 优惠方案 ---------- */

export class SaveRentalDiscountPlanDto implements SaveRentalDiscountPlanRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(PLAN_STATUSES)
  status!: (typeof PLAN_STATUSES)[number];

  @IsIn(DISCOUNT_TYPES)
  discountType!: (typeof DISCOUNT_TYPES)[number];

  @IsNumber()
  @Min(0)
  discountValue!: number;

  @IsNumber()
  @Min(0)
  minimumSpend!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumDiscount?: number;

  @IsIn(CUSTOMER_SCOPES)
  customerScope!: (typeof CUSTOMER_SCOPES)[number];

  @IsArray()
  @IsString({ each: true })
  applicableItemGroupIds!: string[];

  @IsArray()
  @IsIn(DAY_TYPES, { each: true })
  applicableDayTypes!: RentalDayType[];

  /** 优先级决定多方案命中时的取舍顺序，必须是整数。 */
  @IsInt()
  @Min(0)
  priority!: number;

  @IsBoolean()
  stackableWithCoupon!: boolean;

  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsString()
  @IsNotEmpty()
  changeReason!: string;
}

/* ---------- 增值服务 ---------- */

export class SaveRentalValueAddedServiceDto implements SaveRentalValueAddedServiceRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(SERVICE_TYPES)
  serviceType!: (typeof SERVICE_TYPES)[number];

  @IsIn(BILLING_UNITS)
  billingUnit!: (typeof BILLING_UNITS)[number];

  @IsNumber()
  @Min(0)
  price!: number;

  @IsInt()
  @Min(1)
  maximumQuantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  coverageLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deductible?: number;

  /** 条款版本与正文会作为快照写进订单，缺了就无法解释当时的免赔口径。 */
  @IsString()
  @IsNotEmpty()
  termsVersion!: string;

  @IsString()
  @IsNotEmpty()
  terms!: string;

  @IsArray()
  @IsString({ each: true })
  applicableItemGroupIds!: string[];

  @IsIn(ENABLE_STATUSES)
  status!: (typeof ENABLE_STATUSES)[number];
}

/* ---------- 规则版本 ---------- */

export class RuleConfigPaymentInputDto {
  @IsIn(PAYMENT_TIMINGS)
  timing!: (typeof PAYMENT_TIMINGS)[number];

  @IsIn(DEPOSIT_MODES)
  depositMode!: (typeof DEPOSIT_MODES)[number];

  @IsBoolean()
  preauthorizationRequired!: boolean;

  @IsInt()
  @Min(0)
  unpaidHoldMinutes!: number;
}

export class RuleConfigFulfillmentInputDto {
  @IsBoolean()
  pickupInspectionRequired!: boolean;

  @IsBoolean()
  returnInspectionRequired!: boolean;

  @IsBoolean()
  evidenceRequired!: boolean;

  @IsBoolean()
  allowDifferentReturnLocation!: boolean;
}

export class RuleConfigOverdueInputDto {
  @IsInt()
  @Min(0)
  graceMinutes!: number;

  @IsIn(OVERDUE_FEE_MODES)
  feeMode!: (typeof OVERDUE_FEE_MODES)[number];

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  feeMultiplier!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumFee?: number;
}

export class RuleConfigCancellationInputDto {
  @IsNumber()
  @Min(0)
  freeBeforeHours!: number;

  @IsIn(CANCELLATION_FEE_TYPES)
  lateFeeType!: (typeof CANCELLATION_FEE_TYPES)[number];

  @IsNumber()
  @Min(0)
  lateFeeValue!: number;

  @IsBoolean()
  weatherExceptionEnabled!: boolean;
}

export class RuleConfigQualificationInputDto {
  @IsBoolean()
  required!: boolean;

  @IsArray()
  @IsString({ each: true })
  documentTypes!: string[];

  @IsInt()
  @Min(0)
  minimumValidityDays!: number;
}

export class RuleConfigDamageInputDto {
  @IsBoolean()
  manualReviewRequired!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  chargeLimit?: number;
}

/** 计价相关的经营空间规则（需求 4.4.5：班次时长及边界由经营空间规则定义）。 */
export class RuleConfigPricingInputDto {
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(24)
  shiftHours?: number;

  /** 一天内各班次起始小时。0..23：24 等于次日 0 点，用 0 表达即可。 */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(23, { each: true })
  shiftStartHours?: number[];
}

export class RentalRuleConfigInputDto implements RentalRuleConfig {
  /** 整组可缺省：既有规则快照没有这一组，历史订单必须继续按原快照复算。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigPricingInputDto)
  pricing?: RuleConfigPricingInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigPaymentInputDto)
  payment!: RuleConfigPaymentInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigFulfillmentInputDto)
  fulfillment!: RuleConfigFulfillmentInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigOverdueInputDto)
  overdue!: RuleConfigOverdueInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigCancellationInputDto)
  cancellation!: RuleConfigCancellationInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigQualificationInputDto)
  qualification!: RuleConfigQualificationInputDto;

  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigDamageInputDto)
  damage!: RuleConfigDamageInputDto;
}

export class SaveRentalRuleVersionDto implements SaveRentalRuleVersionRequest {
  @IsObject()
  @ValidateNested()
  @Type(() => RentalRuleConfigInputDto)
  config!: RentalRuleConfigInputDto;

  @IsString()
  @IsNotEmpty()
  changeReason!: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/* ---------- 营业日历 ---------- */

export class ImportRentalCalendarDayInputDto {
  /**
   * 只接受 `YYYY-MM-DD`。`@IsISO8601()` 会放过带时间的完整时间戳，
   * 日历按日键控，同一天就会出现两个键。日期是否真实存在由服务层用回读法确认——
   * 正则拦不住 `2026-02-30`，而它会被 `new Date` 静默滚到 3 月 2 日。
   */
  @Matches(CALENDAR_DATE_PATTERN, { message: "日历日期必须是 YYYY-MM-DD" })
  date!: string;

  @IsIn(DAY_TYPES)
  dayType!: RentalDayType;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  pricingMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  closed?: boolean;
}

export class ImportRentalCalendarDto implements ImportRentalCalendarRequest {
  @IsInt()
  @Min(2000)
  @Max(2999)
  year!: number;

  @IsIn(["CN"])
  region!: "CN";

  @IsString()
  @IsNotEmpty()
  sourceName!: string;

  /** 官方来源地址进配置版本记录，用于日后追溯这批日期的出处。 */
  @IsUrl({ require_tld: false })
  sourceUrl!: string;

  @IsISO8601()
  sourcePublishedAt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ImportRentalCalendarDayInputDto)
  days!: ImportRentalCalendarDayInputDto[];
}

export class SaveRentalCalendarDayDto implements SaveRentalCalendarDayRequest {
  /**
   * 处理器会用路径参数覆盖它（`{ ...body, date }`），此处仍校验以防直接调用。
   * 与导入同理只接受 `YYYY-MM-DD`；真实性由服务层确认。
   */
  @Matches(CALENDAR_DATE_PATTERN, { message: "日历日期必须是 YYYY-MM-DD" })
  date!: string;

  @IsIn(DAY_TYPES)
  dayType!: RentalDayType;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  pricingMultiplier!: number;

  /** 两态遗留字段，保留以兼容既有调用方；同时给出四态时以四态为准。 */
  @IsBoolean()
  closed!: boolean;

  /** 四态营业状态（需求 4.5.4）。不传时由 closed 推导。 */
  @IsOptional()
  @IsIn(BUSINESS_STATUSES)
  businessStatus?: (typeof BUSINESS_STATUSES)[number];

  /** 该日期的营业时段覆盖（需求 4.5.3）。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RentalBusinessHoursInputDto)
  hours?: RentalBusinessHoursInputDto;

  /**
   * 调整原因，必填（需求 4.5.3：人工覆盖必须保存调整原因）。
   * 操作人与调整时间由服务端填，不接受调用方自报——自报的操作人没有审计价值。
   */
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "调整原因不能为空白" })
  overrideReason!: string;
}

/**
 * 移除人工覆盖的请求体。DELETE 带 body 不常见，但撤销原因必须随请求一起到达：
 * 放在查询串里会进访问日志，而覆盖原因常包含客户名或事故描述。
 */
export class RemoveRentalCalendarDayOverrideDto implements RemoveRentalCalendarDayOverrideRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "调整原因不能为空白" })
  overrideReason!: string;
}

/** 发布年度日历（需求 4.5.7：发布记录必须可追溯变更原因）。 */
export class PublishRentalCalendarDto implements PublishRentalCalendarRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "变更原因不能为空白" })
  // 落库为 rental_business_calendars.changeReason（VARCHAR(191)）。不限长的话超长文本
  // 会在 STRICT_TRANS_TABLES 下由数据库抛错、表现为 500，这里改成配置层 400。
  @MaxLength(191, { message: "变更原因不能超过 191 字" })
  changeReason!: string;
}

/** 作废年度日历草稿（需求 4.5.7）。原因必填，用于事后解释这条草稿为何被丢弃。 */
export class VoidRentalCalendarDto implements VoidRentalCalendarRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "作废原因不能为空白" })
  // 落库为 rental_business_calendars.voidReason（VARCHAR(191)），同上限长以免 500。
  @MaxLength(191, { message: "作废原因不能超过 191 字" })
  reason!: string;
}

/* ---------- 通知模板 ---------- */

export class SaveRentalNotificationTemplateDto implements SaveRentalNotificationTemplateRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  eventCode!: string;

  @IsIn(NOTIFICATION_CHANNELS)
  channel!: (typeof NOTIFICATION_CHANNELS)[number];

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;

  /**
   * 变量 schema 的键是模板自定义的变量名，无法静态声明，故只校验是对象。
   * 值的形状（`{ label, required }`）在服务层渲染时校验。
   */
  @IsObject()
  variableSchema!: Record<string, { label: string; required: boolean }>;

  @IsIn(ENABLE_STATUSES)
  status!: (typeof ENABLE_STATUSES)[number];
}
