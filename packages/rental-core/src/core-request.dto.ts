/** Rental商品、地点/经营者、定价组与工单的唯一请求DTO。字段与嵌套校验沿原合同，业务裁定由Core处理。
 * 宿主加载reflect-metadata并保留装饰器编译选项；whitelist要求每个字段具备class-validator元数据。 */
import type {
  RentalInventoryMode,
  RentalLocationType,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
  SaveRentalItemGroupRequest,
  SaveRentalPricingGroupRequest,
  RentalPricingGroupInitialRate,
  RentalPricingGroupSecurityRateOverride,
  UpdateRentalPricingGroupSecurityRatesRequest,
  RentalPricingTier,
  RentalPricingUnit,
  AssignRentalWorkOrderRequest,
  CancelRentalWorkOrderRequest,
  CreateRentalWorkOrderRequest,
  ReviewRentalWorkOrderRequest,
  SubmitRentalWorkOrderRequest
} from "./contracts";
import { RENTAL_LOCATION_TYPES, RENTAL_PRICING_UNIT_CODES, RENTAL_WORK_ORDER_TYPES } from "./contracts";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  Max,
  IsInt,
  IsNumber,
  MaxLength,
  ValidateNested
} from "class-validator";



const OPERATOR_TYPES = ["self_operated", "partner"] as const;
const SETTLEMENT_MODES = ["self", "monthly", "per_order"] as const;
const ENABLE_STATUSES = ["enabled", "disabled"] as const;
const LOCATION_CAPABILITIES = ["pickup", "return", "storage", "delivery"] as const;
const INVENTORY_MODES = ["serialized", "quantity", "consumable", "bundle"] as const;

export class SaveRentalFulfillmentOperatorDto implements SaveRentalFulfillmentOperatorRequest {
  /** 存在即为更新。路径参数版本的处理器会用 `{ ...body, id }` 覆盖它。 */
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

  @IsIn(OPERATOR_TYPES)
  type!: (typeof OPERATOR_TYPES)[number];

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsIn(SETTLEMENT_MODES)
  settlementMode?: (typeof SETTLEMENT_MODES)[number];

  @IsOptional()
  @IsIn(ENABLE_STATUSES)
  status?: (typeof ENABLE_STATUSES)[number];
}

export class SaveRentalFulfillmentLocationDto implements SaveRentalFulfillmentLocationRequest {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  organizationId?: string | null;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(RENTAL_LOCATION_TYPES)
  type!: RentalLocationType;

  @IsOptional()
  @IsString()
  operatorId?: string;

  @IsOptional()
  @IsIn(OPERATOR_TYPES)
  operatorType?: (typeof OPERATOR_TYPES)[number];

  @IsOptional()
  @IsString()
  operatorName?: string;

  @IsOptional()
  @IsString()
  parentLocationId?: string;

  /** 必填且必须是已知能力：地点能力会直接影响报价与履约校验。 */
  @IsArray()
  @IsIn(LOCATION_CAPABILITIES, { each: true })
  capabilities!: Array<(typeof LOCATION_CAPABILITIES)[number]>;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  province?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  businessHours?: string;

  @IsOptional()
  @IsIn(ENABLE_STATUSES)
  status?: (typeof ENABLE_STATUSES)[number];
}

/** 套装组成项。嵌套对象必须显式 `@ValidateNested` + `@Type`，否则内层不校验。 */
export class RentalBundleComponentInputDto {
  @IsString()
  @IsNotEmpty()
  itemGroupId!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsBoolean()
  optional?: boolean;

  @IsOptional()
  @IsString()
  substitutionGroup?: string;
}

export class SaveRentalItemGroupDto implements SaveRentalItemGroupRequest {
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

  @IsIn(INVENTORY_MODES)
  inventoryMode!: RentalInventoryMode;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalBundleComponentInputDto)
  bundleComponents?: RentalBundleComponentInputDto[];

  @IsOptional()
  @IsIn(ENABLE_STATUSES)
  status?: (typeof ENABLE_STATUSES)[number];

  @IsOptional()
  @IsString()
  operator?: string;
}

export class SaveRentalPricingGroupDto implements SaveRentalPricingGroupRequest {
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
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(RENTAL_PRICING_UNIT_CODES)
  defaultPricingUnit?: RentalPricingUnit;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPricingGroupInitialRateInputDto)
  initialRates?: RentalPricingGroupInitialRateInputDto[];

  @IsArray()
  @IsString({ each: true })
  memberItemGroupIds!: string[];

  @IsOptional()
  @IsIn(ENABLE_STATUSES)
  status?: (typeof ENABLE_STATUSES)[number];
}

class RentalPricingGroupInitialRateInputDto implements RentalPricingGroupInitialRate {
  @IsIn(RENTAL_PRICING_UNIT_CODES)
  unit!: RentalPricingUnit;

  @IsNumber()
  @Min(0)
  baseAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositMultiple?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  preAuthAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  preAuthMultiple?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  includedUsage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  excessUsageAmount?: number;

  @IsOptional()
  @IsIn([0, 1, 2])
  usagePrecision?: 0 | 1 | 2;

  @IsOptional()
  @IsIn(["progressive"])
  tierMode?: "progressive";

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPricingGroupTierInputDto)
  tiers?: RentalPricingGroupTierInputDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;
}

class RentalPricingGroupSecurityRateOverrideDto implements RentalPricingGroupSecurityRateOverride {
  @IsIn(RENTAL_PRICING_UNIT_CODES)
  unit!: RentalPricingUnit;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositMultiple?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  preAuthAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  preAuthMultiple?: number;
}

export class UpdateRentalPricingGroupSecurityRatesDto implements UpdateRentalPricingGroupSecurityRatesRequest {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RentalPricingGroupSecurityRateOverrideDto)
  rates!: RentalPricingGroupSecurityRateOverrideDto[];
}

class RentalPricingGroupTierInputDto implements RentalPricingTier {
  @IsInt()
  @Min(1)
  minUnits!: number;

  @IsNumber()
  @Min(0)
  unitAmount!: number;
}

export class CreateRentalWorkOrderDto implements CreateRentalWorkOrderRequest {
  @IsString()
  @IsNotEmpty()
  dispositionId!: string;

  @IsIn(RENTAL_WORK_ORDER_TYPES)
  type!: CreateRentalWorkOrderRequest["type"];

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignRentalWorkOrderDto implements AssignRentalWorkOrderRequest {
  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class SubmitRentalWorkOrderDto implements SubmitRentalWorkOrderRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  result!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}

export class ReviewRentalWorkOrderDto implements ReviewRentalWorkOrderRequest {
  @IsIn(["approved", "rejected"])
  decision!: ReviewRentalWorkOrderRequest["decision"];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class CancelRentalWorkOrderDto implements CancelRentalWorkOrderRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
