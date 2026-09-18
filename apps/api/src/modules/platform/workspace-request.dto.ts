import type { CreateBusinessWorkspaceRequest, SaveSharedCustomerRequest, SaveWorkspaceMemberRequest, UpdateBusinessWorkspaceRequest } from "@rental-os/shared";
import { BUSINESS_WORKSPACE_RUN_MODES } from "@rental-os/shared";
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

const CATEGORIES = ["vehicle", "camera", "camping", "construction"] as const;
const WORKSPACE_STATUSES = ["active", "frozen", "disabled"] as const;
const DATA_SCOPES = ["all", "organization", "store", "own"] as const;
// 运行模式取值域与共享契约同源，避免两处枚举漂移。
const RUN_MODES = BUSINESS_WORKSPACE_RUN_MODES;

export class CreateBusinessWorkspaceDto implements CreateBusinessWorkspaceRequest {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(CATEGORIES) categoryCode!: CreateBusinessWorkspaceRequest["categoryCode"];
  @IsOptional() @IsIn(RUN_MODES) runMode?: CreateBusinessWorkspaceRequest["runMode"];
}
export class UpdateBusinessWorkspaceDto implements UpdateBusinessWorkspaceRequest {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn(WORKSPACE_STATUSES) status?: UpdateBusinessWorkspaceRequest["status"];
  @IsOptional() @IsIn(RUN_MODES) runMode?: UpdateBusinessWorkspaceRequest["runMode"];
}
export class SaveWorkspaceMemberDto implements SaveWorkspaceMemberRequest {
  @IsString() @IsNotEmpty() userId!: string;
  @IsOptional() @IsString() @IsNotEmpty() roleId?: string;
  @IsOptional() @IsIn(DATA_SCOPES) dataScope?: SaveWorkspaceMemberRequest["dataScope"];
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class SaveSharedCustomerDto implements SaveSharedCustomerRequest {
  @IsIn(["personal", "corporate"]) customerType!: SaveSharedCustomerRequest["customerType"];
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() phone!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsBoolean() identityVerified?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() identityNo?: string;
  @IsOptional() @IsObject() qualifications?: Record<string, unknown>;
  @IsOptional() @IsString() @IsNotEmpty() corporateName?: string;
  @IsOptional() @IsString() @IsNotEmpty() corporateTaxNo?: string;
}
