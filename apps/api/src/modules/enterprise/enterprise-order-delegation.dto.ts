/** Original enterprise delegation references. Identity, source hashes and money come from persisted server facts. */
import { Type } from "class-transformer";
import { IsDefined, IsIn, IsOptional, IsString, Matches, ValidateNested } from "class-validator";
import type { EnterpriseOrderDelegationRequestReference, ExecuteEnterpriseMerchantOrderDelegation, IssueEnterpriseOrderDelegation, RevokeEnterpriseOrderDelegation } from "@rental-os/shared";
import { EnterpriseChangeRequestDto } from "./enterprise-request.dto";

class EnterpriseOrderDelegationRequestReferenceDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._:-]{1,191}$/u) approvalId?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._:-]{1,191}$/u) quoteId?: string;
}
export class IssueEnterpriseOrderDelegationDto extends EnterpriseChangeRequestDto implements IssueEnterpriseOrderDelegation {
  @IsDefined() @ValidateNested() @Type(() => EnterpriseOrderDelegationRequestReferenceDto) requestReference!: EnterpriseOrderDelegationRequestReference;
  @IsIn([true]) confirm!: true;
}
export class RevokeEnterpriseOrderDelegationDto extends EnterpriseChangeRequestDto implements RevokeEnterpriseOrderDelegation {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) delegationKey!: string;
  @IsIn([true]) confirm!: true;
}

export class ExecuteEnterpriseMerchantOrderDelegationDto implements ExecuteEnterpriseMerchantOrderDelegation {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) delegationKey!: string;
  @IsIn([1]) expectedRevision!: 1;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._:-]{1,191}$/u) approvalId?: string;
  @IsIn([true]) confirm!: true;
}
