/** Enterprise exchange requests bind original expense, inspection and approval references.
 * Current customer/merchant authority and the original Core transaction gate execution. */
import { Type } from "class-transformer";
import { IsDefined, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import type { ConfirmEnterpriseExchangeExpense, CloseEnterpriseExchangeRequest, EnterpriseExchangeIntent, EnterpriseExchangeChoicesQuery, RequestEnterpriseExchangeApproval, DecideEnterpriseExchangeApproval, ExecuteApprovedRentalExchangeRequest, ConfirmRentalExchangeInspectionRequest } from "@rental-os/shared";
export class ExecuteEnterpriseApprovedExchangeDto implements ExecuteApprovedRentalExchangeRequest {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) operationKey!: string;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,191}$/u) approvalId!: string;
  @IsInt() @Min(3) expectedApprovalRevision!: number;
  @IsISO8601() expectedOrderUpdatedAt!: string;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,191}$/u) preparationId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) preparationHash!: string;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,191}$/u) consentId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) consentOperationKey!: string;
  @IsString() @Matches(/\S/u) @MaxLength(500) reason!: string;
  @IsIn([true]) confirm!: true;
}
export class ConfirmEnterpriseExchangeInspectionDto implements ConfirmRentalExchangeInspectionRequest {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) operationKey!: string;
  @IsInt() @IsIn([0]) expectedRevision!: 0;
  @IsString() @Matches(/^[A-Za-z0-9._:-]{1,191}$/u) preparationId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) preparationHash!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/u) materialHash!: string;
  @IsISO8601() expectedOrderUpdatedAt!: string;
  @IsIn([true]) confirm!: true;
}
export class ConfirmEnterpriseExchangeExpenseDto implements ConfirmEnterpriseExchangeExpense {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(1) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn([true]) confirm!: true;
}
export class CloseEnterpriseExchangeRequestDto implements CloseEnterpriseExchangeRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @IsIn([0]) expectedRevision!: 0;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn([true]) confirm!: true;
}
export class EnterpriseExchangeChoicesQueryDto implements EnterpriseExchangeChoicesQuery {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) allocationId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) replacementItemGroupId?: string;
}
export class EnterpriseExchangeIntentDto implements EnterpriseExchangeIntent {
  @IsString() @IsNotEmpty() @MaxLength(191) orderLineId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) allocationId!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) replacementItemGroupId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) replacementAssetId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) replacementPricingGroupId?: string;
  @IsIn(["original_order_price", "replacement_current_price"]) priceBasis!: EnterpriseExchangeIntent["priceBasis"];
}
export class RequestEnterpriseExchangeApprovalDto implements RequestEnterpriseExchangeApproval {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @IsIn([0]) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) orderId!: string;
  @IsISO8601() expectedOrderUpdatedAt!: string;
  @IsDefined() @ValidateNested() @Type(() => EnterpriseExchangeIntentDto) exchange!: EnterpriseExchangeIntentDto;
}
export class DecideEnterpriseExchangeApprovalDto implements DecideEnterpriseExchangeApproval {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn(["approve", "reject", "withdraw"]) decision!: DecideEnterpriseExchangeApproval["decision"];
}
