import type {
  RentalInventoryMode,
  RentalLocationType,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
  SaveRentalItemGroupRequest,
  SaveRentalPricingGroupRequest,
  RentalPricingGroupInitialRate,
  RentalPricingUnit,
  AssignRentalWorkOrderRequest,
  CancelRentalWorkOrderRequest,
  CreateRentalWorkOrderRequest,
  ReviewRentalWorkOrderRequest,
  SubmitRentalWorkOrderRequest
} from "@store-rental/shared";
import { RENTAL_PRICING_UNIT_CODES, RENTAL_WORK_ORDER_TYPES } from "@store-rental/shared";
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
  IsNumber,
  MaxLength,
  ValidateNested
} from "class-validator";

/**
 * Rental Core 的请求 DTO。
 *
 * 为什么必须是 class 而不能继续用 shared 的 interface：`main.ts` 注册了全局
 * `ValidationPipe`，但它只在能拿到 metatype 时工作。interface 在运行时被擦除，
 * 管道对它整体跳过——于是 129 个端点实际上**没有任何入参校验**，
 * 缺必填字段会一路走到 Prisma 才炸，表现为 500 而不是 400。
 *
 * 每个 DTO 都 `implements` 对应的共享请求类型：共享契约新增必填字段时，
 * 这里会立刻编译失败，而不是悄悄少校验一个字段。可选字段 `implements` 管不住，
 * 由 `scripts/validate-dto-coverage.cjs` 静态兜住（`whitelist: true` 会剥离
 * 未声明字段，漏一个就是静默丢数据）。
 *
 * 关于 `@IsIn` 的字面量：刻意写死取值而不是只 `@IsString()`。
 * 状态、能力、结算方式这些字段会直接进数据库枚举列或参与业务判断，
 * 放任意字符串进来等于把校验推迟到更深的地方。
 */

const OPERATOR_TYPES = ["self_operated", "partner"] as const;
const SETTLEMENT_MODES = ["self", "monthly", "per_order"] as const;
const ENABLE_STATUSES = ["enabled", "disabled"] as const;
const LOCATION_CAPABILITIES = ["pickup", "return", "storage", "delivery"] as const;
const LOCATION_TYPES = ["store", "warehouse", "pickup_point", "delivery_point", "parking", "project_site"] as const;
const INVENTORY_MODES = ["serialized", "quantity", "bundle"] as const;

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

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(LOCATION_TYPES)
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
  preAuthAmount?: number;
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
