import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import {
  CUSTOMER_ACCOUNT_STATUSES,
  CUSTOMER_MEMBERSHIP_STATUSES,
  type ChangeCustomerAccountStatusRequest,
  type ChangeCustomerMembershipStatusRequest,
  type CustomerAccountStatus,
  type CustomerMembershipStatus
} from "@store-rental/shared";

/**
 * CUSTOMER-01B 的请求 DTO。
 *
 * 两个 DTO 都**不声明** `customerId` / `workspaceId` / `operator`：
 *   * customerId 走路径参数，避免请求体与路径不一致时产生歧义；
 *   * workspaceId 一律取自会话——接受请求体传入等于允许改到自己无权进入的空间；
 *   * operator 取自会话，否则审计里的责任人可被伪造。
 * 全局 whitelist 会剥离未声明字段，因此客户端塞进来的这些键不会生效。
 */
export class ChangeCustomerAccountStatusDto implements ChangeCustomerAccountStatusRequest {
  @IsIn(CUSTOMER_ACCOUNT_STATUSES as unknown as string[])
  status!: CustomerAccountStatus;

  /** 原因必填：账号停用会阻断该客户在全部空间的登录，事后必须能解释。 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
  /**
   * CUSTOMER-01D：注销时对「系统无数据源、只能人工核对项」的显式确认。
   * 必须在 DTO 里声明：whitelist:true 会剥离未声明字段，漏声明会让注销永远拿不到确认、恒被拒绝。
   */
  @IsOptional()
  @IsBoolean()
  acknowledgedManualChecks?: boolean;
}

export class ChangeCustomerMembershipStatusDto implements ChangeCustomerMembershipStatusRequest {
  @IsIn(CUSTOMER_MEMBERSHIP_STATUSES as unknown as string[])
  status!: CustomerMembershipStatus;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  /** 仅在恢复为「正常」时允许调整等级；服务层会忽略其他状态下传入的值。 */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  levelName?: string;
  /**
   * CUSTOMER-01D：注销时对「系统无数据源、只能人工核对项」的显式确认。
   * 必须在 DTO 里声明：whitelist:true 会剥离未声明字段，漏声明会让注销永远拿不到确认、恒被拒绝。
   */
  @IsOptional()
  @IsBoolean()
  acknowledgedManualChecks?: boolean;
}
