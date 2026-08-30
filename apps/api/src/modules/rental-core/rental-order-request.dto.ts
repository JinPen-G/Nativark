import {
  RENTAL_CAPABILITY_CODES,
  RENTAL_PRICING_UNIT_CODES,
  RentalAssetStatus,
  RentalCategoryCode,
  type CancelRentalOrderRequest,
  type CreateRentalInspectionRequest,
  type CreateRentalOrderRequest,
  type GrantRentalRewardRequest,
  type PartialReturnRentalOrderRequest,
  type RentalAvailabilityRequest,
  type RentalCapability,
  type RentalFulfillmentMode,
  type RentalPricingUnit,
  type RentalQuoteRequest,
  type SaveRentalAssetRequest,
  type SaveRentalCouponTemplateRequest,
  type SaveRentalStockBalanceRequest,
  type SaveTenantRentalProfileRequest,
  type SendRentalNotificationRequest,
  type SubstituteRentalBundleComponentRequest
} from "@store-rental/shared";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested
} from "class-validator";

/**
 * Rental Core 订单、报价、资产与业务动作的请求 DTO。第二批。
 *
 * 与 `rental-core-request.dto.ts` 同一套约定，理由见那份文件的顶部注释：
 * `@Body()` 标注 interface 时全局 `ValidationPipe` 拿不到 metatype，整体跳过校验。
 *
 * 三点刻意的选择：
 *
 * 1. 时间字段用 `@IsISO8601()` 而不是 `@IsString()`。这些值会直接 `new Date(...)`
 *    参与可用量计算与档期判断；非法日期会变成 `Invalid Date` 并静默污染比较结果
 *    （`Invalid Date` 参与任何比较都得 false），比报错更难查。
 *
 * 2. 金额与数量用 `@IsNumber()` + `@Min()`。字符串数字在 JS 里会隐式转换，
 *    `"5" * 2` 得 10 但 `"5" + 2` 得 "52"——一旦流进计价就是错账。
 *
 * 3. 行项目这类嵌套数组必须 `@ValidateNested({ each: true })` + `@Type(...)`。
 *    少了 `@Type`，class-transformer 不会把元素实例化成 DTO 类，内层校验
 *    **静默不执行**：外层看着有校验，实际内层什么都没查。
 */

const CUSTOMER_TYPES = ["personal", "corporate"] as const;
const FULFILLMENT_MODES = [
  "store_pickup_return",
  "partner_pickup_return",
  "warehouse_pickup_return",
  "locker_pickup_return",
  "delivery",
  "onsite_delivery"
] as const;
const REWARD_TRIGGERS = ["registration", "identity_verified", "first_order_completed", "referral"] as const;
const DISCOUNT_TYPES = ["fixed_amount", "percentage"] as const;
const COUPON_TARGETS = ["rental", "fulfillment", "service"] as const;
const TEMPLATE_STATUSES = ["draft", "scheduled", "active", "paused", "ended", "void"] as const;

/* ---------- 嵌套值对象 ---------- */

export class RentalAvailabilityLineInputDto {
  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class CreateRentalOrderLineInputDto {
  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class PartialReturnAllocationInputDto {
  @IsString()
  @IsNotEmpty()
  allocationId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class RentalQuoteLineInputDto {
  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsIn(RENTAL_PRICING_UNIT_CODES)
  pricingUnit?: RentalPricingUnit;

  @IsOptional()
  @IsNumber()
  @Min(0)
  usageQuantity?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class RentalQuoteServiceInputDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsISO8601()
  scheduledStartAt?: string;

  @IsOptional()
  @IsISO8601()
  scheduledEndAt?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  serviceLocationId?: string;
}

export class RentalInspectionExceptionInputDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  chargeAmount?: number;
}

/* ---------- 顶层请求 DTO ---------- */

export class RentalAvailabilityDto implements RentalAvailabilityRequest {
  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  /** 空数组没有业务意义：查可用量必须至少给一个商品组。 */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RentalAvailabilityLineInputDto)
  lines!: RentalAvailabilityLineInputDto[];
}

export class SubstituteRentalBundleComponentDto implements SubstituteRentalBundleComponentRequest {
  @IsString()
  @IsNotEmpty()
  orderLineId!: string;

