import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CLIENT_API_VERSION, type ClientMembershipSessionResponse, type ClientWechatBindRequest, type ClientWechatBindResponse, type ClientWechatPhoneLoginRequest } from "@rental-os/shared";
import { OperationLogService } from "../../common/operation-log.service";
import { SecretBox } from "../../common/secret-box";
import { runWithRequestIdentity } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";
import { CustomerRegistrationService } from "../platform/customer-registration.service";
import { customerRegistrationTransaction } from "../platform/customer-registration.transaction";
import { CustomerOperationsRepository } from "../platform/customer-operations.repository";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { ClientAuthService, type ClientRequestContext } from "./client-auth.service";
import { WechatMiniProgramAdapter } from "./wechat-mini-program.adapter";

/**
 * 微信手机号登录与微信身份绑定（MP-02A）。
 *
 * 不变量：
 * - 绑定粒度是 tenantId + channelId(AppID) + openId；unionId 只记录不参与判定。
 * - 同一手机号在租户内只有一份客户主档/账号/会员；微信登录复用它，绝不建第二份。
 * - openid 已绑定到另一客户，或该客户已绑定另一 openid，一律拒绝，不自动覆盖。
 * - 新客户按租户注册策略创建：人工审核模式下会员 pending_activation，仍可登录浏览但不能交易。
 * - 商户没有启用渠道或未配置 AppSecret 时直接 503，不存在“模拟成功”。
 */
interface ChannelRow {
  id: string;
  tenantId: string;
  appId: string;
  appSecretEncrypted: string | null;
  enabled: boolean;
}

const maskPhone = (value: string) => (value.length <= 4 ? "****" : `${value.slice(0, 3)}****${value.slice(-4)}`);

function normalizePhone(value: string) {
  return value.trim().replace(/[\s-]/gu, "");
}

