import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import type { MergeCustomersRequest } from "@store-rental/shared";

/**
 * CUSTOMER-01D：人工合并请求。
 *
 * 不声明 `tenantId`/`operator`：租户与操作人一律取自会话——
 * 合并不可逆，审计里的责任人绝不能由请求体决定。
 */
export class MergeCustomersDto implements MergeCustomersRequest {
  @IsString()
  @IsNotEmpty()
  sourceCustomerId!: string;

  @IsString()
  @IsNotEmpty()
  targetCustomerId!: string;

  /** 原因必填：合并不可逆，事后必须能解释为什么认定是同一个客户。 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  /** 审批人。需求 4.8.3 要求保存审批人，因此允许显式传入并固化进映射。 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  approver?: string;

  /** 人工对冲突字段的取舍结论，原样固化进合并映射。 */
  @IsOptional()
  @IsObject()
  fieldResolutions?: Record<string, string>;
}
