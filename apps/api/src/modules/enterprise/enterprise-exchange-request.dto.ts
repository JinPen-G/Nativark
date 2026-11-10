/** Exchange intent carries resource references, never caller prices or fulfillment authority. */
import { Type } from "class-transformer";
import { IsDefined, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import type { ConfirmEnterpriseExchangeExpense, CloseEnterpriseExchangeRequest, EnterpriseExchangeIntent, EnterpriseExchangeChoicesQuery, RequestEnterpriseExchangeApproval, DecideEnterpriseExchangeApproval } from "@rental-os/shared";
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
