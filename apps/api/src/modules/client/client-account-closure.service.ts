import { ConflictException, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { CLIENT_API_VERSION, type ClientAccountClosurePreview, type ClientAccountClosureRequest, type ClientAccountClosureResponse } from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
import { CustomerMergeService } from "../platform/customer-merge.service";
import { CustomerOperationsService } from "../platform/customer-operations.service";
import { ClientAuthService, type ClientRequestContext } from "./client-auth.service";

/**
 * 本人在线注销（MP-02B，需求 §5.3/§12.3）。
 *
 * 顺序：预检（全租户在途订单、未结资金、押金/预授权、退款、风险、企业授信）→ 短信再次核验本人 →
 * 关闭租户会员 → 关闭登录账号 → 撤销全部会话。
 * 复用运营端同一条注销门禁（状态机 + 闭包检查在客户锁内执行），客户端不能绕过任何阻断项；
 * 系统无法自动核对的项必须由客户显式确认，确认文本随原因写入审计。
 */
@Injectable()
export class ClientAccountClosureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: ClientAuthService,
    private readonly operations: CustomerOperationsService,
    private readonly closability: CustomerMergeService,
    @Optional() private readonly operationLog?: OperationLogService
  ) {}

  async preview(context: ClientRequestContext): Promise<ClientAccountClosurePreview> {
    if (context.customerType !== "personal") throw new ForbiddenException("企业账号请联系商户办理注销");
    const result = await this.closability.assertClosable(context.tenantId, context.customerId);
    return { apiVersion: CLIENT_API_VERSION, closable: result.closable, blockers: result.blockers, manualConfirmations: result.manualConfirmations };
  }

  async close(context: ClientRequestContext, input: ClientAccountClosureRequest): Promise<ClientAccountClosureResponse> {
    if (context.customerType !== "personal") throw new ForbiddenException("企业账号请联系商户办理注销");
    if (input.acknowledgedManualChecks !== true) throw new ConflictException("请先确认线下退款、押金退还与争议均已处理");
    // 先消费证明：证明必须绑定注销用途与本人手机号；消费后即使后续失败也需重新核验。
    await this.prisma.$transaction((tx) => this.auth.consumeClosureProof(tx, context, input.loginIdentifier, input.verificationToken));
    const operator = `client:${context.customerId}`;
    const reason = `客户自助注销（小程序）${input.reason?.trim() ? `：${input.reason.trim().slice(0, 200)}` : ""}；客户已确认线下退款、押金退还与争议均已处理`;
    // 会员先于账号关闭：会员关闭后新业务立即停止；账号关闭失败时客户仍会被会话校验拒绝，运营可继续处理。
    await this.operations.changeMembershipStatus(context.tenantId, context.customerId, { status: "closed", reason, acknowledgedManualChecks: true }, operator);
    await this.operations.changeAccountStatus(context.tenantId, context.customerId, { status: "closed", reason, acknowledgedManualChecks: true }, operator);
    await this.auth.revokeSessions(context.tenantId, context.customerId);
    const closedAt = new Date().toISOString();
    await this.operationLog?.record({ tenantId: context.tenantId, action: "client.account.close", targetType: "customer", targetId: context.customerId, operator, detail: "客户自助注销", metadata: { sessionId: context.sessionId } });
    return { apiVersion: CLIENT_API_VERSION, closed: true, closedAt };
  }
}
