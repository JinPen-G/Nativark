/** 原Web认证的唯一签名、刷新、改密和登录保护实现。
 * 公共宿主与Rental认证适配共用此服务；业务范围和会话呈现由受控子类提供。
 * 不读取业务表或加载Core，也不把缺失业务范围当作业务访问许可。 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  RefreshSessionRequest,
  PlatformTenantSummary,
  PlatformLoginResponse,
  SystemUserRow,
  SystemSecurityBaselineConfig,
  TenantIdentity,
} from "@rental-os/shared/platform";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hashOpaqueToken } from "../../common/password";
import type { PlatformAuthDataStore } from "../platform/platform-auth-data-store";

export type AuthAudience = "operator" | "staff";
export interface AuthAccessTokenPayload {
  sub: string;
  tid: string;
  sid: string;
  aud?: AuthAudience;
  wid?: string;
  iat: number;
  exp: number;
}
type AccessTokenPayload = AuthAccessTokenPayload;
interface LoginFailureState {
  count: number;
  firstFailedAt: number;
  lockedUntil?: number;
}
export interface PlatformAuthAccessContext {
  user: SystemUserRow;
  tenantUser: SystemUserRow;
  workspaceId?: string;
  hasWorkspaces: boolean;
  workspaceValid: boolean;
  accessSession: { sessionId: string; expiresAt: number };
}
export interface PlatformAuthenticationSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  audience?: string | null;
  revokedAt?: Date | null;
  currentWorkspaceId?: string | null;
}
export interface NewPlatformAuthenticationSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  currentWorkspaceId?: string | null;
  audience?: AuthAudience;
}
export interface PlatformAuthenticationSource {
  findUserForLogin(
    tenantCode: string,
    account: string,
    password: string,
  ): Promise<
    | {
        tenant: PlatformTenantSummary;
        user: SystemUserRow;
        needsTenantOnboarding: boolean;
      }
    | undefined
  >;
  findUserById(id: string): Promise<SystemUserRow | undefined>;
  getAuthSession(
    id: string,
  ):
    | PlatformAuthenticationSession
    | null
    | undefined
    | Promise<PlatformAuthenticationSession | null | undefined>;
  getAuthSessionByRefreshHash(
    hash: string,
  ):
    | PlatformAuthenticationSession
    | null
    | undefined
    | Promise<PlatformAuthenticationSession | null | undefined>;
  createAuthSession(
    input: NewPlatformAuthenticationSession,
  ): PlatformAuthenticationSession | Promise<PlatformAuthenticationSession>;
  rotateAuthSession(previousId: string, input: NewPlatformAuthenticationSession): Promise<boolean>;
  revokeAuthSession(id: string): boolean | Promise<boolean>;
  changeUserPassword(id: string, currentPassword: string, nextPassword: string): Promise<void>;
  findTenantByIdForAuth(id: string): PlatformTenantSummary | Promise<PlatformTenantSummary>;
  getSecurityBaseline(): Promise<SystemSecurityBaselineConfig>;
  recordSecurityAudit(input: {
    tenantId?: string;
    tenantCode?: string;
    action: string;
    operator: string;
    targetId?: string;
    detail: string;
  }): Promise<void>;
}
export interface TenantBrandingSource {
  getBranding(
    tenantId: string,
  ): Promise<Omit<TenantIdentity, "tenantId" | "tenantCode" | "tenantName" | "tenantStatus">>;
}
export interface AccountAppearanceSource {
  getThemeColor(userId: string): Promise<string | undefined>;
}

export abstract class AuthSessionService<
  TLogin extends PlatformLoginResponse,
  TContext extends PlatformAuthAccessContext,
> {
  constructor(
    protected readonly identity: PlatformAuthenticationSource,
    protected readonly configService: ConfigService,
    protected readonly tenantAppearance?: TenantBrandingSource,
    protected readonly accountAppearance?: AccountAppearanceSource,
    protected readonly prisma?: PlatformAuthDataStore,
  ) {}
  abstract resolveAccessContext(
    authorization?: string,
    options?: { allowInvalidWorkspace?: boolean; audience?: AuthAudience; businessScope?: boolean },
  ): Promise<TContext | undefined>;
  protected abstract buildLoginResponse(
    user: SystemUserRow,
    tenant: PlatformTenantSummary,
    sessionId: string,
    workspaceId: string | undefined,
    refreshToken: string | undefined,
    needsTenantOnboarding?: boolean,
    audience?: AuthAudience,
  ): Promise<TLogin>;
  protected abstract resolveSessionWorkspaceId(
    userId: string,
    requested?: string,
  ): Promise<string | undefined>;
  protected abstract findWorkspaceScopedUser(
    userId: string,
    workspaceId?: string,
  ): Promise<SystemUserRow | undefined>;

  isPersonalDemoPasswordResetEnabled() {
    return false;
  }

  protected readonly logger = new Logger(this.constructor.name);

  protected readonly loginFailures = new Map<string, LoginFailureState>();

  protected failedLoginPruneCounter = 0;

  protected readonly accessTtlSeconds = 15 * 60;

  protected readonly refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

  async login(input: LoginRequest, audience: AuthAudience = "operator"): Promise<TLogin> {
    const tenantCode = input.tenantCode.trim().toLowerCase();
    const account = input.account.trim();
    if (!tenantCode || !account || !input.password) {
      throw new BadRequestException("租户编码、账号和密码不能为空");
    }
    const security = await this.identity.getSecurityBaseline();
    const loginKey = `${tenantCode}:${account}`.toLowerCase();
    await this.assertNotLocked(loginKey, security.loginRateLimit);

    const loginResult = await this.identity.findUserForLogin(tenantCode, account, input.password);
    if (!loginResult) {
      await this.recordFailedLogin(loginKey, security.loginRateLimit);
      await this.identity.recordSecurityAudit({
        tenantCode,
        action: "auth.login.failed",
        operator: account,
        targetId: account,
        detail: "登录失败：租户、账号或密码不正确，或租户已冻结。",
      });
      throw new UnauthorizedException("租户、账号或密码不正确");
    }

    await this.clearFailedLogin(loginKey);
    await this.identity.recordSecurityAudit({
      tenantId: loginResult.tenant.tenantId,
      action: "auth.login.success",
      operator: loginResult.user.displayName,
      targetId: loginResult.user.id,
      detail: "登录成功。",
    });
    if (audience === "staff" && loginResult.user.isSaasAdmin) {
      throw new UnauthorizedException("该账号不能登录租户员工端");
    }
    return this.issueSession(
      loginResult.user,
      loginResult.tenant,
      undefined,
      loginResult.needsTenantOnboarding,
      audience,
    );
  }

  async refresh(input: RefreshSessionRequest, audience: AuthAudience = "operator"): Promise<TLogin> {
    if (!input.refreshToken) throw new UnauthorizedException("刷新令牌缺失");
    const session = await this.identity.getAuthSessionByRefreshHash(hashOpaqueToken(input.refreshToken));
    if (!session || this.sessionAudience(session) !== audience)
      throw new UnauthorizedException("会话已失效，请重新登录");
    const user = await this.identity.findUserById(session.userId);
    if (!user) throw new UnauthorizedException("账号或租户已停用");
    const tenant = await this.identity.findTenantByIdForAuth(user.tenantId);
    // 续期优先保留当前空间；空间在会话存续期内被撤销或停用时，退回账号仍可进入
    // 的默认空间。先解析再轮换，避免拿到新令牌后才发现上下文无效。
    const workspaceId =
      (await this.resolveSessionWorkspaceId(user.id, session.currentWorkspaceId ?? undefined)) ??
      (await this.resolveSessionWorkspaceId(user.id));
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString("base64url");
    const scoped = (await this.findWorkspaceScopedUser(user.id, workspaceId)) ?? user;
    // 响应可在写库前计算；令牌中的 sid 只有 rotate 成功创建会话后才会交给客户端。
    const response = await this.buildLoginResponse(
      scoped,
      tenant,
      sessionId,
      workspaceId,
      refreshToken,
      false,
      audience,
    );
    // 旧令牌撤销和新会话创建是同一个原子操作。并发刷新只有一方能成功，且不会
    // 出现“旧会话已撤销、新会话尚未创建”的断档。
    const rotated = await this.identity.rotateAuthSession(session.id, {
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      currentWorkspaceId: workspaceId ?? null,
      audience,
    });
    if (!rotated) throw new UnauthorizedException("会话已被刷新或已失效，请重新登录");
    return response;
  }

  async logout(input: RefreshSessionRequest, audience: AuthAudience = "operator") {
    if (input.refreshToken) {
      const session = await this.identity.getAuthSessionByRefreshHash(hashOpaqueToken(input.refreshToken));
      if (session && this.sessionAudience(session) === audience)
        await this.identity.revokeAuthSession(session.id);
    }
    return { loggedOut: true };
  }

  async changePassword(
    authorization: string | undefined,
    input: ChangePasswordRequest,
    audience: AuthAudience = "operator",
  ): Promise<TLogin> {
    const user = await this.resolveAccessToken(authorization, audience);
    if (!user) throw new UnauthorizedException("请先登录");
    const security = await this.identity.getSecurityBaseline();
    this.assertPasswordPolicy(input.newPassword, security.passwordPolicy);
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException("新密码不能与当前密码相同");
    }
    await this.identity.changeUserPassword(user.id, input.currentPassword, input.newPassword);
    const refreshedUser = await this.identity.findUserById(user.id);
    if (!refreshedUser) throw new UnauthorizedException("账号已停用");
    const tenant = await this.identity.findTenantByIdForAuth(refreshedUser.tenantId);
    await this.identity.recordSecurityAudit({
      tenantId: refreshedUser.tenantId,
      action: "auth.password.changed",
      operator: refreshedUser.displayName,
      targetId: refreshedUser.id,
      detail: "用户已修改密码，其他会话全部失效。",
    });
    return this.issueSession(refreshedUser, tenant, undefined, false, audience);
  }

  async getCurrentUser(authorization?: string, audience: AuthAudience = "operator"): Promise<AuthUser> {
    const context = await this.resolveAccessContext(authorization, { allowInvalidWorkspace: true, audience });
    if (!context) throw new UnauthorizedException("会话已失效，请重新登录");
    return this.toAuthUser(context.user, context.tenantUser);
  }

  async resolveAccessToken(
    authorization?: string,
    audience: AuthAudience = "operator",
  ): Promise<SystemUserRow | undefined> {
    return (await this.resolveAccessContext(authorization, { audience }))?.user;
  }

  protected async issueSession(
    user: SystemUserRow,
    tenant: PlatformTenantSummary,
    requestedWorkspaceId?: string | null,
    needsTenantOnboarding = false,
    audience: AuthAudience = "operator",
  ): Promise<TLogin> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString("base64url");
    // SPACE-02：登录即解析当前经营空间（默认空间优先，否则第一个可进入空间）。
    // 平台管理租户没有成员关系，解析结果为 undefined —— 那是合法状态，
    // 但其会话访问经营接口会被 fail-closed 拒绝。
    const workspaceId = await this.resolveSessionWorkspaceId(user.id, requestedWorkspaceId ?? undefined);
    if (audience === "staff" && (!workspaceId || user.isSaasAdmin)) {
      throw new UnauthorizedException("该账号没有可进入的员工经营空间");
    }
    if (audience === "staff" && !(await this.findWorkspaceScopedUser(user.id, workspaceId))) {
      throw new UnauthorizedException("该账号没有可进入的员工经营空间");
    }
    await this.identity.createAuthSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      currentWorkspaceId: workspaceId ?? null,
      audience,
    });
    // 权限必须按解析出的空间重算：成员关系上的角色与数据范围优先于租户级默认值。
    const scoped = (await this.findWorkspaceScopedUser(user.id, workspaceId)) ?? user;
    return this.buildLoginResponse(
      scoped,
      tenant,
      sessionId,
      workspaceId,
      refreshToken,
      needsTenantOnboarding,
      audience,
    );
  }

  /** 展示配置读取失败时回退平台默认品牌，不影响认证与业务接口。 */
  protected async tenantBranding(tenantId: string): Promise<{
    brandName?: string;
    brandLogoUrl?: string;
    faviconUrl?: string;
    themeColor?: string;
    adminCornerRadius?: number;
    adminContainerRadius?: number;
    adminButtonRadius?: number;
    adminInputRadius?: number;
  }> {
    if (!this.tenantAppearance) return {};
    try {
      return await this.tenantAppearance.getBranding(tenantId);
    } catch (error) {
      this.logger.warn(
        `读取租户 ${tenantId} 的管理后台品牌失败，回退平台默认品牌：${(error as Error).message}`,
      );
      return {};
    }
  }

  /** 账户级主题色读取失败时回退未设置，不影响认证与会话组装。 */
  protected async accountThemeColor(userId: string): Promise<string | undefined> {
    if (!this.accountAppearance) return undefined;
    try {
      return await this.accountAppearance.getThemeColor(userId);
    } catch (error) {
      this.logger.warn(`读取账户 ${userId} 的管理后台主题色失败，回退未设置：${(error as Error).message}`);
      return undefined;
    }
  }

  protected async toAuthUser(user: SystemUserRow, baseUser?: SystemUserRow): Promise<AuthUser> {
    const tenantUser = baseUser ?? (await this.identity.findUserById(user.id));
    if (!tenantUser?.isActive || tenantUser.tenantId !== user.tenantId)
      throw new UnauthorizedException("账号或租户已停用");
    const accountThemeColor = await this.accountThemeColor(user.id);
    return {
      id: user.id,
      tenantId: user.tenantId,
      account: user.account,
      displayName: user.displayName,
      roleIds: user.roleIds,
      roleNames: user.roleNames,
      scope: user.scope,
      dataScope: user.dataScope,
      locationScope: user.locationScope ?? { mode: "all", locationIds: [] },
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      isPlatformAdmin: user.isPlatformAdmin,
      isSaasAdmin: user.isSaasAdmin,
      mustChangePassword: user.mustChangePassword,
      permissions: user.permissions,
      accountThemeColor,
      tenantMembership: {
        permissions: tenantUser.isSaasAdmin ? [] : tenantUser.permissions,
        dataScope: tenantUser.dataScope,
        isTenantAdmin: !tenantUser.isSaasAdmin && tenantUser.isPlatformAdmin,
      },
    };
  }

  protected signAccessToken(payload: AccessTokenPayload) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.sign(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  protected sessionAudience(session: { audience?: string | null }): AuthAudience {
    return session.audience === "staff" ? "staff" : "operator";
  }

  protected verifyAccessToken(token: string): AccessTokenPayload | undefined {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return undefined;
    const expected = Buffer.from(this.sign(`${header}.${body}`));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessTokenPayload;
      return payload.exp > Math.floor(Date.now() / 1000) ? payload : undefined;
    } catch {
      return undefined;
    }
  }

  protected sign(value: string) {
    return createHmac("sha256", this.tokenSecret()).update(value).digest("base64url");
  }

  protected tokenSecret() {
    const configuredSecret = this.configService.get<string>("AUTH_TOKEN_SECRET")?.trim();
    if (configuredSecret) return configuredSecret;
    if (this.configService.get<string>("NODE_ENV") === "production") {
      throw new InternalServerErrorException("生产环境必须配置 AUTH_TOKEN_SECRET");
    }
    return "rental-os-development-secret-change-before-production";
  }

  protected assertPasswordPolicy(
    password: string,
    policy: {
      minLength: number;
      requireLetter: boolean;
      requireNumber: boolean;
      disallowDefaultPassword: boolean;
    },
  ) {
    if (password.length < Math.max(8, policy.minLength)) {
      throw new BadRequestException(`密码长度不能少于 ${Math.max(8, policy.minLength)} 位`);
    }
    if (!/[a-z]/i.test(password)) throw new BadRequestException("密码必须包含字母");
    if (!/\d/.test(password)) throw new BadRequestException("密码必须包含数字");
    if (!/[^a-z0-9]/i.test(password)) throw new BadRequestException("密码必须包含特殊字符");
    if (policy.disallowDefaultPassword && password === "123456")
      throw new BadRequestException("不能使用默认演示密码");
  }

  protected usesPersistentLoginFailureStore() {
    const dataSource =
      this.configService.get<string>("PLATFORM_DATA_SOURCE") ?? process.env.PLATFORM_DATA_SOURCE ?? "mysql";
    return Boolean(this.prisma) && dataSource.trim().toLowerCase() === "mysql";
  }

  protected loginFailureKeyHash(loginKey: string) {
    return createHmac("sha256", `${this.tokenSecret()}:login-lockout-v1`).update(loginKey).digest("hex");
  }

  protected async assertNotLocked(
    loginKey: string,
    policy: { enabled: boolean; maxFailures: number; windowMinutes: number; lockMinutes: number },
  ) {
    if (!policy.enabled) return;
    if (this.usesPersistentLoginFailureStore()) {
      const loginKeyHash = this.loginFailureKeyHash(loginKey);
      const row = await this.prisma!.authLoginFailure.findUnique({ where: { loginKeyHash } });
      const now = new Date();
      if (!row) return;
      if (row.expiresAt <= now) {
        await this.prisma!.authLoginFailure.deleteMany({ where: { loginKeyHash, revision: row.revision } });
        return;
      }
      if (row.lockedUntil && row.lockedUntil > now) {
        const minutes = Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 60_000);
        throw new UnauthorizedException(`登录失败次数过多，请 ${minutes} 分钟后再试`);
      }
      return;
    }
    const state = this.loginFailures.get(loginKey);
    if (state?.lockedUntil && state.lockedUntil > Date.now()) {
      const minutes = Math.ceil((state.lockedUntil - Date.now()) / 60_000);
      throw new UnauthorizedException(`登录失败次数过多，请 ${minutes} 分钟后再试`);
    }
  }

  protected async recordFailedLogin(
    loginKey: string,
    policy: { enabled: boolean; maxFailures: number; windowMinutes: number; lockMinutes: number },
  ) {
    if (!policy.enabled) return;
    if (this.usesPersistentLoginFailureStore()) {
      const loginKeyHash = this.loginFailureKeyHash(loginKey);
      const now = new Date();
      const windowMs = Math.max(1, policy.windowMinutes) * 60_000;
      const lockMs = Math.max(1, policy.lockMinutes) * 60_000;
      const expiresAtFor = (lockedUntil?: Date | null) =>
        new Date(Math.max(now.getTime() + windowMs, lockedUntil?.getTime() ?? 0));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = await this.prisma!.authLoginFailure.findUnique({ where: { loginKeyHash } });
        if (!current) {
          const lockedUntil = policy.maxFailures <= 1 ? new Date(now.getTime() + lockMs) : null;
          try {
            await this.prisma!.authLoginFailure.create({
              data: {
                loginKeyHash,
                failureCount: 1,
                firstFailedAt: now,
                lockedUntil,
                expiresAt: expiresAtFor(lockedUntil),
                revision: 1,
              },
            });
          } catch (error) {
            if ((error as { code?: string })?.code === "P2002") {
              if (attempt === 19)
                throw new InternalServerErrorException("登录失败保护状态并发冲突，请稍后重试");
              continue;
            }
            throw error;
          }
          break;
        }
        const resetWindow = now.getTime() - current.firstFailedAt.getTime() > windowMs;
        const failureCount = resetWindow ? 1 : current.failureCount + 1;
        const firstFailedAt = resetWindow ? now : current.firstFailedAt;
        const lockedUntil = failureCount >= policy.maxFailures ? new Date(now.getTime() + lockMs) : null;
        const updated = await this.prisma!.authLoginFailure.updateMany({
          where: { loginKeyHash, revision: current.revision },
          data: {
            failureCount,
            firstFailedAt,
            lockedUntil,
            expiresAt: expiresAtFor(lockedUntil),
            revision: { increment: 1 },
          },
        });
        if (updated.count === 1) break;
        if (attempt === 19) throw new InternalServerErrorException("登录失败保护状态并发冲突，请稍后重试");
      }
      this.failedLoginPruneCounter += 1;
      if (this.failedLoginPruneCounter % 128 === 0) {
        await this.prisma!.authLoginFailure.deleteMany({ where: { expiresAt: { lt: now } } });
      }
      return;
    }
    const now = Date.now();
    const current = this.loginFailures.get(loginKey);
    const state =
      current && now - current.firstFailedAt <= policy.windowMinutes * 60_000
        ? current
        : { count: 0, firstFailedAt: now };
    state.count += 1;
    if (state.count >= policy.maxFailures) state.lockedUntil = now + policy.lockMinutes * 60_000;
    this.loginFailures.set(loginKey, state);
  }

  protected async clearFailedLogin(loginKey: string) {
    this.loginFailures.delete(loginKey);
    if (this.usesPersistentLoginFailureStore()) {
      await this.prisma!.authLoginFailure.deleteMany({
        where: { loginKeyHash: this.loginFailureKeyHash(loginKey) },
      });
    }
  }
}
