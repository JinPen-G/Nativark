import { RENTAL_CURRENCY_CODES, RENTAL_DISCOUNT_TARGETS, RENTAL_DISCOUNT_TYPES, RENTAL_FULFILLMENT_MODES, RENTAL_INSURANCE_PROVIDER_STATUSES, RENTAL_PAYMENT_METHOD_CODES, RENTAL_PRICING_UNIT_CODES, RENTAL_SECURITY_RISK_LEVELS, RENTAL_SERVICE_BILLING_UNITS, RENTAL_SERVICE_SELECTION_MODES, type RentalCurrency, type RentalDayType, type RentalDiscountTarget, type RentalInsuranceProviderStatus, type RentalPricingUnit, type RentalServiceMandatoryRule, type RentalServiceSelectionMode } from "@rental-os/shared";
import type {
  ApplyOfficialCalendarSourceRequest,
  PublishRentalCalendarRequest,
  RegisterOfficialCalendarSourceVersionRequest,
  RestoreRentalCalendarVersionRequest,
  SaveOfficialCalendarSourceRequest,
  VoidRentalCalendarRequest,
  RemoveRentalCalendarDayOverrideRequest,
  PreviewRentalCalendarRangeOverrideRequest,
  ApplyRentalCalendarRangeOverrideRequest,
  PreviewRentalCalendarRangeRemoveRequest,
  ApplyRentalCalendarRangeRemoveRequest,
  RentalCalendarRangeFields,
  RentalRuleConfig,
  SaveRentalCalendarDayRequest,
  SaveRentalDiscountPlanRequest,
  SaveRentalNotificationTemplateRequest,
  SaveRentalPricingPlanRequest,
  SaveRentalRuleVersionRequest,
  PublishRentalRuleVersionRequest,
  RestoreRentalRuleVersionRequest,
  VoidRentalRuleVersionRequest,
  SaveRentalValueAddedServiceRequest,
  SaveRentalServiceCapacityRequest,
  SaveTenantRentalBusinessSettingsRequest,
  CreateRentalPriceAdjustmentRequest,
  CancelRentalPriceAdjustmentRequest,
  RestoreRentalPriceVersionRequest,
  RentalPeriodicPriceWindow,
  RentalDatetimePriceOverride
} from "@rental-os/shared";
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

const BUSINESS_STATUSES = ["open", "limited", "closed", "self_service"] as const;
const DAY_TYPES = ["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"] as const;
const PLAN_STATUSES = ["draft", "enabled", "disabled"] as const;
const ENABLE_STATUSES = ["enabled", "disabled"] as const;
const PAYMENT_TIMINGS = ["order", "confirmation", "pickup", "offline_terms"] as const;
const DEPOSIT_MODES = ["none", "fixed", "price_multiple", "preauthorization"] as const;
/** 押金与预授权各自的模式：不含 `preauthorization`——它是旧「二选一」口径里的模式值，
 *  在拆分后由 `preauthorization` 规则组本身表达，留在这里会让两套口径互相污染。
 *  RULE-01B：押金新增 `order_fixed`（每单固定）；预授权另有 `risk_surcharge`（风险附加）。 */
const DEPOSIT_RULE_MODES = ["none", "fixed", "price_multiple", "order_fixed"] as const;
const PREAUTH_RULE_MODES = ["none", "fixed", "price_multiple", "order_fixed", "risk_surcharge"] as const;
const OVERDUE_FEE_MODES = ["none", "hourly", "next_period", "multiplier", "manual_review"] as const;
const CANCELLATION_FEE_TYPES = ["none", "fixed_amount", "percentage"] as const;
const REWARD_TYPES = ["points", "balance", "coupon"] as const;
const REFERRAL_TRIGGERS = ["registration", "identity_verified", "first_order_completed"] as const;
const NOTIFICATION_CHANNELS = ["sms", "app_push", "wechat", "email"] as const;
// MKT-01A：需求 4.4.10 第一阶段三种优惠类型。复杂规则（满租期赠送、指定商品固定价、
// 免履约费、指定服务减免）必须另建模型，不得塞进这三个字段。
const DISCOUNT_TYPES = RENTAL_DISCOUNT_TYPES;
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
// MKT-02A：服务计费单位独立于商品租金单位（需求 4.4.11）。per_day 是**自然日**。
const BILLING_UNITS = RENTAL_SERVICE_BILLING_UNITS;

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

  /**
   * 经营空间的结算币种（需求 §948）。
   *
   * 只收登记过符号与小数位的币种：`RENTAL_CURRENCY_CODES` 全是两位小数的币种，
   * 放开成任意字符串会让「JPY」这类 0 位小数的币种进来，而全库金额列都是 Decimal(12,2)。
   */
  @IsIn(RENTAL_CURRENCY_CODES)
  currency!: RentalCurrency;

  @IsBoolean()
  taxIncluded!: boolean;

  @IsBoolean()
  holidayPricingEnabled!: boolean;
}

export class BusinessSettingsFulfillmentInputDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(RENTAL_FULFILLMENT_MODES, { each: true })
  enabledModes!: (typeof RENTAL_FULFILLMENT_MODES)[number][];
}

/**
 * 经营设置里的支付块只剩收款方式。付款时机、押金模式与预授权要求是规则版本
 * （`RuleConfigPaymentInputDto`）的字段——它们随报价进快照，放在设置里的副本从不参与计算。
 * 逾期规则同理，整块已并入 `RuleConfigOverdueInputDto`。
 */
export class BusinessSettingsPaymentInputDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(RENTAL_PAYMENT_METHOD_CODES, { each: true })
  enabledMethods!: (typeof RENTAL_PAYMENT_METHOD_CODES)[number][];
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

export class BusinessSettingsAllocationInputDto {
  @IsBoolean() autoPreassign!: boolean;
  @IsInt() @Min(0) @Max(365) preassignDays!: number;
  @IsBoolean() autoLock!: boolean;
  @IsInt() @Min(0) @Max(43200) lockMinutes!: number;
  @IsBoolean() protectManual!: boolean;
}

export class SaveTenantRentalBusinessSettingsDto implements SaveTenantRentalBusinessSettingsRequest {
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessSettingsAllocationInputDto)
  allocation?: BusinessSettingsAllocationInputDto;
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
  /** 整单换价或累进档位的起点，必须为正整数。 */
  @IsInt()
  @Min(1)
  minUnits!: number;

  @IsNumber()
  @Min(0)
  unitAmount!: number;
}

/** 履约费用档。费用配在价格计划上，随版本发布与快照，理由见共享契约的注释。 */
export class RentalFulfillmentFeeInputDto {
  @IsIn(RENTAL_FULFILLMENT_MODES)
  mode!: (typeof RENTAL_FULFILLMENT_MODES)[number];

  @IsNumber()
  @Min(0)
  amount!: number;

  /** 异地归还附加费。0 是合法值（异地免费），因此判空必须用 undefined。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  crossLocationAmount?: number;
}

/** PRICE-03：周期性计价时段输入（fromWeekday 0-6、HH:mm）。 */
export class RentalPeriodicPriceWindowInputDto implements RentalPeriodicPriceWindow {
  @IsInt()
  @Min(0)
  @Max(6)
  fromWeekday!: number;

  @IsString()
  @Matches(/^[0-9]{1,2}:[0-9]{2}$/, { message: "起始时刻必须是 HH:mm" })
  fromTime!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  toWeekday!: number;

  @IsString()
  @Matches(/^[0-9]{1,2}:[0-9]{2}$/, { message: "结束时刻必须是 HH:mm" })
  toTime!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  multiplier!: number;
}

/** PRICE-03：一次性日期时间价格覆盖输入。 */
export class RentalDatetimePriceOverrideInputDto implements RentalDatetimePriceOverride {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,64}$/, { message: "一次性价格引用只能是 1-64 位字母数字与 . _ : -" })
  id?: string;

  @IsISO8601()
  start!: string;

  @IsISO8601()
  end!: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  multiplier!: number;
}

