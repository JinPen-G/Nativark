/** Additional-spend requests accept intent only, never a client-supplied price or approval binding. */
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDefined, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";
import type { RequestEnterpriseExtensionApproval, DecideEnterpriseExtensionApproval, SubmitEnterpriseExtensionApproval, CloseEnterpriseExtensionExecution, CloseEnterpriseExtensionRequest } from "@rental-os/shared";
import { ClientQuoteServiceInputDto } from "../client/client-request.dto";

export class EnterpriseExtensionInputDto {
  @IsISO8601() newEndAt!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ClientQuoteServiceInputDto) services?: ClientQuoteServiceInputDto[];
  @IsOptional() @IsString() @MaxLength(500) memo?: string;
}
export class RequestEnterpriseExtensionApprovalDto implements RequestEnterpriseExtensionApproval {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) orderId!: string;
  @IsISO8601() expectedOrderUpdatedAt!: string;
  @IsDefined() @ValidateNested() @Type(() => EnterpriseExtensionInputDto) extension!: EnterpriseExtensionInputDto;
}
export class DecideEnterpriseExtensionApprovalDto implements DecideEnterpriseExtensionApproval {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn(["approve", "reject", "withdraw"]) decision!: DecideEnterpriseExtensionApproval["decision"];
}
export class SubmitEnterpriseExtensionApprovalDto implements SubmitEnterpriseExtensionApproval {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(191) approvalId!: string;
  @IsIn([true]) confirm!: true;
}
export class CloseEnterpriseExtensionRequestDto implements CloseEnterpriseExtensionRequest {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @IsIn([0]) expectedRevision!: 0;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsIn([true]) confirm!: true;
}
export class CloseEnterpriseExtensionExecutionDto implements CloseEnterpriseExtensionExecution {
  @IsString() @IsNotEmpty() @MaxLength(128) operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) originalOperationKey!: string;
  @IsIn([true]) confirm!: true;
}
