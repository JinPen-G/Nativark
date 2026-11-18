/** 公共消息请求校验。邀请可携带空业务范围，非空授权由宿主真实参加者核验。 */
import type {
  AcceptTenantOperatorInvitationRequest,
  CheckTenantOperatorEmailRequest,
  InspectTenantOperatorInvitationRequest,
  InviteTenantOperatorRequest,
  SaveWorkspaceAccessRequest,
  TenantDispatchQuery,
  TenantSupportEmailQuery
} from "@rental-os/platform-contracts/tenant-messaging";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsObject,
  IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested
} from "class-validator";

export class TenantInvitationWorkspaceAccessDto implements SaveWorkspaceAccessRequest {
  @IsString() @IsNotEmpty() workspaceId!: string;
  @IsOptional() @IsString() @IsNotEmpty() roleId?: string;
  @IsOptional() @IsIn(["all", "organization", "store", "own"]) dataScope?: SaveWorkspaceAccessRequest["dataScope"];
  @IsOptional() @IsObject() locationScope?: SaveWorkspaceAccessRequest["locationScope"];
  @IsBoolean() isActive!: boolean;
}

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
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TenantInvitationWorkspaceAccessDto)
  workspaceAccesses!: SaveWorkspaceAccessRequest[];
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