export class RentalPricingRateInputDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pricingGroupId?: string;

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

  /** 时间租赁默认按整单换价；使用量阶梯必须明确选择 progressive。 */
  @IsOptional()
  @IsIn(["whole_order", "progressive"])
  tierMode?: "whole_order" | "progressive";

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

  /** PRICE-03：商品在该日期类型下的价格系数（v2.9 4.5.5）。 */
  @IsOptional()
  @IsObject()
  dayTypePrices?: Record<string, number>;

  /** PRICE-03：周期性计价时段（跨星期边界，按取价时点命中）。 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPeriodicPriceWindowInputDto)
  periodicWindows?: RentalPeriodicPriceWindowInputDto[];

  /** PRICE-03：一次性日期时间价格覆盖的价格值（适用范围在日历侧）。 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalDatetimePriceOverrideInputDto)
  datetimeOverrides?: RentalDatetimePriceOverrideInputDto[];

  /** 租金倍数押金的倍数。上界复用 MAX_MULTIPLIER：押金 10 倍租金已远超任何真实场景。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  depositMultiple?: number;

  /** 预授权额度的固定金额（需求 4.4.7）。缺省回落到 depositAmount。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  preAuthAmount?: number;

  /** 预授权额度的租金倍数。缺省回落到 depositMultiple。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  preAuthMultiple?: number;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicablePricingGroupIds?: string[];

  @IsArray()
  @IsIn(DAY_TYPES, { each: true })
  applicableDayTypes!: RentalDayType[];

  /** 优先级决定多方案命中时的取舍顺序，必须是整数。 */
  @IsInt()
  @Min(0)
  priority!: number;

  /**
   * MKT-01A：优惠作用的费用对象。取值域只有 rental / fulfillment / service——
   * 需求 4.4.10 明确普通优惠不得减免押金、预授权与异常费用，因此它们不在枚举里，
   * 请求里写了也会被 DTO 直接拒掉，而不是靠服务层再判一次。
   */
  @IsIn(RENTAL_DISCOUNT_TARGETS)
  appliesTo!: RentalDiscountTarget;

  /** 满额固定减免的门槛；仅 discountType = threshold_amount 使用。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  thresholdAmount?: number;

  /** 互斥组。留空表示自成一组，只与自己互斥。 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  exclusiveGroup?: string;

  /** 是否允许与其他优惠方案同时应用（跨互斥组叠加需双方都允许）。 */
  @IsBoolean()
  stackableWithOtherPlans!: boolean;

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

/** MKT-02A：条件强制服务的触发规则。留空的维度表示不限制。 */
export class RentalServiceMandatoryRuleInputDto implements RentalServiceMandatoryRule {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  itemGroupIds?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(RENTAL_FULFILLMENT_MODES, { each: true })
  fulfillmentModes?: (typeof RENTAL_FULFILLMENT_MODES)[number][];

  @IsOptional()
  @IsNumber()
  @Min(0)
  minRentalAmount?: number;
}

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
  minimumQuantity!: number;

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

  /** MKT-02A：适用履约方式与地点。空数组＝不限制。 */
  @IsArray()
  @IsIn(RENTAL_FULFILLMENT_MODES, { each: true })
  applicableFulfillmentModes!: (typeof RENTAL_FULFILLMENT_MODES)[number][];

  @IsArray()
  @IsString({ each: true })
  applicableLocationIds!: string[];

  @IsIn(["all", "personal", "corporate"])
  customerScope!: "all" | "personal" | "corporate";

  /** MKT-02A：客户可选 / 系统推荐 / 条件强制（需求 4.4.11）。 */
  @IsIn(RENTAL_SERVICE_SELECTION_MODES)
  selectionMode!: RentalServiceSelectionMode;

  /** 条件强制服务的触发规则。嵌套对象，逐字段校验。 */
  @IsOptional()
  @ValidateNested()
  @Type(() => RentalServiceMandatoryRuleInputDto)
  mandatoryRule?: RentalServiceMandatoryRuleInputDto;

  /**
   * MKT-02A：第三方保险接入状态。取值域刻意没有「已投保」——未接入真实服务商前
   * 不得展示已投保或虚构保单号（需求 4.4.11）。损坏免赔配它属于冒充保险，
   * 由服务层按 serviceType 拒绝。
   */
  @IsOptional()
  @IsIn(RENTAL_INSURANCE_PROVIDER_STATUSES)
  insuranceProviderStatus?: RentalInsuranceProviderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  insuranceProviderName?: string;

  @IsBoolean()
  requiresCapacity!: boolean;

  @IsIn(ENABLE_STATUSES)
  status!: (typeof ENABLE_STATUSES)[number];
}

