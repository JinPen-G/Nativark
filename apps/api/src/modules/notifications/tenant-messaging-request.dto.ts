import type { AcceptTenantOperatorInvitationRequest, InspectTenantOperatorInvitationRequest, InviteTenantOperatorRequest,
  SaveWorkspaceAccessRequest, TenantDispatchQuery, TenantSupportEmailQuery, CheckTenantOperatorEmailRequest } from "@rental-os/shared";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { SaveWorkspaceAccessDto } from "../platform/platform-request.dto";

export class TenantDispatchQueryDto implements TenantDispatchQuery {
  @IsOptional() @IsIn(["sms", "email"]) channel?: TenantDispatchQuery["channel"];
  @IsOptional() @IsIn(["queued", "sent", "delivery_pending", "delivered", "delivery_failed", "failed", "delivery_uncertain", "simulated", "simulation_failed"]) status?: TenantDispatchQuery["status"];
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
export class CheckTenantOperatorEmailDto implements CheckTenantOperatorEmailRequest {
  @IsEmail() @MaxLength(191) email!: string;
}
export class InviteTenantOperatorDto implements InviteTenantOperatorRequest {
  @IsEmail() @MaxLength(191) email!: string;
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) organizationId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @IsString({ each: true }) roleIds!: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SaveWorkspaceAccessDto) workspaceAccesses!: SaveWorkspaceAccessRequest[];
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u) idempotencyKey!: string;
}
export class InspectTenantOperatorInvitationDto implements InspectTenantOperatorInvitationRequest {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/u) token!: string;
}
export class AcceptTenantOperatorInvitationDto implements AcceptTenantOperatorInvitationRequest {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/u) token!: string;
  @IsString() @MinLength(1) @MaxLength(100) displayName!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
export class TenantSupportEmailQueryDto implements TenantSupportEmailQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