  @IsString()
  @IsNotEmpty()
  fromItemGroupId!: string;

  @IsString()
  @IsNotEmpty()
  toItemGroupId!: string;
}

export class PartialReturnRentalOrderDto implements PartialReturnRentalOrderRequest {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PartialReturnAllocationInputDto)
  items!: PartialReturnAllocationInputDto[];
}

/**
 * CAM-01A：对能力风险提示的例外确认项。原因必填——空确认没有追溯价值，
 * 且会让「已确认带风险」与「未确认」在审计里无法区分。
 */
export class CapabilityExceptionInputDto {
  @IsIn(RENTAL_CAPABILITY_CODES)
  capability!: RentalCapability;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  /**
   * 被确认的报价判断记录 id。可选：缺省时服务端按「能力 + 风险代码」在报价判断里回查。
   * 传了就必须命中——指向不存在的判断不构成确认。
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  decisionId?: string;

  // confirmedBy / confirmedWithPermission / confirmedAt **刻意不在 DTO 里**：
  // 它们由控制器按鉴权上下文补齐。放进 DTO 就等于允许客户端自报确认人与权限。
}

/**
 * CUSTOMER-01C：订单主体选择。四个字段都可省略——
 * 省略的角色由服务层回落为下单客户本人，因此本 DTO 是纯附加，不改变既有调用方行为。
 */
export class CreateRentalOrderSubjectsInputDto {
  @IsOptional() @IsString() contractSubjectCustomerId?: string;
  @IsOptional() @IsString() payerSubjectCustomerId?: string;
  @IsOptional() @IsString() userSubjectCustomerId?: string;
  @IsOptional() @IsString() agentId?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() invoiceProfileId?: string;
}

export class CreateRentalOrderDto implements CreateRentalOrderRequest {
  @IsString()
  @IsNotEmpty()
  quoteId!: string;

  @IsIn(CUSTOMER_TYPES)
  customerType!: (typeof CUSTOMER_TYPES)[number];

  @IsOptional()
  @IsString()
  customerId?: string;

  /**
   * CUSTOMER-01C：订单四类主体。省略即回落为「三个主体都是下单客户本人」。
   *
   * 嵌套对象必须 `@ValidateNested` + `@Type`，否则 whitelist 会把整个对象剥掉，
   * 表现为「传了主体但订单里没有」——静默丢失比报错更难排查。
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateRentalOrderSubjectsInputDto)
  subjects?: CreateRentalOrderSubjectsInputDto;

  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsBoolean()
  qualificationApproved?: boolean;

  @IsOptional()
  @IsISO8601()
  qualificationValidTo?: string;

  @IsIn(FULFILLMENT_MODES)
  fulfillmentMode!: RentalFulfillmentMode;

  @IsString()
  @IsNotEmpty()
  fulfillmentLocationId!: string;

  @IsOptional()
  @IsString()
  returnLocationId?: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateRentalOrderLineInputDto)
  lines!: CreateRentalOrderLineInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapabilityExceptionInputDto)
  capabilityExceptions?: CapabilityExceptionInputDto[];

  @IsOptional()
  @IsString()
  operator?: string;
}

export class CancelRentalOrderDto implements CancelRentalOrderRequest {
  /** 取消原因必填：它会写进订单事实并用于取消费判定，空字符串没有追溯价值。 */
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsBoolean()
  weatherException?: boolean;
}

export class CreateRentalInspectionDto implements CreateRentalInspectionRequest {
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  /** 检查结果的键由模板字段决定，无法在此静态声明，故只校验是对象。 */
  @IsObject()
  results!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalInspectionExceptionInputDto)
  exceptions?: RentalInspectionExceptionInputDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];

  @IsOptional()
  @IsString()
  operator?: string;
}

