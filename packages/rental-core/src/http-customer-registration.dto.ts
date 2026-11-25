/** 原后台统一客户注册输入，运行时校验与字段保持；不从输入取得租户或操作人。 */
import type { SaveSharedCustomerRequest } from "./contracts";
import { CUSTOMER_GENDERS, CUSTOMER_SOURCE_CHANNELS } from "./contracts";
import { IsBoolean, IsDateString, IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

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
