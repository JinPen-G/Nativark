import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
  type ClientRegistrationChallengeRequest,
  type ClientRegistrationChallengeResponse,
  type ClientSwitchWorkspaceRequest,
  type ClientWorkspaceSummary,
  type VerifyClientRegistrationChallengeRequest,
  type VerifyClientRegistrationChallengeResponse
} from "@rental-os/shared";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { hashOpaqueToken, hashPassword, verifyPassword } from "../../common/password";
import { TenantIntegrationRuntimeService } from "../integrations/tenant-integration.runtime.service";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const CHALLENGE_TTL_SECONDS = 10 * 60;
const CHALLENGE_COOLDOWN_SECONDS = 60;
const MAX_CHALLENGE_ATTEMPTS = 5;
const BLOCKED_WORKSPACE_MEMBERSHIP_STATUSES = new Set(["exited", "closed"]);

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: TenantIntegrationRuntimeService
  ) {}

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

  private async target(tenantCode: string, workspaceCode: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { code: tenantCode.trim(), status: "ACTIVE" },
      select: { id: true, code: true }
    });
    if (!tenant) throw new NotFoundException("租户不存在或未启用");
    const workspace = await this.prisma.businessWorkspace.findFirst({
      where: { tenantId: tenant.id, code: workspaceCode.trim(), status: "ACTIVE" },
      select: { id: true, code: true, name: true, categoryCode: true }
    });
    if (!workspace) throw new NotFoundException("经营空间不存在或未启用");
    return { tenant, workspace };
  }

  private async workspaceRows(tenantId: string, customerId: string) {
    const rows = await this.prisma.customerWorkspaceLink.findMany({
      where: { tenantId, customerId, workspace: { status: "ACTIVE" } },
      include: { workspace: { select: { code: true, name: true, categoryCode: true, isDefault: true } } },
      orderBy: [{ workspace: { isDefault: "desc" } }, { createdAt: "asc" }]
    });
    return rows.map((row): ClientWorkspaceSummary => ({
      workspaceCode: row.workspace.code,
      workspaceName: row.workspace.name,
      categoryCode: String(row.workspace.categoryCode),
      membershipStatus: row.status,
      isDefault: row.workspace.isDefault
    }));
  }

  private async issueSession(
    tenantId: string,
    customerId: string,
    workspaceId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma
  ): Promise<ClientMembershipSessionResponse> {
    const [customer, workspace, links] = await Promise.all([
      tx.customerProfile.findFirst({ where: { tenantId, id: customerId }, select: { id: true, customerType: true, name: true, phone: true, status: true } }),
      tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { id: true, code: true, name: true, categoryCode: true, isDefault: true } }),
      tx.customerWorkspaceLink.findMany({
        where: { tenantId, customerId, status: { notIn: [...BLOCKED_WORKSPACE_MEMBERSHIP_STATUSES] }, workspace: { status: "ACTIVE" } },
        include: { workspace: { select: { code: true, name: true, categoryCode: true, isDefault: true } } },
        orderBy: [{ workspace: { isDefault: "desc" } }, { createdAt: "asc" }]
      })
    ]);
    if (!customer || customer.status !== "active" || !workspace) throw new UnauthorizedException("客户或经营空间不存在");
    const currentLink = links.find((row) => row.workspaceId === workspaceId);
    if (!currentLink) throw new ForbiddenException("客户尚未加入该经营空间");

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
        expiresAt: new Date((now + REFRESH_TTL_SECONDS) * 1000)
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
      workspaces: links.map((row) => ({
        workspaceCode: row.workspace.code,
        workspaceName: row.workspace.name,
        categoryCode: String(row.workspace.categoryCode),
        membershipStatus: row.status
      }))
    };
  }

  async resolveTarget(tenantCode: string, workspaceCode: string) {
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

  async createChallenge(input: ClientRegistrationChallengeRequest): Promise<ClientRegistrationChallengeResponse> {
    const { tenant, workspace } = await this.target(input.tenantCode, input.workspaceCode);
    const identifier = normalizeIdentifier(input.identifier);
    if (!identifier) throw new BadRequestException("手机号或邮箱不能为空");
    if (input.method === "sms" && !/^\+?[0-9]{6,20}$/u.test(identifier)) throw new BadRequestException("手机号格式无效");
    if (input.method === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(identifier)) throw new BadRequestException("邮箱格式无效");
    const requestKey = input.idempotencyKey?.trim();
    if (!requestKey || requestKey.length > 191) throw new BadRequestException("验证码请求必须带有效幂等键");
    const identifierHash = hashOpaqueToken(`${tenant.id}:${workspace.id}:${input.method}:${identifier}`);
    const now = new Date();
    // 幂等键只能防止客户端重试，不能阻止攻击者每次换一个 key 轰炸同一手机号/邮箱。
    // 服务端按租户、空间、验证目标和方式做短冷却；不返回开发验证码，避免通过换 key
    // 把开发环境的验证码接口变成可无限调用的短信成本放大器。以空间行加锁，
    // 让多实例部署下的两个并发请求也不能同时绕过这条冷却规则。
    const reservation = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM business_workspaces
         WHERE tenantId = ${tenant.id} AND id = ${workspace.id}
         FOR UPDATE
      `);
      const existing = await tx.clientRegistrationChallenge.findFirst({
        where: { tenantId: tenant.id, workspaceId: workspace.id, requestKey }
      });
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
            deliveryMode: existing.deliveryMode as ClientRegistrationChallengeResponse["deliveryMode"]
          }
        };
      }
      const recent = await tx.clientRegistrationChallenge.findFirst({
        where: {
          tenantId: tenant.id,
          workspaceId: workspace.id,
          identifierHash,
          method: input.method,
          status: { in: ["pending_verification", "delivery_failed"] },
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
            deliveryMode: recent.deliveryMode as ClientRegistrationChallengeResponse["deliveryMode"]
          }
        };
      }
      const id = existing?.id ?? randomBytes(16).toString("hex");
      const code = String(randomInt(100000, 1000000));
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000);
      const row = existing
        ? await tx.clientRegistrationChallenge.update({ where: { id }, data: { method: input.method, identifierHash, maskedDestination: input.method === "sms" ? maskPhone(identifier) : maskEmail(identifier), codeHash: hashOpaqueToken(`${id}:${code}`), status: "pending_verification", deliveryMode: "development", attempts: 0, expiresAt, verifiedAt: null, verificationTokenHash: null, consumedAt: null, registrationId: null, registeredCustomerId: null, registrationResult: null } })
        : await tx.clientRegistrationChallenge.create({ data: { id, tenantId: tenant.id, workspaceId: workspace.id, method: input.method, identifierHash, maskedDestination: input.method === "sms" ? maskPhone(identifier) : maskEmail(identifier), codeHash: hashOpaqueToken(`${id}:${code}`), requestKey, status: "pending_verification", deliveryMode: "development", expiresAt } });
      return { kind: "send" as const, row, code };
    });

    if (reservation.kind === "response") return reservation.response;
    const { row, code } = reservation;

    let deliveryMode: ClientRegistrationChallengeResponse["deliveryMode"] = "development";
    try {
      if (input.method === "sms") {
        const delivery = await this.integrations.sendVerificationSms(tenant.id, identifier, code, `client-registration:${row.id}`);
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
      deliveryMode
    };
  }

  async verifyChallenge(input: VerifyClientRegistrationChallengeRequest): Promise<VerifyClientRegistrationChallengeResponse> {
    const row = await this.prisma.clientRegistrationChallenge.findUnique({ where: { id: input.challengeId } });
    if (!row || row.status !== "pending_verification") throw new ConflictException("验证码挑战不存在或已使用");
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.clientRegistrationChallenge.updateMany({ where: { id: row.id, status: "pending_verification" }, data: { status: "expired" } });
      throw new ConflictException("验证码已过期");
    }
    if (row.attempts >= MAX_CHALLENGE_ATTEMPTS) throw new ConflictException("验证码尝试次数过多，请重新获取");
    if (!/^\d{6}$/u.test(input.code) || hashOpaqueToken(`${row.id}:${input.code}`) !== row.codeHash) {
      const attempts = row.attempts + 1;
      const updated = await this.prisma.clientRegistrationChallenge.updateMany({ where: { id: row.id, status: "pending_verification", attempts: row.attempts }, data: { attempts, status: attempts >= MAX_CHALLENGE_ATTEMPTS ? "expired" : "pending_verification" } });
      if (updated.count === 0) throw new ConflictException("验证码挑战已被处理，请重新获取");
      throw new ConflictException("验证码错误");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
    const updated = await this.prisma.clientRegistrationChallenge.updateMany({ where: { id: row.id, status: "pending_verification", attempts: row.attempts, expiresAt: { gt: new Date() } }, data: { status: "verified", verifiedAt: new Date(), verificationTokenHash: hashOpaqueToken(token), expiresAt } });
    if (updated.count === 0) throw new ConflictException("验证码挑战已被处理，请重新获取");
    return { apiVersion: CLIENT_API_VERSION, verificationToken: token, expiresAt: expiresAt.toISOString() };
  }

  async registerPersonal(input: ClientPersonalMembershipRegistrationRequest): Promise<ClientPersonalMembershipRegistrationResponse> {
    assertPassword(input.password);
    const { tenant, workspace } = await this.target(input.tenantCode, input.workspaceCode);
    const phone = normalizeIdentifier(input.phone);
    if (!/^\+?[0-9]{6,20}$/u.test(phone)) throw new BadRequestException("手机号格式无效");
    const tokenHash = hashOpaqueToken(input.verificationToken);
    const result = await this.prisma.$transaction(async (tx) => {
      const challenge = await tx.clientRegistrationChallenge.findFirst({ where: { tenantId: tenant.id, workspaceId: workspace.id, verificationTokenHash: tokenHash } });
      if (!challenge) throw new ConflictException("注册验证已失效，请重新验证");
      if (challenge.consumedAt && challenge.registeredCustomerId && challenge.registrationId) {
        return { replay: true, challenge };
      }
      const claimed = await tx.clientRegistrationChallenge.updateMany({
        where: { id: challenge.id, status: "verified", consumedAt: null, expiresAt: { gt: new Date() } },
        data: { status: "consumed", consumedAt: new Date() }
      });
      if (claimed.count === 0) throw new ConflictException("注册验证已被处理，请重新验证");
      const expectedIdentifier = challenge.method === "sms" ? phone : normalizeIdentifier(input.email ?? "");
      const expectedHash = hashOpaqueToken(`${tenant.id}:${workspace.id}:${challenge.method}:${expectedIdentifier}`);
      if (expectedHash !== challenge.identifierHash) throw new ConflictException("注册资料与验证目标不一致");
      const settings = await tx.customerMembershipRegistrationSettings.findFirst({ where: { tenantId: tenant.id, workspaceId: workspace.id } });
      let customer = await tx.customerProfile.findFirst({ where: { tenantId: tenant.id, phone } });
      if (customer && customer.customerType !== "personal") throw new ConflictException("该手机号已属于企业会员，不能注册为个人会员");
      if (customer && customer.status !== "active") throw new ConflictException("该客户资料已停用，不能通过注册重新激活");
      if (!customer) {
        customer = await tx.customerProfile.create({ data: { tenantId: tenant.id, customerType: "personal", name: input.name.trim(), phone, phoneMasked: maskPhone(phone), email: input.email?.trim() || null, identityNoMasked: input.identityNo?.trim() ? `${input.identityNo.trim().slice(0, 2)}****${input.identityNo.trim().slice(-2)}` : null, qualifications: {} as Prisma.InputJsonValue } });
      } else {
        const account = await tx.customerAccount.findFirst({ where: { tenantId: tenant.id, customerId: customer.id } });
        if (account && account.status !== "active") throw new ConflictException("该客户账号已停用，不能通过注册重新激活");
        if (account?.passwordHash && account.status === "active") throw new ConflictException("该手机号已注册，请直接登录");
        customer = await tx.customerProfile.update({ where: { id: customer.id }, data: { name: input.name.trim(), email: input.email?.trim() || customer.email || null, identityNoMasked: input.identityNo?.trim() ? `${input.identityNo.trim().slice(0, 2)}****${input.identityNo.trim().slice(-2)}` : customer.identityNoMasked } });
      }
      const membershipStatus = settings?.registrationMode === "automatic" ? "active" : "pending_activation";
      const existingLink = await tx.customerWorkspaceLink.findUnique({ where: { workspaceId_customerId: { workspaceId: workspace.id, customerId: customer.id } }, select: { status: true } });
      if (existingLink && BLOCKED_WORKSPACE_MEMBERSHIP_STATUSES.has(existingLink.status)) throw new ConflictException("该客户已退出或关闭当前经营空间，不能通过注册重新加入");
      await tx.customerWorkspaceLink.upsert({ where: { workspaceId_customerId: { workspaceId: workspace.id, customerId: customer.id } }, create: { tenantId: tenant.id, workspaceId: workspace.id, customerId: customer.id, status: membershipStatus }, update: { status: membershipStatus } });
      const passwordHash = hashPassword(input.password);
      await tx.customerAccount.upsert({ where: { tenantId_customerId: { tenantId: tenant.id, customerId: customer.id } }, create: { tenantId: tenant.id, customerId: customer.id, loginPhone: phone, loginPhoneMasked: maskPhone(phone), status: "active", passwordHash, passwordUpdatedAt: new Date(), mustChangePassword: false }, update: { loginPhone: phone, loginPhoneMasked: maskPhone(phone), status: "active", passwordHash, passwordUpdatedAt: new Date(), mustChangePassword: false } });
      const review = membershipStatus === "pending_activation"
        ? await tx.customerMembershipReview.create({ data: { tenantId: tenant.id, workspaceId: workspace.id, customerId: customer.id, reviewType: "registration", status: "pending", channel: "app", requestKey: `client:${challenge.id}`, payload: { consent: input.consent, source: "client_api" } as unknown as Prisma.InputJsonValue } })
        : undefined;
      const registrationId = review?.id ?? challenge.id;
      const registrationResult = membershipStatus === "active" ? "active" : "pending_review";
      const updatedChallenge = await tx.clientRegistrationChallenge.update({ where: { id: challenge.id }, data: { registrationId, registeredCustomerId: customer.id, registrationResult } });
      return { replay: false, challenge: updatedChallenge, customerId: customer.id, registrationId, registrationResult, membershipStatus };
    });
    if (result.replay) {
      return { apiVersion: CLIENT_API_VERSION, result: (result.challenge.registrationResult ?? "pending_review") as ClientPersonalMembershipRegistrationResponse["result"], registrationId: result.challenge.registrationId!, customerId: result.challenge.registeredCustomerId ?? undefined, reviewStatus: result.challenge.registrationResult === "active" ? "approved" : "pending", membershipStatus: result.challenge.registrationResult === "active" ? "active" : "pending_activation" };
    }
    const completed = result as { registrationResult: string; registrationId: string; customerId: string; membershipStatus: "active" | "pending_activation" };
    return { apiVersion: CLIENT_API_VERSION, result: completed.registrationResult as ClientPersonalMembershipRegistrationResponse["result"], registrationId: completed.registrationId, customerId: completed.customerId, reviewStatus: completed.registrationResult === "active" ? "approved" : "pending", membershipStatus: completed.membershipStatus };
  }

  async login(input: ClientMembershipLoginRequest) {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: input.tenantCode.trim(), status: "ACTIVE" }, select: { id: true } });
    if (!tenant) throw new UnauthorizedException("账号或密码错误");
    const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: tenant.id, loginPhone: normalizeIdentifier(input.loginIdentifier) }, include: { customer: true } });
    if (!account || account.status !== "active" || account.customer.status !== "active" || !account.passwordHash || !verifyPassword(account.passwordHash, input.password)) throw new UnauthorizedException("账号或密码错误");
    const links = await this.prisma.customerWorkspaceLink.findMany({ where: { tenantId: tenant.id, customerId: account.customerId, status: { notIn: [...BLOCKED_WORKSPACE_MEMBERSHIP_STATUSES] }, workspace: { status: "ACTIVE" } }, include: { workspace: { select: { id: true, code: true, name: true, categoryCode: true, isDefault: true } } }, orderBy: [{ workspace: { isDefault: "desc" } }, { createdAt: "asc" }] });
    const workspaceCode = input.workspaceCode?.trim();
    const chosen = workspaceCode ? links.find((row) => row.workspace.code === workspaceCode) : links[0];
    if (!chosen) throw new ForbiddenException("该账号尚未加入可访问的经营空间");
    return this.issueSession(tenant.id, account.customerId, chosen.workspaceId);
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashOpaqueToken(refreshToken);
    const session = await this.prisma.clientAuthSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { tenant: { select: { status: true } } }
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || session.tenant.status !== "ACTIVE") throw new UnauthorizedException("刷新令牌已失效");
    const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: session.tenantId, customerId: session.customerId }, include: { customer: { select: { status: true } } } });
    const link = await this.prisma.customerWorkspaceLink.findFirst({ where: { tenantId: session.tenantId, customerId: session.customerId, workspaceId: session.workspaceId, status: { notIn: [...BLOCKED_WORKSPACE_MEMBERSHIP_STATUSES] }, workspace: { status: "ACTIVE" } } });
    if (!account || account.status !== "active" || account.customer.status !== "active" || !link) throw new UnauthorizedException("客户端会话已失效");
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.clientAuthSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
      if (revoked.count !== 1) throw new UnauthorizedException("刷新令牌已失效");
      return this.issueSession(session.tenantId, session.customerId, session.workspaceId, tx);
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
    const link = await this.prisma.customerWorkspaceLink.findFirst({ where: { tenantId: payload.tid, customerId: payload.sub, workspaceId: payload.wid, status: { notIn: [...BLOCKED_WORKSPACE_MEMBERSHIP_STATUSES] } } });
    if (!account || account.status !== "active" || account.customer.status !== "active" || !link || session.workspace.status !== "ACTIVE") throw new UnauthorizedException("客户端会话已失效");
    void this.prisma.clientAuthSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { lastUsedAt: new Date() } });
    return { tenantId: payload.tid, tenantCode: session.tenant.code, customerId: payload.sub, customerType: session.customer.customerType as "personal" | "corporate", displayName: session.customer.name, phone: session.customer.phone, workspaceId: payload.wid, workspaceCode: session.workspace.code, workspaceName: session.workspace.name, categoryCode: String(session.workspace.categoryCode), membershipStatus: link.status, sessionId: session.id };
  }

  async switchWorkspace(context: ClientRequestContext, input: ClientSwitchWorkspaceRequest) {
    const workspace = await this.prisma.businessWorkspace.findFirst({ where: { tenantId: context.tenantId, code: input.workspaceCode.trim(), status: "ACTIVE" }, select: { id: true } });
    if (!workspace) throw new NotFoundException("经营空间不存在或未启用");
    const link = await this.prisma.customerWorkspaceLink.findFirst({ where: { tenantId: context.tenantId, customerId: context.customerId, workspaceId: workspace.id, status: { notIn: [...BLOCKED_WORKSPACE_MEMBERSHIP_STATUSES] } } });
    if (!link) throw new ForbiddenException("客户尚未获得该经营空间的访问资格");
    return this.issueSession(context.tenantId, context.customerId, workspace.id);
  }

  async changePassword(context: ClientRequestContext, currentPassword: string, newPassword: string) {
    assertPassword(newPassword);
    const account = await this.prisma.customerAccount.findFirst({ where: { tenantId: context.tenantId, customerId: context.customerId } });
    if (!account?.passwordHash || !verifyPassword(account.passwordHash, currentPassword)) throw new UnauthorizedException("当前密码错误");
    await this.prisma.customerAccount.update({ where: { id: account.id }, data: { passwordHash: hashPassword(newPassword), passwordUpdatedAt: new Date(), mustChangePassword: false } });
    return { success: true };
  }

  async sessionStatus(context: ClientRequestContext) {
    const [customer, account, workspaces, reviews, qualifications] = await Promise.all([
      this.prisma.customerProfile.findFirst({ where: { tenantId: context.tenantId, id: context.customerId }, select: { id: true, customerType: true, name: true, phoneMasked: true, email: true } }),
      this.prisma.customerAccount.findFirst({ where: { tenantId: context.tenantId, customerId: context.customerId }, select: { status: true } }),
      this.workspaceRows(context.tenantId, context.customerId),
      this.prisma.customerMembershipReview.findMany({ where: { tenantId: context.tenantId, workspaceId: context.workspaceId, customerId: context.customerId }, orderBy: { updatedAt: "desc" }, take: 20 }),
      this.prisma.customerQualificationRef.findMany({ where: { tenantId: context.tenantId, customerId: context.customerId }, orderBy: { updatedAt: "desc" } })
    ]);
    if (!customer || !account) throw new UnauthorizedException("客户账号不存在");
    return { apiVersion: CLIENT_API_VERSION, customerId: customer.id, customerType: customer.customerType as "personal" | "corporate", displayName: customer.name, phoneMasked: customer.phoneMasked, email: customer.email ?? undefined, accountStatus: account.status as "active" | "suspended" | "closed", workspace: workspaces.find((row) => row.workspaceCode === context.workspaceCode)!, workspaces, reviews: reviews.filter((row) => row.reviewType === "registration").map((row) => ({ registrationId: row.id, status: row.status as "pending" | "approved" | "rejected" | "supplement_required" | "cancelled", reason: row.reason ?? undefined, updatedAt: row.updatedAt.toISOString() })), qualifications: qualifications.map((row) => ({ qualificationType: row.qualificationType, status: row.status as ClientMembershipQualificationStatus["status"], expiresAt: asIso(row.expiresAt), updatedAt: row.updatedAt.toISOString() })) };
  }
}