export class RentalQuoteDto implements RentalQuoteRequest {
  @IsIn(CUSTOMER_TYPES)
  customerType!: (typeof CUSTOMER_TYPES)[number];

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsIn(FULFILLMENT_MODES)
  fulfillmentMode!: RentalFulfillmentMode;

  @IsString()
  @IsNotEmpty()
  fulfillmentLocationId!: string;

  @IsOptional()
  @IsString()
  returnLocationId?: string;

  @IsISO8601()
  startAt!: string;

  @IsISO8601()
  endAt!: string;

  @IsOptional()
  @IsString()
  pricingPlanId?: string;

  @IsOptional()
  @IsString()
  discountPlanId?: string;

  @IsOptional()
  @IsString()
  customerCouponId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RentalQuoteLineInputDto)
  lines!: RentalQuoteLineInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalQuoteServiceInputDto)
  services?: RentalQuoteServiceInputDto[];
}

export class SaveRentalAssetDto implements SaveRentalAssetRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsString()
  @IsNotEmpty()
  assetNo!: string;

  @IsOptional()
  @IsString()
  serialNo?: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsOptional()
  @IsEnum(RentalAssetStatus)
  status?: RentalAssetStatus;

  /** 品类动态字段（序列号、车牌、VIN 等）由品类 schema 在服务层逐项校验。 */
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  operator?: string;
}

export class SaveRentalStockBalanceDto implements SaveRentalStockBalanceRequest {
  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  /** 允许 0（清空库存是合法操作），但不允许负数。 */
  @IsNumber()
  @Min(0)
  onHandQuantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maintenanceQuantity?: number;

  @IsOptional()
  @IsString()
  operator?: string;
}

export class SaveTenantRentalProfileDto implements SaveTenantRentalProfileRequest {
  @IsEnum(RentalCategoryCode)
  categoryCode!: RentalCategoryCode;

  @IsOptional()
  @IsArray()
  @IsIn(RENTAL_CAPABILITY_CODES, { each: true })
  capabilities?: RentalCapability[];

  /** 术语表是品类文案覆盖，键集由品类定义决定，只校验是对象。 */
  @IsOptional()
  @IsObject()
  terminology?: SaveTenantRentalProfileRequest["terminology"];

  @IsOptional()
  @IsString()
  operator?: string;
}

export class SaveRentalCouponTemplateDto implements SaveRentalCouponTemplateRequest {
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

  @IsIn(DISCOUNT_TYPES)
  discountType!: (typeof DISCOUNT_TYPES)[number];

  /** 折扣值参与金额计算，必须是数字且非负。 */
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

  @IsOptional()
  @IsIn(COUPON_TARGETS)
  appliesTo?: (typeof COUPON_TARGETS)[number];

  @IsOptional()
  @IsBoolean()
  stackableWithDiscountPlans?: boolean;

  @IsNumber()
  @Min(1)
  totalQuota!: number;

  @IsNumber()
  @Min(1)
  perCustomerLimit!: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  perCustomerUseLimit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalBudget?: number;

  @IsISO8601()
  effectiveFrom!: string;

  @IsISO8601()
  effectiveTo!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableItemGroupIds?: string[];

  @IsOptional()
  @IsIn(TEMPLATE_STATUSES)
  status?: (typeof TEMPLATE_STATUSES)[number];
}

export class GrantRentalRewardDto implements GrantRentalRewardRequest {
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsIn(REWARD_TRIGGERS)
  triggerType!: (typeof REWARD_TRIGGERS)[number];

  /** 奖励幂等键：缺了它重复请求会重复入账，因此必须非空。 */
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  relatedCustomerId?: string;
}

export class SendRentalNotificationDto implements SendRentalNotificationRequest {
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsString()
  @IsNotEmpty()
  recipient!: string;

  /** 变量键集由模板的 variableSchema 决定，在服务层按模板校验。 */
  @IsObject()
  variables!: Record<string, unknown>;
}