export class SaveRentalServiceCapacityDto implements SaveRentalServiceCapacityRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsISO8601()
  windowStart!: string;

  @IsISO8601()
  windowEnd!: string;

  @IsInt()
  @Min(1)
  totalCapacity!: number;

  @IsIn(ENABLE_STATUSES)
  status!: "enabled" | "disabled";
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

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  quoteValidityMinutes?: number;
}

/**
 * 应付押金规则（需求 4.4.7）。与预授权**独立**配置，可同时存在。
 * 整组可选：缺省时服务端由旧的 `payment.depositMode` 派生，既有规则快照口径不变。
 */
export class RuleConfigDepositInputDto {
  @IsIn(DEPOSIT_RULE_MODES)
  mode!: (typeof DEPOSIT_RULE_MODES)[number];

  /** 单笔订单押金上限。0 是合法值（等于免押），因此判空用 undefined。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  /** 每单固定押金，仅 order_fixed 使用。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedAmount?: number;
}

/** 预授权规则（需求 4.4.7）。与押金独立，可同时存在；另有风险附加模式。 */
export class RuleConfigPreauthorizationInputDto {
  @IsIn(PREAUTH_RULE_MODES)
  mode!: (typeof PREAUTH_RULE_MODES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  /** 订单固定额度，仅 order_fixed 使用。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedAmount?: number;

  /** 风险附加额度，仅 risk_surcharge 使用；加在按行租金倍数求和之上。 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  riskSurchargeAmount?: number;
}

export class RuleConfigFulfillmentInputDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(43200)
  pickupBufferMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(43200)
  returnBufferMinutes?: number;

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
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  hourlyRatePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(24)
  dailyAfterHours?: number;
  @IsInt()
  @Min(0)
  graceMinutes!: number;

  @IsIn([...OVERDUE_FEE_MODES, "hourly_to_daily"])
  feeMode!: (typeof OVERDUE_FEE_MODES)[number] | "hourly_to_daily";

  @IsNumber()
  @Min(0)
  @Max(MAX_MULTIPLIER)
  feeMultiplier!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumFee?: number;
}

export class RuleConfigNoShowInputDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  pickupGraceMinutes!: number;

  @IsInt()
  @Min(1)
  finalizationMinutes!: number;

  @IsIn(CANCELLATION_FEE_TYPES)
  feeType!: (typeof CANCELLATION_FEE_TYPES)[number];

  @IsNumber()
  @Min(0)
  feeValue!: number;
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

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigNoShowInputDto)
  noShow?: RuleConfigNoShowInputDto;
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
  @IsBoolean()
  hourToDayEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(24)
  hourToDayThresholdHours?: number;
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

/** 续租 / 延期的准入规则（需求 4.6.9）。金额一律由增量期重新报价得出，此处不配单价。 */
export class RuleConfigExtensionInputDto {
  @IsOptional()
  @IsIn(["incremental", "original_total"])
  pricingMode?: "incremental" | "original_total";
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTimes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTotalDays?: number;

  @IsBoolean()
  forceImmediateWhenOverdue!: boolean;
}

/**
 * 提前归还退款规则（需求 4.6.8）。
 *
 * 只有「提前多久」与「退几成」两个旋钮：折算口径（按未使用计费单位占比、阶梯不重算、
 * 优惠同比例折减）固定在代码里，不给选项——留选项会让同一空间的历史订单出现两种退款
 * 口径，事后无法向客户解释。
 */
export class RuleConfigEarlyReturnInputDto {
  @IsIn(["none", "auto", "manual_review"])
  mode!: "none" | "auto" | "manual_review";

  @IsNumber()
  @Min(0)
  minAdvanceHours!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercent!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxRefundAmount?: number;

  @IsBoolean()
  refundUndeliveredServices!: boolean;
}

/**
 * 税规则。只支持价内税，因此 `inclusive` 只接受 true——写 false 会被这里直接挡掉，
 * 而不是悄悄按价内税算出一个客户对不上的金额。
 */
export class RuleConfigTaxInputDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  rate!: number;

  @IsIn([true])
  inclusive!: true;

  @IsOptional()
  @IsString()
  label?: string;
}

/** 会员押金/预授权减免的空间风控门禁。启用状态下的跨字段必填由 RentalBusinessService 校验。 */
export class RuleConfigMembershipSecurityPolicyInputDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsArray()
  @IsIn(RENTAL_SECURITY_RISK_LEVELS, { each: true })
  allowedRiskLevels?: Array<(typeof RENTAL_SECURITY_RISK_LEVELS)[number]>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxReductionPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxReductionAmount?: number;
}

export class RuleConfigMembershipSecurityReductionInputDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigMembershipSecurityPolicyInputDto)
  deposit?: RuleConfigMembershipSecurityPolicyInputDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigMembershipSecurityPolicyInputDto)
  preauthorization?: RuleConfigMembershipSecurityPolicyInputDto;
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

  /** 押金规则（需求 4.4.7）。整组可缺省：缺省时由 `payment.depositMode` 派生。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigDepositInputDto)
  deposit?: RuleConfigDepositInputDto;

  /** 预授权规则（需求 4.4.7）。独立于押金，可同时存在。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigPreauthorizationInputDto)
  preauthorization?: RuleConfigPreauthorizationInputDto;

  /** 缺省等同关闭；启用时必须设置风险等级与双重减免上限。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigMembershipSecurityReductionInputDto)
  membershipSecurityReduction?: RuleConfigMembershipSecurityReductionInputDto;

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

  /** 续租规则（需求 4.6.9）。整组可缺省：缺省视为允许续租、不限次数、逾期时强制先付。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigExtensionInputDto)
  extension?: RuleConfigExtensionInputDto;

  /** 提前归还退款规则（需求 4.6.8）。整组可缺省，**缺省即不退租金**，与今天的行为一致。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigEarlyReturnInputDto)
  earlyReturn?: RuleConfigEarlyReturnInputDto;

  /** 税规则。整组可缺省，**缺省即不计税**，历史订单的复算结果不变。 */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RuleConfigTaxInputDto)
  tax?: RuleConfigTaxInputDto;
}