@Injectable()
export class ClientWechatAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBox,
    private readonly adapter: WechatMiniProgramAdapter,
    private readonly registration: CustomerRegistrationService,
    private readonly customers: SharedCustomerRepository,
    private readonly operations: CustomerOperationsRepository,
    private readonly auth: ClientAuthService,
    @Optional() private readonly operationLog?: OperationLogService
  ) {}

  /** 租户当前可用的小程序渠道：必须已启用且配置了 AppSecret；给了 AppID 则必须一致。 */
  async resolveChannel(tenantId: string, appId?: string): Promise<ChannelRow & { appSecret: string }> {
    const channel = await this.prisma.miniProgramChannel.findFirst({
      where: { tenantId, ...(appId?.trim() ? { appId: appId.trim() } : {}) },
      select: { id: true, tenantId: true, appId: true, appSecretEncrypted: true, enabled: true },
      orderBy: { updatedAt: "desc" }
    });
    if (!channel) throw new ServiceUnavailableException(appId?.trim() ? "小程序未绑定到该商户，请联系商户确认渠道配置" : "商户尚未配置小程序渠道，微信手机号登录暂不可用");
    if (!channel.enabled) throw new ServiceUnavailableException("商户的小程序渠道未启用，微信手机号登录暂不可用");
    if (!channel.appSecretEncrypted) throw new ServiceUnavailableException("商户尚未配置小程序密钥，微信手机号登录暂不可用");
    let appSecret: string;
    try {
      appSecret = this.secretBox.decrypt(channel.appSecretEncrypted).appSecret ?? "";
    } catch {
      throw new ServiceUnavailableException("商户小程序密钥无法读取，请联系商户重新配置");
    }
    if (!appSecret) throw new ServiceUnavailableException("商户尚未配置小程序密钥，微信手机号登录暂不可用");
    return { ...channel, appSecret };
  }

  private async exchange(channel: ChannelRow & { appSecret: string }, loginCode: string) {
    try {
      return await this.adapter.code2Session(channel.appId, channel.appSecret, loginCode);
    } catch (error) {
      throw WechatMiniProgramAdapter.translate(error, "login");
    }
  }

  private async resolvePhone(channel: ChannelRow & { appSecret: string }, phoneCode: string) {
    let info;
    try {
      info = await this.adapter.phoneNumber(channel.appId, channel.appSecret, phoneCode);
    } catch (error) {
      throw WechatMiniProgramAdapter.translate(error, "phone");
    }
    if (info.watermarkAppId && info.watermarkAppId !== channel.appId) {
      throw new UnauthorizedException("手机号授权来自其他小程序，已拒绝");
    }
    const phone = normalizePhone(info.purePhoneNumber || info.phoneNumber);
    if (!/^\+?[0-9]{6,20}$/u.test(phone)) throw new UnauthorizedException("微信返回的手机号无效");
    return phone;
  }

  async phoneLogin(input: ClientWechatPhoneLoginRequest): Promise<ClientMembershipSessionResponse> {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: input.tenantCode.trim(), status: "ACTIVE" }, select: { id: true, code: true } });
    if (!tenant) throw new NotFoundException("租户不存在或未启用");
    const workspaceCode = input.workspaceCode?.trim();
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId: tenant.id, ...(workspaceCode ? { code: workspaceCode } : {}), status: "ACTIVE" },
      select: { id: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    if (!workspace) throw new ForbiddenException("该租户没有可访问的经营空间");
    const channel = await this.resolveChannel(tenant.id, input.appId);
    // 两个一次性凭证都在服务端换取；任何一步失败都不落库。
    const session = await this.exchange(channel, input.loginCode);
    const phone = await this.resolvePhone(channel, input.phoneCode);

    const result = await runWithRequestIdentity({ tenantId: tenant.id, workspaceId: workspace.id }, () => customerRegistrationTransaction(this.prisma, async (tx) => {
      const boundIdentity = await tx.clientWechatIdentity.findFirst({
        where: { tenantId: tenant.id, channelId: channel.id, openId: session.openid },
        include: { customer: { select: { id: true, phone: true, status: true, customerType: true } } }
      });
      let customerId: string;
      let created = false;
      if (boundIdentity) {
        // 已绑定：微信手机号必须与主档手机号一致，否则不自动改绑。
        if (normalizePhone(boundIdentity.customer.phone) !== phone) {
          throw new ConflictException("该微信已绑定其他手机号的账号，请联系商户处理，系统不会自动改绑");
        }
        customerId = boundIdentity.customer.id;
      } else {
        const existing = await tx.customerProfile.findFirst({ where: { tenantId: tenant.id, phone }, select: { id: true, customerType: true, status: true, mergedIntoCustomerId: true } });
        if (existing) {
          if (existing.customerType !== "personal") throw new ConflictException("该手机号属于企业客户，不能用微信手机号登录个人会员");
          if (existing.mergedIntoCustomerId) throw new ConflictException("客户主档已合并，请联系商户");
          if (existing.status !== "active") throw new ForbiddenException("该客户资料已停用，请联系商户");
          const otherIdentity = await tx.clientWechatIdentity.findFirst({ where: { tenantId: tenant.id, channelId: channel.id, customerId: existing.id } });
          if (otherIdentity) throw new ConflictException("该手机号已绑定其他微信，请联系商户处理，系统不会自动改绑");
          if (!(await this.operations.lockCustomerBusinessGate(tenant.id, existing.id, tx))) throw new NotFoundException("客户不存在");
          const membership = await this.customers.findMembership(tenant.id, existing.id, tx);
          if (!membership) throw new ForbiddenException("该客户尚未开通本商户会员，请联系商户");
          if (["exited", "closed"].includes(membership.status)) throw new ForbiddenException("该客户会员关系已退出或关闭，不能登录");
          customerId = existing.id;
        } else {
          const settings = await tx.customerMembershipRegistrationSettings.findUnique({ where: { tenantId: tenant.id } });
          const registered = await this.registration.registerPersonal(tx, {
            tenantId: tenant.id,
            phone,
            name: `手机用户${phone.slice(-4)}`,
            automatic: settings?.registrationMode === "automatic",
            channel: "app",
            requestKey: `wechat:${channel.id}:${session.openid}`,
            sourceWorkspaceId: workspace.id,
            reviewPayload: { consent: input.consent, source: "wechat_mini_program", appId: channel.appId } as unknown as Prisma.InputJsonValue,
            reuseReview: "open",
            selfService: true
          });
          customerId = registered.customer.id;
          created = true;
        }
        const account = await this.customers.ensureLoginAccount({
          tenantId: tenant.id, customerId, loginPhone: phone, loginPhoneMasked: maskPhone(phone),
          lastReason: "微信手机号登录开通登录账号", lastOperator: `client:${customerId}`
        }, tx);
        if (account.status !== "active") throw new ForbiddenException("该客户账号已停用，请联系商户");
      }
      const identity = boundIdentity
        ? await tx.clientWechatIdentity.update({ where: { id: boundIdentity.id }, data: { lastUsedAt: new Date(), ...(session.unionid ? { unionId: session.unionid } : {}) } })
        : await tx.clientWechatIdentity.create({ data: { tenantId: tenant.id, channelId: channel.id, customerId, openId: session.openid, unionId: session.unionid ?? null, appId: channel.appId, lastUsedAt: new Date() } });
      return { customerId, identityId: identity.id, created };
    }));

    await this.operationLog?.record({
      tenantId: tenant.id,
      action: result.created ? "client.wechat.register" : "client.wechat.login",
      targetType: "customer",
      targetId: result.customerId,
      operator: `client:${result.customerId}`,
      detail: result.created ? "微信手机号首次登录并创建客户" : "微信手机号登录",
      metadata: { appId: channel.appId, workspaceId: workspace.id, clientId: input.clientId ?? null }
    });
    return this.auth.issueSession(tenant.id, result.customerId, workspace.id, undefined, result.identityId);
  }

  /** 已登录客户绑定当前微信身份；用于短信/密码登录后在小程序内支付。 */
  async bind(context: ClientRequestContext, input: ClientWechatBindRequest): Promise<ClientWechatBindResponse> {
    if (context.customerType !== "personal") throw new ForbiddenException("企业账号不能绑定微信身份");
    const channel = await this.resolveChannel(context.tenantId, input.appId);
    let session: Awaited<ReturnType<ClientWechatAuthService["exchange"]>>;
    try {
      session = await this.exchange(channel, input.loginCode);
    } catch (error) {
      // 调用方已经登录：微信凭证无效不是会话失效，不能回 401（客户端会据此刷新会话、重放已消费的 code 并登出）。
      if (error instanceof UnauthorizedException) throw new BadRequestException(error.message);
      throw error;
    }
    const identity = await this.prisma.$transaction(async (tx) => {
      const byOpenId = await tx.clientWechatIdentity.findFirst({ where: { tenantId: context.tenantId, channelId: channel.id, openId: session.openid } });
      if (byOpenId && byOpenId.customerId !== context.customerId) throw new ConflictException("该微信已绑定其他账号，请联系商户处理");
      const byCustomer = await tx.clientWechatIdentity.findFirst({ where: { tenantId: context.tenantId, channelId: channel.id, customerId: context.customerId } });
      if (byCustomer && byCustomer.openId !== session.openid) throw new ConflictException("当前账号已绑定其他微信，请联系商户处理");
      const row = byOpenId ?? byCustomer;
      const saved = row
        ? await tx.clientWechatIdentity.update({ where: { id: row.id }, data: { lastUsedAt: new Date(), ...(session.unionid ? { unionId: session.unionid } : {}) } })
        : await tx.clientWechatIdentity.create({ data: { tenantId: context.tenantId, channelId: channel.id, customerId: context.customerId, openId: session.openid, unionId: session.unionid ?? null, appId: channel.appId, lastUsedAt: new Date() } });
      // 当前会话立刻带上微信身份，支付不必重新登录。
      await tx.clientAuthSession.updateMany({ where: { id: context.sessionId, tenantId: context.tenantId, customerId: context.customerId, revokedAt: null }, data: { wechatIdentityId: saved.id } });
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.operationLog?.record({ tenantId: context.tenantId, action: "client.wechat.bind", targetType: "customer", targetId: context.customerId, operator: `client:${context.customerId}`, detail: "绑定微信身份", metadata: { appId: channel.appId } });
    return { apiVersion: CLIENT_API_VERSION, bound: true, appId: identity.appId, boundAt: identity.boundAt.toISOString() };
  }

  /**
   * 小程序支付需要的可信微信身份：优先会话绑定的身份，其次本人在本租户已绑定的身份（渠道须仍启用）。
   * 没有则返回 undefined，由调用方引导先绑定；绝不接受客户端自报的 openid。
   */
  async identityForSession(context: ClientRequestContext): Promise<{ openId: string; appId: string; channelId: string } | undefined> {
    const where = context.wechatIdentityId
      ? { tenantId: context.tenantId, id: context.wechatIdentityId, customerId: context.customerId }
      : { tenantId: context.tenantId, customerId: context.customerId };
    const identity = await this.prisma.clientWechatIdentity.findFirst({
      where: { ...where, channel: { enabled: true } },
      select: { openId: true, appId: true, channelId: true },
      orderBy: { lastUsedAt: "desc" }
    });
    return identity ?? undefined;
  }

  /** 供其他服务判断“商户是否开通了微信渠道”而不暴露密钥。 */
  async channelReady(tenantId: string): Promise<boolean> {
    const channel = await this.prisma.miniProgramChannel.findFirst({ where: { tenantId, enabled: true }, select: { appSecretEncrypted: true } });
    return Boolean(channel?.appSecretEncrypted);
  }

  static isHttpException(error: unknown): error is HttpException {
    return error instanceof HttpException;
  }
}
