import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CLIENT_API_VERSION,
  type ClientMembershipLoginRequest,
  type ClientMembershipQualificationStatus,
  type ClientMembershipSessionResponse,
  type ClientPersonalMembershipRegistrationRequest,
  type ClientPersonalMembershipRegistrationResponse,
  type ClientChallengePurpose,
  type ClientRegistrationChallengeRequest,
  type ClientRegistrationChallengeResponse,
  type ClientSmsLoginRequest,
  type ClientSwitchWorkspaceRequest,
  type ClientWorkspaceSummary,
  type VerifyClientRegistrationChallengeRequest,
  type VerifyClientRegistrationChallengeResponse
} from "@rental-os/shared";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { customerRegistrationTransaction } from "../platform/customer-registration.transaction";
import { CustomerRegistrationService } from "../platform/customer-registration.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { PrismaService } from "../database/prisma.service";
import { hashOpaqueToken, hashPassword, verifyPassword } from "../../common/password";
import { runWithRequestIdentity } from "../../common/request-identity";
import { TenantIntegrationRuntimeService } from "../integrations/tenant-integration.runtime.service";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const CHALLENGE_TTL_SECONDS = 10 * 60;
const CHALLENGE_COOLDOWN_SECONDS = 60;
const MAX_CHALLENGE_ATTEMPTS = 5;
const BLOCKED_MEMBERSHIP_STATUSES = new Set(["exited", "closed"]);

export interface ClientRequestContext {
  tenantId: string;
  tenantCode: string;
  customerId: string;
  customerType: "personal" | "corporate";
  displayName: string;
  phone: string;
  workspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  categoryCode: string;
  membershipStatus: string;
  sessionId: string;
  /** 会话绑定的微信身份（微信手机号登录或绑定后写入）；小程序支付据此取可信 openid。 */
  wechatIdentityId?: string;
}

interface ClientTokenPayload {
  typ: "client";
  sub: string;
  tid: string;
  sid: string;
  wid: string;
  iat: number;
  exp: number;
}