export class SaveRentalRuleVersionDto implements SaveRentalRuleVersionRequest {
  @IsObject()
  @ValidateNested()
  @Type(() => RentalRuleConfigInputDto)
  config!: RentalRuleConfigInputDto;

  @IsString()
  @IsNotEmpty()
  changeReason!: string;

  /** 省略即新建草稿。传已发布版本的 id 会被拒——已发布版本不可修改（需求 4.6.1）。 */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  versionId?: string;
}

/** 发布或安排生效（需求 4.6.14：必须填写原因）。 */
export class PublishRentalRuleVersionDto implements PublishRentalRuleVersionRequest {
  /** 省略即立即生效；给未来时点即安排生效（待生效）。 */
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "发布原因不能为空白" })
  // 落库为 rental_rule_version_audits.reason（VARCHAR(500)），同上限长以免 500。
  @MaxLength(500, { message: "发布原因不能超过 500 字" })
  reason!: string;
}

export class RestoreRentalRuleVersionDto implements RestoreRentalRuleVersionRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "恢复原因不能为空白" })
  // 同时落库为 rental_rule_versions.restoreReason（VARCHAR(191)），取更短的上限。
  @MaxLength(191, { message: "恢复原因不能超过 191 字" })
  reason!: string;
}

export class VoidRentalRuleVersionDto implements VoidRentalRuleVersionRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "作废原因不能为空白" })
  // 同时落库为 rental_rule_versions.voidReason（VARCHAR(191)），取更短的上限。
  @MaxLength(191, { message: "作废原因不能超过 191 字" })
  reason!: string;
}

