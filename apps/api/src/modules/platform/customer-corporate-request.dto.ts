import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min
} from "class-validator";
import type {
  RecordCustomerCorporateCreditPaymentRequest,
  ReverseCustomerCorporateCreditPaymentRequest,
  RecordCustomerCorporateCreditMaturityRequest,
  SaveCustomerContractRequest,
  SaveCustomerCreditRequest,
  SaveCustomerInvoiceProfileRequest
} from "@rental-os/shared";

/**
 * CUSTOMER-01C 的请求 DTO。
 *
 * 都不声明 `customerId`：它走路径参数。请求体与路径同时给会产生「改谁的资料」的歧义，
 * 而全局 whitelist 会剥离未声明字段，因此客户端塞进来也不会生效。
 */
export class SaveCustomerInvoiceProfileDto implements SaveCustomerInvoiceProfileRequest {
  @IsOptional()
  @IsString()
  id?: string;

  @Type(() => Number) @IsOptional() @IsInt() @Min(1) expectedRevision?: number;

  @IsIn(["vat_special", "vat_normal"])
  invoiceType!: "vat_special" | "vat_normal";

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  taxNo!: string;

  @IsOptional() @IsString() @MaxLength(300) registeredAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  /** 明文只用于计算掩码，服务层不落库原值。 */
  @IsOptional() @IsString() @MaxLength(64) bankAccount?: string;
  @IsOptional() @IsBoolean() clearBankAccount?: boolean;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsBoolean() clearContactPhone?: boolean;
  @IsOptional() @IsString() @MaxLength(200) receiveEmail?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsIn(["active", "disabled"]) status?: "active" | "disabled";
}

export class SaveCustomerContractDto implements SaveCustomerContractRequest {
  @IsOptional() @IsString() id?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) expectedRevision?: number;

  @IsString() @IsNotEmpty() @MaxLength(120) contractNo!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;

  @IsOptional() @IsISO8601() signedAt?: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;

  @IsOptional() @IsIn(["draft", "active", "expired", "terminated"]) status?: "draft" | "active" | "expired" | "terminated";
  @IsOptional() @IsString() @MaxLength(300) fileRef?: string;
  /** 终止合同时必填，由服务层校验——DTO 无法表达「status 为 terminated 时才必填」。 */
  @IsOptional() @IsString() @MaxLength(500) terminatedReason?: string;
}

export class SaveCustomerCreditDto implements SaveCustomerCreditRequest {
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  settlementTermDays!: number;

  @IsOptional() @IsIn(["monthly", "semi_monthly", "per_order"]) billingCycle?: "monthly" | "semi_monthly" | "per_order";
  @IsOptional() @IsIn(["active", "suspended", "revoked"]) status?: "active" | "suspended" | "revoked";
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class RecordCustomerCorporateCreditMaturityDto implements RecordCustomerCorporateCreditMaturityRequest {
  @IsString() @IsNotEmpty() @MaxLength(191) ledgerId!: string;
  @IsISO8601() dueAt!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) basisRef!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) idempotencyKey!: string;
}

export class ReverseCustomerCorporateCreditPaymentDto implements ReverseCustomerCorporateCreditPaymentRequest {
  @IsString() @IsNotEmpty() @MaxLength(191) basisRef!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) idempotencyKey!: string;
}

export class RecordCustomerCorporateCreditPaymentDto implements RecordCustomerCorporateCreditPaymentRequest {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional() @IsIn(["CNY"]) currency?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) idempotencyKey!: string;
}
