import type { CreateBusinessWorkspaceRequest, SaveSharedCustomerRequest, SaveWorkspaceMemberRequest, UpdateBusinessWorkspaceRequest } from "@rental-os/shared";
import { BUSINESS_WORKSPACE_RUN_MODES, CUSTOMER_GENDERS, CUSTOMER_SOURCE_CHANNELS, RENTAL_CATEGORY_CODE_PATTERN } from "@rental-os/shared";
import { IsBoolean, IsDateString, IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const WORKSPACE_STATUSES = ["active", "frozen", "disabled"] as const;
const DATA_SCOPES = ["all", "organization", "store", "own"] as const;
// 运行模式取值域与共享契约同源，避免两处枚举漂移。
const RUN_MODES = BUSINESS_WORKSPACE_RUN_MODES;

export class CreateBusinessWorkspaceDto implements CreateBusinessWorkspaceRequest {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @Matches(RENTAL_CATEGORY_CODE_PATTERN) categoryCode!: CreateBusinessWorkspaceRequest["categoryCode"];
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) categoryVersionId?: string;
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
  @IsOptional() @IsObject() locationScope?: SaveWorkspaceMemberRequest["locationScope"];
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class SaveSharedCustomerDto implements SaveSharedCustomerRequest {
  @IsIn(["personal", "corporate"]) customerType!: SaveSharedCustomerRequest["customerType"];
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() phone!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @IsNotEmpty() identityNo?: string;
  @IsOptional() @IsIn(CUSTOMER_GENDERS) gender?: SaveSharedCustomerRequest["gender"];
  @IsOptional() @IsDateString() birthday?: string;
  @IsOptional() @IsIn(CUSTOMER_SOURCE_CHANNELS) sourceChannel?: SaveSharedCustomerRequest["sourceChannel"];
  @IsOptional() @IsString() @MaxLength(64) region?: string;
  @IsOptional() @IsObject() qualifications?: Record<string, unknown>;
  @IsOptional() @IsString() @IsNotEmpty() corporateName?: string;
  @IsOptional() @IsString() @MaxLength(80) unifiedSocialCreditCode?: string;
  @IsOptional() @IsString() @MaxLength(500) registeredAddress?: string;
  @IsOptional() @IsString() @MaxLength(120) legalRepName?: string;
  @IsOptional() @IsString() @MaxLength(40) legalRepPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) industry?: string;
  @IsOptional() @IsIn(["1-10", "11-50", "51-200", "200+"]) scale?: SaveSharedCustomerRequest["scale"];
  @IsOptional() @IsBoolean() clearEmail?: boolean;
  @IsOptional() @IsString() @IsNotEmpty() corporateTaxNo?: string;
}