/* ---------- 营业日历 ---------- */

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

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,64}$/, { message: "一次性价格引用只能是 1-64 位字母数字与 . _ : -" })
  pricingOverrideRef?: string;

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

/** DATE_KEY：范围端点的日期键格式校验；有效性（如 2026-02-30）由服务层 isCalendarDateKey 兜底。 */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 范围覆盖可设置的字段（需求 4.5.9：只修改明确选择的字段，未选择保持原值）。 */
export class RentalCalendarRangeFieldsDto implements RentalCalendarRangeFields {
  @IsOptional()
  @IsIn(DAY_TYPES)
  dayType?: (typeof DAY_TYPES)[number];

  @IsOptional()
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "节日或调休名称不能为空白" })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,64}$/, { message: "一次性价格引用只能是 1-64 位字母数字与 . _ : -" })
  pricingOverrideRef?: string;

  @IsOptional()
  @IsIn(BUSINESS_STATUSES)
  businessStatus?: (typeof BUSINESS_STATUSES)[number];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RentalBusinessHoursInputDto)
  hours?: RentalBusinessHoursInputDto;
}

/** 范围覆盖预览（需求 4.5.9：提交前展示冲突日期、当前值与将替换的字段）。 */
export class PreviewRentalCalendarRangeOverrideDto implements PreviewRentalCalendarRangeOverrideRequest {
  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "起始日期必须是 YYYY-MM-DD" })
  startDate!: string;

  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "结束日期必须是 YYYY-MM-DD" })
  endDate!: string;

  @IsOptional()
  @IsISO8601()
  startDateTime?: string;

  @IsOptional()
  @IsISO8601()
  endDateTime?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => RentalCalendarRangeFieldsDto)
  fields!: RentalCalendarRangeFieldsDto;
}

/** 应用范围覆盖：全部成功或全部失败，一次 revision，既有覆盖须显式确认。 */
export class ApplyRentalCalendarRangeOverrideDto implements ApplyRentalCalendarRangeOverrideRequest {
  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "起始日期必须是 YYYY-MM-DD" })
  startDate!: string;

  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "结束日期必须是 YYYY-MM-DD" })
  endDate!: string;

  @IsOptional()
  @IsISO8601()
  startDateTime?: string;

  @IsOptional()
  @IsISO8601()
  endDateTime?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => RentalCalendarRangeFieldsDto)
  fields!: RentalCalendarRangeFieldsDto;

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "调整原因不能为空白" })
  @MaxLength(191, { message: "调整原因不能超过 191 字" })
  overrideReason!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,64}$/, { message: "批次标识只能是 1-64 位字母数字与 . _ : -" })
  batchId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  @IsOptional()
  @IsBoolean()
  overrideConfirmed?: boolean;
}

/** 范围移除预览（需求 4.5.9：移除前展示恢复后的取值与来源）。 */
export class PreviewRentalCalendarRangeRemoveDto implements PreviewRentalCalendarRangeRemoveRequest {
  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "起始日期必须是 YYYY-MM-DD" })
  startDate!: string;

  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "结束日期必须是 YYYY-MM-DD" })
  endDate!: string;

  @IsOptional()
  @IsISO8601()
  startDateTime?: string;

  @IsOptional()
  @IsISO8601()
  endDateTime?: string;
}

/** PRICE-03：创建调价计划（差异 + 定时/立即 + 原因）。 */
export class RentalPriceAdjustmentChangeInputDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pricingGroupId?: string;

  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsIn(RENTAL_PRICING_UNIT_CODES)
  unit!: (typeof RENTAL_PRICING_UNIT_CODES)[number];

  @IsIn(["set_base", "percent", "fixed"])
  op!: "set_base" | "percent" | "fixed";

  @IsNumber()
  value!: number;
}

export class CreateRentalPriceAdjustmentDto implements CreateRentalPriceAdjustmentRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "调价计划编码不能为空白" })
  @MaxLength(191)
  code!: string;

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "调价计划名称不能为空白" })
  @MaxLength(191)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RentalPriceAdjustmentChangeInputDto)
  changes!: RentalPriceAdjustmentChangeInputDto[];

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "变更原因不能为空白" })
  @MaxLength(191)
  changeReason!: string;
}