const maskPhone = (value: string) => value.length <= 4 ? "****" : `${value.slice(0, 3)}****${value.slice(-4)}`;
const maskEmail = (value: string) => {
  const [local, domain] = value.split("@");
  if (!domain) return "****";
  return `${local.slice(0, 1)}***@${domain}`;
};
/** 客户端证件号历史上就用 2+2 掩码，与后台的 3+4 不同；保持不变，避免既有主档掩码风格混杂。 */
const maskIdentityNo = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}` : undefined;
};

function normalizeIdentifier(value: string) {
  return value.trim().replace(/[\s-]/g, "");
}

function assertPassword(password: string) {
  if (!password || password.length < 8 || password.length > 128) {
    throw new BadRequestException("密码长度必须为 8-128 位");
  }
  if (!/[A-Za-z]/u.test(password) || !/[0-9]/u.test(password)) {
    throw new BadRequestException("密码必须同时包含字母和数字");
  }
}

function asIso(value: Date | null | undefined) {
  return value?.toISOString();
}

@Injectable()
export class ClientAuthService {
  private readonly customers: SharedCustomerRepository;
  private readonly registration: CustomerRegistrationService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: TenantIntegrationRuntimeService,
    // 既有测试用位置参数 `new ClientAuthService(prisma, integrations)` 构造；
    // 后两个依赖追加在最后且可选，缺失时按同一个 prisma 自建。
    @Optional() customers?: SharedCustomerRepository,
    @Optional() registration?: CustomerRegistrationService
  ) {
    this.customers = customers ?? new SharedCustomerRepository(prisma);
    this.registration = registration ?? new CustomerRegistrationService(prisma, this.customers);
  }

  private secret() {
    const secret = process.env.AUTH_TOKEN_SECRET?.trim();
    if (!secret) throw new ServiceUnavailableException("客户端认证密钥未配置");
    return secret;
  }

  private sign(payload: ClientTokenPayload) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const data = `${header}.${body}`;
    const signature = createHmac("sha256", `${this.secret()}:client`).update(data).digest("base64url");
    return `${data}.${signature}`;
  }

  private parse(token: string): ClientTokenPayload {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) throw new UnauthorizedException("客户端令牌无效");
    const expected = createHmac("sha256", `${this.secret()}:client`).update(`${header}.${body}`).digest("base64url");
    const expectedBytes = Buffer.from(expected);
    const actualBytes = Buffer.from(signature);
    if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) throw new UnauthorizedException("客户端令牌无效");
    let headerPayload: { alg?: string; typ?: string };
    let payload: ClientTokenPayload;
    try {
      headerPayload = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string; typ?: string };
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ClientTokenPayload;
    } catch {
      throw new UnauthorizedException("客户端令牌无效");
    }
    if (
      headerPayload.alg !== "HS256" ||
      headerPayload.typ !== "JWT" ||
      payload.typ !== "client" ||
      typeof payload.sub !== "string" ||
      typeof payload.tid !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.wid !== "string" ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException("客户端令牌已过期或无效");
    }
    return payload;
  }

  private async target(tenantCode: string, workspaceCode?: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { code: tenantCode.trim(), status: "ACTIVE" },
      select: { id: true, code: true }
    });
    if (!tenant) throw new NotFoundException("租户不存在或未启用");
    const code = workspaceCode?.trim();
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId: tenant.id, ...(code ? { code } : {}), status: "ACTIVE" },
      select: { id: true, code: true, name: true, categoryCode: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    if (!workspace) throw new NotFoundException("经营空间不存在或未启用");
    return { tenant, workspace };
  }

  private async workspaceRows(tenantId: string, customerId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const membership = await tx.customerMembership.findUnique({
      where: { tenantId_customerId: { tenantId, customerId } },
      select: { status: true }
    });
    if (!membership || BLOCKED_MEMBERSHIP_STATUSES.has(membership.status)) throw new ForbiddenException("客户尚未获得该租户的访问资格");
    const rows = await tx.businessWorkspace.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { code: true, name: true, categoryCode: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    return rows.map((row): ClientWorkspaceSummary => ({
      workspaceCode: row.code,
      workspaceName: row.name,
      categoryCode: String(row.categoryCode),
      membershipStatus: membership.status,
      isDefault: row.isDefault
    }));
  }

  async issueSession(
    tenantId: string,
    customerId: string,
    workspaceId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    wechatIdentityId?: string | null
  ): Promise<ClientMembershipSessionResponse> {
    const [customer, workspace, workspaces, wechatIdentities] = await Promise.all([
      tx.customerProfile.findFirst({ where: { tenantId, id: customerId }, select: { id: true, customerType: true, name: true, phone: true, status: true } }),
      tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId, status: "ACTIVE" }, select: { id: true, code: true } }),
      this.workspaceRows(tenantId, customerId, tx),
      tx.clientWechatIdentity.count({ where: { tenantId, customerId } })
    ]);
    if (!customer || customer.status !== "active" || !workspace) throw new UnauthorizedException("客户或经营空间不存在");

    const sessionId = randomBytes(16).toString("hex");
    const refreshToken = randomBytes(32).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    await tx.clientAuthSession.create({
      data: {
        id: sessionId,
        tenantId,
        customerId,
        workspaceId,
        refreshTokenHash: hashOpaqueToken(refreshToken),
        expiresAt: new Date((now + REFRESH_TTL_SECONDS) * 1000),
        wechatIdentityId: wechatIdentityId ?? null
      }
    });
    return {
      apiVersion: CLIENT_API_VERSION,
      accessToken: this.sign({ typ: "client", sub: customerId, tid: tenantId, sid: sessionId, wid: workspaceId, iat: now, exp: now + ACCESS_TTL_SECONDS }),
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      customer: {
        customerId: customer.id,
        customerType: customer.customerType as "personal" | "corporate",
        displayName: customer.name,
        loginIdentifierMasked: maskPhone(customer.phone)
      },
      workspaces,
      // 会话实际绑定的空间（服务端事实），客户端据此记录当前服务，不凭请求参数推断。
      workspace: workspaces.find((row) => row.workspaceCode === workspace.code),
      wechatBound: wechatIdentities > 0
    };
  }

  async resolveTarget(tenantCode: string, workspaceCode?: string) {
    return this.target(tenantCode, workspaceCode);
  }

  async listPublicWorkspaces(tenantCode: string) {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: tenantCode.trim(), status: "ACTIVE" }, select: { id: true, code: true, name: true } });
    if (!tenant) throw new NotFoundException("租户不存在或未启用");
    const workspaces = await this.prisma.businessWorkspace.findMany({
      where: { tenantId: tenant.id, status: "ACTIVE" },
      select: { code: true, name: true, categoryCode: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    return { apiVersion: CLIENT_API_VERSION, tenantCode: tenant.code, tenantName: tenant.name, workspaces };
  }

  /**
   * 用途化验证码挑战（MP-02B）。purpose 缺省为 registration；login 要求手机号已注册，
   * account_closure 只能由已登录会话对本人手机号发起（见 createClosureChallenge）。
   * 冷却与幂等按租户 + 手机号统一，不因换用途而绕过。
   */
  async createChallenge(input: ClientRegistrationChallengeRequest & { purpose?: ClientChallengePurpose }): Promise<ClientRegistrationChallengeResponse> {
    const purpose: ClientChallengePurpose = input.purpose ?? "registration";
    const { tenant, workspace } = await this.target(input.tenantCode, input.workspaceCode);
    const identifier = normalizeIdentifier(input.identifier);
    if (!identifier) throw new BadRequestException("手机号或邮箱不能为空");
    if (input.method === "sms" && !/^\+?[0-9]{6,20}$/u.test(identifier)) throw new BadRequestException("手机号格式无效");
    if (input.method === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(identifier)) throw new BadRequestException("邮箱格式无效");
    if (purpose === "login") {
      if (input.method !== "sms") throw new BadRequestException("短信验证码登录只支持手机号");
      const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: tenant.id, loginPhone: identifier }, select: { status: true } });
      if (!account) throw new NotFoundException("该手机号尚未注册，请先注册");
      if (account.status !== "active") throw new ForbiddenException("该账号已停用，请联系商户");
    }
    const requestKey = input.idempotencyKey?.trim();
    if (!requestKey || requestKey.length > 191) throw new BadRequestException("验证码请求必须带有效幂等键");
    const identifierHash = hashOpaqueToken(`${tenant.id}:${input.method}:${identifier}`);
    // 幂等、验证码身份和冷却均按租户统一；来源空间只用于审计和业务上下文。
    // 锁住租户行，防止两个空间的并发请求用不同 key 绕过同一目标的冷却。
    const reservation = await runWithRequestIdentity({ tenantId: tenant.id, workspaceId: workspace.id }, () => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM Tenant WHERE id = ${tenant.id} FOR UPDATE
      `);
      const now = new Date();
      const existing = await tx.clientRegistrationChallenge.findFirst({
        where: { tenantId: tenant.id, requestKey }
      });
      if (existing && (existing.identifierHash !== identifierHash || existing.method !== input.method || existing.purpose !== purpose)) {
        throw new ConflictException("幂等键已用于其他验证目标，请更换幂等键");
      }
      if (existing && ["verified", "consumed"].includes(existing.status)) {
        throw new ConflictException("验证码挑战已验证或已使用，请继续注册或更换幂等键");
      }
      if (existing && existing.expiresAt > now && existing.status === "pending_verification") {
        return {
          kind: "response" as const,
          response: {
            apiVersion: CLIENT_API_VERSION,
            challengeId: existing.id,
            status: existing.status as ClientRegistrationChallengeResponse["status"],
            method: existing.method as ClientRegistrationChallengeResponse["method"],
            maskedDestination: existing.maskedDestination,
            expiresAt: existing.expiresAt.toISOString(),
            retryAfterSeconds: Math.max(0, Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000)),
            deliveryMode: existing.deliveryMode as ClientRegistrationChallengeResponse["deliveryMode"],
            purpose: existing.purpose as ClientChallengePurpose
          }
        };
      }
      const recent = await tx.clientRegistrationChallenge.findFirst({
        where: {
          tenantId: tenant.id,
          identifierHash,
          method: input.method,
          createdAt: { gt: new Date(now.getTime() - CHALLENGE_COOLDOWN_SECONDS * 1000) }
        },
        orderBy: { createdAt: "desc" }
      });
      if (recent) {
        const retryAfterSeconds = Math.max(1, Math.ceil((recent.createdAt.getTime() + CHALLENGE_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000));
        return {
          kind: "response" as const,
          response: {
            apiVersion: CLIENT_API_VERSION,
            challengeId: recent.id,
            status: recent.status as ClientRegistrationChallengeResponse["status"],
            method: recent.method as ClientRegistrationChallengeResponse["method"],
            maskedDestination: recent.maskedDestination,
            expiresAt: recent.expiresAt.toISOString(),
            retryAfterSeconds,
            deliveryMode: recent.deliveryMode as ClientRegistrationChallengeResponse["deliveryMode"],
            purpose: recent.purpose as ClientChallengePurpose
          }
        };
      }
      const id = existing?.id ?? randomBytes(16).toString("hex");
      const code = String(randomInt(100000, 1000000));
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000);
      const row = existing
        ? await tx.clientRegistrationChallenge.update({ where: { id }, data: { sourceWorkspaceId: workspace.id, method: input.method, purpose, identifierHash, maskedDestination: input.method === "sms" ? maskPhone(identifier) : maskEmail(identifier), codeHash: hashOpaqueToken(`${id}:${code}`), status: "pending_verification", deliveryMode: "development", attempts: 0, createdAt: now, expiresAt, verifiedAt: null, verificationTokenHash: null, consumedAt: null, registrationId: null, registeredCustomerId: null, registrationResult: null } })
        : await tx.clientRegistrationChallenge.create({ data: { id, tenantId: tenant.id, sourceWorkspaceId: workspace.id, method: input.method, purpose, identifierHash, maskedDestination: input.method === "sms" ? maskPhone(identifier) : maskEmail(identifier), codeHash: hashOpaqueToken(`${id}:${code}`), requestKey, status: "pending_verification", deliveryMode: "development", expiresAt } });
      return { kind: "send" as const, row, code };
    }));

    if (reservation.kind === "response") return reservation.response;
    const { row, code } = reservation;

    let deliveryMode: ClientRegistrationChallengeResponse["deliveryMode"] = "development";
    try {
      if (input.method === "sms") {
        const delivery = await runWithRequestIdentity({ tenantId: tenant.id, workspaceId: workspace.id }, () => this.integrations.sendVerificationSms(tenant.id, identifier, code, `client-registration:${row.id}`));
        if (delivery.configured) deliveryMode = "provider";
        else if (process.env.NODE_ENV === "production") throw new ServiceUnavailableException("短信验证码服务尚未配置，请先启用一个短信平台");
      } else if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("邮箱验证码服务尚未配置，请先接入邮件 provider");
      }
      await this.prisma.clientRegistrationChallenge.update({ where: { id: row.id }, data: { deliveryMode } });
    } catch (error) {
      await this.prisma.clientRegistrationChallenge.updateMany({ where: { id: row.id, status: "pending_verification" }, data: { status: "delivery_failed" } });
      throw error;
    }
    return {
      apiVersion: CLIENT_API_VERSION,
      challengeId: row.id,
      status: "pending_verification",
      method: input.method,
      maskedDestination: row.maskedDestination,
      expiresAt: row.expiresAt.toISOString(),
      retryAfterSeconds: 60,
      ...(deliveryMode === "development" ? { developmentCode: code } : {}),
      deliveryMode,
      purpose
    };
  }

  async verifyChallenge(input: VerifyClientRegistrationChallengeRequest): Promise<VerifyClientRegistrationChallengeResponse> {
    const row = await this.prisma.clientRegistrationChallenge.findUnique({ where: { id: input.challengeId } });
    if (!row || row.status !== "pending_verification") throw new ConflictException("验证码挑战不存在或已使用");
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.clientRegistrationChallenge.updateMany({ where: { id: row.id, status: "pending_verification", codeHash: row.codeHash, expiresAt: { lte: new Date() } }, data: { status: "expired" } });
      throw new ConflictException("验证码已过期");
    }
    if (row.attempts >= MAX_CHALLENGE_ATTEMPTS) throw new ConflictException("验证码尝试次数过多，请重新获取");
    if (!/^\d{6}$/u.test(input.code) || hashOpaqueToken(`${row.id}:${input.code}`) !== row.codeHash) {
      const attempts = row.attempts + 1;
      const updated = await this.prisma.clientRegistrationChallenge.updateMany({ where: { id: row.id, status: "pending_verification", codeHash: row.codeHash, attempts: row.attempts }, data: { attempts, status: attempts >= MAX_CHALLENGE_ATTEMPTS ? "expired" : "pending_verification" } });
      if (updated.count === 0) throw new ConflictException("验证码挑战已被处理，请重新获取");
      throw new ConflictException("验证码错误");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    const updated = await this.prisma.clientRegistrationChallenge.updateMany({ where: { id: row.id, status: "pending_verification", codeHash: row.codeHash, attempts: row.attempts, expiresAt: { gt: new Date() } }, data: { status: "verified", verifiedAt: new Date(), verificationTokenHash: hashOpaqueToken(token), expiresAt } });
    if (updated.count === 0) throw new ConflictException("验证码挑战已被处理，请重新获取");
    return { apiVersion: CLIENT_API_VERSION, verificationToken: token, expiresAt: expiresAt.toISOString() };
  }

  async registerPersonal(input: ClientPersonalMembershipRegistrationRequest): Promise<ClientPersonalMembershipRegistrationResponse> {
    assertPassword(input.password);
    const { tenant, workspace } = await this.target(input.tenantCode, input.workspaceCode);
    const phone = normalizeIdentifier(input.phone);
    if (!/^\+?[0-9]{6,20}$/u.test(phone)) throw new BadRequestException("手机号格式无效");
    const tokenHash = hashOpaqueToken(input.verificationToken);
    const result = await runWithRequestIdentity({ tenantId: tenant.id, workspaceId: workspace.id }, () => customerRegistrationTransaction(this.prisma, async (tx) => {
      const challenge = await tx.clientRegistrationChallenge.findFirst({ where: { tenantId: tenant.id, verificationTokenHash: tokenHash, purpose: "registration" } });
      if (!challenge) throw new ConflictException("注册验证已失效，请重新验证");
      const expectedIdentifier = challenge.method === "sms" ? phone : normalizeIdentifier(input.email ?? "");
      const expectedHash = hashOpaqueToken(`${tenant.id}:${challenge.method}:${expectedIdentifier}`);
      if (expectedHash !== challenge.identifierHash) throw new ConflictException("注册资料与验证目标不一致");
      if (challenge.consumedAt && challenge.registeredCustomerId && challenge.registrationId) {
        return { replay: true as const, challenge };
      }
      const claimed = await tx.clientRegistrationChallenge.updateMany({
        where: { id: challenge.id, status: "verified", consumedAt: null, expiresAt: { gt: new Date() } },
        data: { status: "consumed", consumedAt: new Date() }
      });
      if (claimed.count === 0) throw new ConflictException("注册验证已被处理，请重新验证");
      const settings = await tx.customerMembershipRegistrationSettings.findUnique({ where: { tenantId: tenant.id } });
      const registered = await this.registration.registerPersonal(tx, {
        tenantId: tenant.id,
        phone,
        name: input.name,
        email: input.email,
        identityNoMasked: maskIdentityNo(input.identityNo),
        automatic: settings?.registrationMode === "automatic",
        channel: "app",
        requestKey: `client:${challenge.id}`,
        sourceWorkspaceId: workspace.id,
        reviewPayload: { consent: input.consent, source: "client_api" } as unknown as Prisma.InputJsonValue,
        selfService: true,
        account: { passwordHash: hashPassword(input.password), mustChangePassword: false }
      });
      const customer = registered.customer;
      const membershipStatus = registered.membership.status as ClientPersonalMembershipRegistrationResponse["membershipStatus"];
      const review = registered.review;
      const registrationId = review?.id ?? challenge.id;
      const registrationResult: ClientPersonalMembershipRegistrationResponse["result"] = membershipStatus === "active" ? "active" : "pending_review";
      const updatedChallenge = await tx.clientRegistrationChallenge.update({ where: { id: challenge.id }, data: { registrationId, registeredCustomerId: customer.id, registrationResult } });
      return { replay: false as const, challenge: updatedChallenge, customerId: customer.id, registrationId, registrationResult, membershipStatus };
    }));
    if (result.replay) {
      return { apiVersion: CLIENT_API_VERSION, result: (result.challenge.registrationResult ?? "pending_review") as ClientPersonalMembershipRegistrationResponse["result"], registrationId: result.challenge.registrationId!, customerId: result.challenge.registeredCustomerId ?? undefined, reviewStatus: result.challenge.registrationResult === "active" ? "approved" : "pending", membershipStatus: result.challenge.registrationResult === "active" ? "active" : "pending_activation" };
    }
    return { apiVersion: CLIENT_API_VERSION, result: result.registrationResult, registrationId: result.registrationId, customerId: result.customerId, reviewStatus: result.registrationResult === "active" ? "approved" : "pending", membershipStatus: result.membershipStatus };
  }

  async login(input: ClientMembershipLoginRequest) {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: input.tenantCode.trim(), status: "ACTIVE" }, select: { id: true } });
    if (!tenant) throw new UnauthorizedException("账号或密码错误");
    const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: tenant.id, loginPhone: normalizeIdentifier(input.loginIdentifier) }, include: { customer: true } });
    if (!account || account.status !== "active" || account.customer.status !== "active" || !account.passwordHash || !verifyPassword(account.passwordHash, input.password)) throw new UnauthorizedException("账号或密码错误");
    const workspaceCode = input.workspaceCode?.trim();
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId: tenant.id, ...(workspaceCode ? { code: workspaceCode } : {}), status: "ACTIVE" },
      select: { id: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    if (!workspace) throw new ForbiddenException("该租户没有可访问的经营空间");
    return this.issueSession(tenant.id, account.customerId, workspace.id);
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashOpaqueToken(refreshToken);
    const session = await this.prisma.clientAuthSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { tenant: { select: { status: true } } }
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.tenant.status !== "ACTIVE") throw new UnauthorizedException("刷新令牌已失效");
    const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: session.tenantId, customerId: session.customerId }, include: { customer: { select: { status: true } } } });
    const membership = await this.prisma.customerMembership.findFirst({ where: { tenantId: session.tenantId, customerId: session.customerId, status: { notIn: [...BLOCKED_MEMBERSHIP_STATUSES] } } });
    if (!account || account.status !== "active" || account.customer.status !== "active" || !membership) throw new UnauthorizedException("客户端会话已失效");
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.clientAuthSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
      if (revoked.count !== 1) throw new UnauthorizedException("刷新令牌已失效");
      return this.issueSession(session.tenantId, session.customerId, session.workspaceId, tx, session.wechatIdentityId);
    });
  }

  async logout(refreshToken: string) {
    await this.prisma.clientAuthSession.updateMany({ where: { refreshTokenHash: hashOpaqueToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
    return { success: true };
  }

  async authenticate(accessToken: string): Promise<ClientRequestContext> {
    const payload = this.parse(accessToken);
    const session = await this.prisma.clientAuthSession.findFirst({ where: { id: payload.sid, tenantId: payload.tid, customerId: payload.sub, workspaceId: payload.wid, revokedAt: null }, include: { customer: true, workspace: true, tenant: { select: { code: true, status: true } } } });
    if (!session || session.expiresAt.getTime() <= Date.now() || session.tenant.status !== "ACTIVE") throw new UnauthorizedException("客户端会话已失效");
    const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: payload.tid, customerId: payload.sub }, include: { customer: { select: { status: true } } } });
    const membership = await this.prisma.customerMembership.findFirst({ where: { tenantId: payload.tid, customerId: payload.sub, status: { notIn: [...BLOCKED_MEMBERSHIP_STATUSES] } } });
    if (!account || account.status !== "active" || account.customer.status !== "active" || !membership || session.workspace.tenantId !== payload.tid || session.workspace.status !== "ACTIVE") throw new UnauthorizedException("客户端会话已失效");
    void this.prisma.clientAuthSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastUsedAt: new Date() } });
    return { tenantId: payload.tid, tenantCode: session.tenant.code, customerId: payload.sub, customerType: session.customer.customerType as "personal" | "corporate", displayName: session.customer.name, phone: session.customer.phone, workspaceId: payload.wid, workspaceCode: session.workspace.code, workspaceName: session.workspace.name, categoryCode: String(session.workspace.categoryCode), membershipStatus: membership.status, sessionId: session.id, wechatIdentityId: session.wechatIdentityId ?? undefined };
  }

  async switchWorkspace(context: ClientRequestContext, input: ClientSwitchWorkspaceRequest) {
    const workspace = await this.prisma.businessWorkspace.findFirst({ where: { tenantId: context.tenantId, code: input.workspaceCode.trim(), status: "ACTIVE" }, select: { id: true } });
    if (!workspace) throw new NotFoundException("经营空间不存在或未启用");
    return this.issueSession(context.tenantId, context.customerId, workspace.id, undefined, context.wechatIdentityId);
  }

  async changePassword(context: ClientRequestContext, currentPassword: string, newPassword: string) {
    assertPassword(newPassword);
    const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: context.tenantId, customerId: context.customerId } });
    if (!account?.passwordHash || !verifyPassword(account.passwordHash, currentPassword)) throw new UnauthorizedException("当前密码错误");
    await this.customers.updateAccount(context.tenantId, { accountId: account.id }, { passwordHash: hashPassword(newPassword), passwordUpdatedAt: new Date(), mustChangePassword: false });
    return { success: true };
  }

  /**
   * 消费一份已验证的证明：必须匹配租户、用途与目标手机号哈希，且只能消费一次。
   * 注册流程另有幂等回放语义，不走这里。
   */
  private async consumeVerifiedChallenge(tx: Prisma.TransactionClient, tenantId: string, verificationToken: string, purpose: Exclude<ClientChallengePurpose, "registration">, identifierHash: string) {
    const tokenHash = hashOpaqueToken(verificationToken);
    const challenge = await tx.clientRegistrationChallenge.findFirst({ where: { tenantId, verificationTokenHash: tokenHash, purpose } });
    if (!challenge) throw new ConflictException("验证已失效或用途不符，请重新获取验证码");
    if (challenge.identifierHash !== identifierHash) throw new ConflictException("验证目标与当前手机号不一致");
    const claimed = await tx.clientRegistrationChallenge.updateMany({
      where: { id: challenge.id, status: "verified", consumedAt: null, expiresAt: { gt: new Date() } },
      data: { status: "consumed", consumedAt: new Date() }
    });
    if (claimed.count === 0) throw new ConflictException("验证已被使用或已过期，请重新获取验证码");
    return challenge;
  }

  /** 短信验证码登录（MP-02B）：只接受 login 用途的证明，手机号必须已注册；不创建客户、不改会员。 */
  async smsLogin(input: ClientSmsLoginRequest): Promise<ClientMembershipSessionResponse> {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: input.tenantCode.trim(), status: "ACTIVE" }, select: { id: true } });
    if (!tenant) throw new NotFoundException("租户不存在或未启用");
    const phone = normalizeIdentifier(input.loginIdentifier);
    if (!/^\+?[0-9]{6,20}$/u.test(phone)) throw new BadRequestException("手机号格式无效");
    const identifierHash = hashOpaqueToken(`${tenant.id}:sms:${phone}`);
    const workspaceCode = input.workspaceCode?.trim();
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId: tenant.id, ...(workspaceCode ? { code: workspaceCode } : {}), status: "ACTIVE" },
      select: { id: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }]
    });
    if (!workspace) throw new ForbiddenException("该租户没有可访问的经营空间");
    const customerId = await this.prisma.$transaction(async (tx) => {
      await this.consumeVerifiedChallenge(tx, tenant.id, input.verificationToken, "login", identifierHash);
      const account = await tx.customerAccount.findFirst({ where: { tenantId: tenant.id, loginPhone: phone }, include: { customer: { select: { status: true, customerType: true } } } });
      if (!account) throw new NotFoundException("该手机号尚未注册，请先注册");
      if (account.status !== "active" || account.customer.status !== "active") throw new ForbiddenException("该账号已停用，请联系商户");
      return account.customerId;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.issueSession(tenant.id, customerId, workspace.id);
  }

  /** 本人注销前的短信核验：目标只能是当前会话账号的手机号，客户端不提交号码。 */
  async createClosureChallenge(context: ClientRequestContext): Promise<ClientRegistrationChallengeResponse> {
    const minute = Math.floor(Date.now() / 60_000);
    return this.createChallenge({
      tenantCode: context.tenantCode,
      workspaceCode: context.workspaceCode,
      method: "sms",
      identifier: context.phone,
      idempotencyKey: `closure:${context.sessionId}:${minute}`,
      purpose: "account_closure"
    });
  }

  /** 消费注销证明（供注销服务在自己的事务里调用）。 */
  async consumeClosureProof(tx: Prisma.TransactionClient, context: ClientRequestContext, loginIdentifier: string, verificationToken: string) {
    const phone = normalizeIdentifier(loginIdentifier);
    if (phone !== normalizeIdentifier(context.phone)) throw new ConflictException("手机号与当前账号不一致");
    await this.consumeVerifiedChallenge(tx, context.tenantId, verificationToken, "account_closure", hashOpaqueToken(`${context.tenantId}:sms:${phone}`));
  }

  /** 撤销客户在本租户的全部客户端会话（注销、改绑等场景）。 */
  async revokeSessions(tenantId: string, customerId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const result = await tx.clientAuthSession.updateMany({ where: { tenantId, customerId, revokedAt: null }, data: { revokedAt: new Date() } });
    return result.count;
  }

  async sessionStatus(context: ClientRequestContext) {
    const [customer, account, workspaces, reviews, qualifications] = await Promise.all([
      this.prisma.customerProfile.findFirst({ where: { tenantId: context.tenantId, id: context.customerId }, select: { id: true, customerType: true, name: true, phoneMasked: true, email: true } }),
      this.prisma.customerAccount.findFirst({ where: { tenantId: context.tenantId, customerId: context.customerId }, select: { status: true } }),
      this.workspaceRows(context.tenantId, context.customerId),
      this.prisma.customerMembershipReview.findMany({ where: { tenantId: context.tenantId, customerId: context.customerId, reviewType: "registration" }, orderBy: { updatedAt: "desc" }, take: 20 }),
      this.prisma.customerQualificationRef.findMany({ where: { tenantId: context.tenantId, customerId: context.customerId }, orderBy: { updatedAt: "desc" } })
    ]);
    if (!customer || !account) throw new UnauthorizedException("客户账号不存在");
    return { apiVersion: CLIENT_API_VERSION, customerId: customer.id, customerType: customer.customerType as "personal" | "corporate", displayName: customer.name, phoneMasked: customer.phoneMasked, email: customer.email ?? undefined, accountStatus: account.status as "active" | "suspended" | "closed", workspace: workspaces.find((row) => row.workspaceCode === context.workspaceCode)!, workspaces, reviews: reviews.filter((row) => row.reviewType === "registration").map((row) => ({ registrationId: row.id, status: row.status as "pending" | "approved" | "rejected" | "supplement_required" | "cancelled", reason: row.reason ?? undefined, updatedAt: row.updatedAt.toISOString() })), qualifications: qualifications.map((row) => ({ qualificationType: row.qualificationType, status: row.status as ClientMembershipQualificationStatus["status"], expiresAt: asIso(row.expiresAt), updatedAt: row.updatedAt.toISOString() })) };
  }
}
