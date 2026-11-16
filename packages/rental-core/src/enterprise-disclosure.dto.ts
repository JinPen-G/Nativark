/** 原企业租赁告知的同一运行时DTO。只验证原版本/确认字段，企业授权和冻结依据由所属服务核验。 */
import type { EnterpriseDisclosure } from "./enterprise-booking";
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from "class-validator";

export class EnterpriseDisclosureDto implements EnterpriseDisclosure {
  @IsString() @IsNotEmpty() @MaxLength(191) noticeVersion!: string;
  @IsBoolean() acknowledged!: boolean;
}