export class CancelRentalPriceAdjustmentDto implements CancelRentalPriceAdjustmentRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "取消原因不能为空白" })
  reason!: string;
}

export class RestoreRentalPriceVersionDto implements RestoreRentalPriceVersionRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "恢复原因不能为空白" })
  @MaxLength(191)
  reason!: string;
}

/** 应用范围移除：只移除范围内带人工覆盖的日期，其余保持不变。 */
export class ApplyRentalCalendarRangeRemoveDto implements ApplyRentalCalendarRangeRemoveRequest {
  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "起始日期必须是 YYYY-MM-DD" })
  startDate!: string;

  @IsString()
  @Matches(DATE_KEY_PATTERN, { message: "结束日期必须是 YYYY-MM-DD" })
  endDate!: string;

  @IsOptional()
  @IsISO8601()
  startDateTime?: string;

  @IsOptional()
  @IsISO8601()
  endDateTime?: string;

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "调整原因不能为空白" })
  @MaxLength(191, { message: "调整原因不能超过 191 字" })
  overrideReason!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.:-]{1,64}$/, { message: "批次标识只能是 1-64 位字母数字与 . _ : -" })
  batchId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
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

/** 以某个历史版本的内容生成新草稿（需求 4.5.7 的「恢复旧规则」）。原因必填。 */
export class RestoreRentalCalendarVersionDto implements RestoreRentalCalendarVersionRequest {
  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "恢复原因不能为空白" })
  // 落库为 rental_business_calendars.restoreReason（VARCHAR(191)），同上限长以免 500。
  @MaxLength(191, { message: "恢复原因不能超过 191 字" })
  reason!: string;
}

/* ---------- 公共官方日历来源注册表（平台级，需求 4.5.2/4.5.8） ---------- */

export class SaveOfficialCalendarSourceDto implements SaveOfficialCalendarSourceRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsIn(["CN"])
  region!: "CN";

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "来源名称不能为空白" })
  @MaxLength(191, { message: "来源名称不能超过 191 字" })
  name!: string;

  /** 只接受 HTTPS：这份数据会被所有租户引用，来源不可验证时出错面是全平台。 */
  @IsUrl({ require_tld: false, protocols: ["https"], require_protocol: true })
  @MaxLength(191, { message: "来源地址不能超过 191 字" })
  url!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OfficialCalendarSourceDayInputDto {
  /** 只接受 YYYY-MM-DD：带时间会让同一天出现多个键。 */
  @IsISO8601()
  date!: string;

  @IsIn(["statutory_holiday", "makeup_workday"])
  dayType!: RentalDayType;

  @IsString()
  @Matches(NON_BLANK_PATTERN, { message: "节日或调休名称不能为空白" })
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

export class RegisterOfficialCalendarSourceVersionDto implements RegisterOfficialCalendarSourceVersionRequest {
  @IsInt()
  @Min(2000)
  @Max(2999)
  year!: number;

  @IsISO8601()
  publishedAt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => OfficialCalendarSourceDayInputDto)
  days!: OfficialCalendarSourceDayInputDto[];
}

/** 经营空间引用某个公共来源版本生成/更新本空间年度草稿（需求 4.5.2）。 */
export class ApplyOfficialCalendarSourceDto implements ApplyOfficialCalendarSourceRequest {
  @IsString()
  @IsNotEmpty()
  sourceVersionId!: string;
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

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  @Matches(/^[A-Za-z0-9_.-]+$/u)
  providerTemplateCode?: string;

  /**
   * 变量 schema 的键是模板自定义的变量名，无法静态声明，故只校验是对象。
   * 值的形状（`{ label, required }`）在服务层渲染时校验。
   */
  @IsObject()
  variableSchema!: Record<string, { label: string; required: boolean }>;

  @IsIn(ENABLE_STATUSES)
  status!: (typeof ENABLE_STATUSES)[number];
}
