import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RefreshSessionRequest,
  SystemUserRow
} from "@store-rental/shared";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hashOpaqueToken } from "../../common/password";
import { PlatformService } from "../platform/platform.service";

interface LoginFailureState {
  count: number;
  firstFailedAt: number;
  lockedUntil?: number;
}

interface AccessTokenPayload {
  sub: string;
  tid: string;
  sid: string;
  /**
   * SPACE-02：当前经营空间。可选——平台管理租户没有经营空间。
   *
   * 令牌里带它只为让下游少查一次库；**权威仍是会话行**：
   * resolveAccessContext 以 session.currentWorkspaceId 为准，
   * 否则用旧令牌就能在切换空间后继续访问原空间。
   */
  wid?: string;
  iat: number;
  exp: number;
}

@Injectable()
export class AuthService {
  private readonly loginFailures = new Map<string, LoginFailureState>();
  private readonly accessTtlSeconds = 15 * 60;
  private readonly refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly platformService: PlatformService,
    private readonly configService: ConfigService
  ) {}

  async login(input: LoginRequest): Promise<LoginResponse> {
    const tenantCode = input.tenantCode.trim().toLowerCase();
    const account = input.account.trim();
    if (!tenantCode || !account || !input.password) {
      throw new BadRequestException("租户编码、账号和密码不能为空");
    }
    const security = await this.platformService.getSecurityBaseline();
    const loginKey = `${tenantCode}:${account}`.toLowerCase();
    this.assertNotLocked(loginKey);

    const loginResult = await this.platformService.findUserForLogin(
      tenantCode,
      account,
      input.password
    );
    if (!loginResult) {
      this.recordFailedLogin(loginKey, security.loginRateLimit);
      await this.platformService.recordSecurityAudit({
        tenantCode,
        action: "auth.login.failed",
        operator: account,
        targetId: account,
        detail: "登录失败：租户、账号或密码不正确，或租户已冻结。"
      });
      throw new UnauthorizedException("租户、账号或密码不正确");
    }

    this.loginFailures.delete(loginKey);
    await this.platformService.recordSecurityAudit({
      tenantId: loginResult.tenant.tenantId,
      action: "auth.login.success",
      operator: loginResult.user.displayName,
      targetId: loginResult.user.id,
      detail: "登录成功。"
    });
    return this.issueSession(loginResult.user, loginResult.tenant);
  }

  async refresh(input: RefreshSessionRequest): Promise<LoginResponse> {
    if (!input.refreshToken) throw new UnauthorizedException("刷新令牌缺失");
    const session = await this.platformService.getAuthSessionByRefreshHash(
      hashOpaqueToken(input.refreshToken)
    );
    if (!session) throw new UnauthorizedException("会话已失效，请重新登录");
    const user = await this.platformService.findUserById(session.userId);
    if (!user) throw new UnauthorizedException("账号或租户已停用");
    const tenant = await this.platformService.findTenantByIdForAuth(user.tenantId);
    await this.platformService.revokeAuthSession(session.id);
    return this.issueSession(user, tenant);
  }

  async logout(input: RefreshSessionRequest) {
    if (input.refreshToken) {
      const session = await this.platformService.getAuthSessionByRefreshHash(
        hashOpaqueToken(input.refreshToken)
      );
      if (session) await this.platformService.revokeAuthSession(session.id);
    }
    return { loggedOut: true };
  }

  async changePassword(
    authorization: string | undefined,
    input: ChangePasswordRequest
  ): Promise<LoginResponse> {
    const user = await this.resolveAccessToken(authorization);
    if (!user) throw new UnauthorizedException("请先登录");
    const security = await this.platformService.getSecurityBaseline();
    this.assertPasswordPolicy(input.newPassword, security.passwordPolicy);
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException("新密码不能与当前密码相同");
    }
    await this.platformService.changeUserPassword(
      user.id,
      input.currentPassword,
      input.newPassword
    );
    const refreshedUser = await this.platformService.findUserById(user.id);
    if (!refreshedUser) throw new UnauthorizedException("账号已停用");
    const tenant = await this.platformService.findTenantByIdForAuth(refreshedUser.tenantId);
    await this.platformService.recordSecurityAudit({
      tenantId: refreshedUser.tenantId,
      action: "auth.password.changed",
      operator: refreshedUser.displayName,
      targetId: refreshedUser.id,
      detail: "用户已修改密码，其他会话全部失效。"
    });
    return this.issueSession(refreshedUser, tenant);
  }

  async getCurrentUser(authorization?: string): Promise<AuthUser> {
    const user = await this.resolveAccessToken(authorization);
    if (!user) throw new UnauthorizedException("会话已失效，请重新登录");
    return this.toAuthUser(user);
  }

  async getSessionContext(authorization?: string) {
    const user = await this.resolveAccessToken(authorization);
    if (!user) throw new UnauthorizedException("会话已失效，请重新登录");
    const tenant = await this.platformService.findTenantByIdForAuth(user.tenantId);
    return {
      tenant: {
        tenantId: tenant.tenantId,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.tenantName,
        tenantStatus: tenant.tenantStatus,
        categoryCode: tenant.categoryCode,
        categoryName: tenant.categoryName,
        capabilities: tenant.capabilities
      },
      user: this.toAuthUser(user)
    };
  }

  getTenantContext(tenantId: string) {
    return this.platformService.findTenantByIdForAuth(tenantId);
  }

  async resolveAccessToken(authorization?: string): Promise<SystemUserRow | undefined> {
    return (await this.resolveAccessContext(authorization))?.user;
  }

  /**
   * SPACE-02：解析访问令牌，同时给出当前经营空间与**按该空间生效**的权限。
   *
   * 当前空间取自会话行而不是令牌：切换空间后旧令牌仍在有效期内，
   * 若信任令牌里的 wid，旧令牌就能继续访问切换前的空间。
   * 令牌里的 wid 只作提示，不作判据。
   */
  async resolveAccessContext(
    authorization?: string
  ): Promise<{ user: SystemUserRow; workspaceId?: string; hasWorkspaces: boolean } | undefined> {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return undefined;
    const payload = this.verifyAccessToken(token);
    if (!payload) return undefined;
    const session = await this.platformService.getAuthSession(payload.sid);
    if (!session || session.userId !== payload.sub) return undefined;
    const workspaceId = session.currentWorkspaceId ?? undefined;
    const user = await this.platformService.findWorkspaceScopedUser(payload.sub, workspaceId);
    if (!user || user.tenantId !== payload.tid) return undefined;
    // hasWorkspaces 用于区分两种"没有当前空间"：
    //   - 该账号本来就有可进入空间却没选（必须 fail-closed，让它去选）
    //   - 该账号一个可进入空间都没有（平台管理租户、内存演示模式）——
    //     这类会话不该被空间检查拦住，它们的边界由 SaaS 管理员白名单与
    //     SPACE-03 的事实层空间条件负责。
    const hasWorkspaces = workspaceId
      ? true
      : (await this.platformService.listUserWorkspaces(payload.sub)).length > 0;
    return { user, workspaceId, hasWorkspaces };
  }

  /** SPACE-02：切换当前经营空间。校验成员资格与空间状态后重新签发访问令牌。 */
  async switchWorkspace(authorization: string | undefined, workspaceId: string): Promise<LoginResponse> {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    const payload = token ? this.verifyAccessToken(token) : undefined;
    if (!payload) throw new UnauthorizedException("会话已失效，请重新登录");
    const session = await this.platformService.getAuthSession(payload.sid);
    if (!session || session.userId !== payload.sub) throw new UnauthorizedException("会话已失效，请重新登录");
    if (!workspaceId?.trim()) throw new BadRequestException("经营空间不能为空");
    // 逐项校验成员关系与空间状态；无权或已冻结/停用在此抛 403。
    const resolved = await this.platformService.resolveSessionWorkspaceId(payload.sub, workspaceId.trim());
    if (!resolved) throw new ForbiddenException("无权进入该经营空间");
    await this.platformService.setSessionWorkspace(session.id, resolved);
    const user = await this.platformService.findWorkspaceScopedUser(payload.sub, resolved);
    if (!user) throw new UnauthorizedException("账号已停用");
    const tenant = await this.platformService.findTenantByIdForAuth(user.tenantId);
    // 复用现有会话（refreshToken 不变），只换访问令牌与其携带的 wid。
    return this.buildLoginResponse(user, tenant, session.id, resolved, undefined);
  }

  private async issueSession(
    user: SystemUserRow,
    tenant: Awaited<ReturnType<PlatformService["findTenantByIdForAuth"]>>
  ): Promise<LoginResponse> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString("base64url");
    // SPACE-02：登录即解析当前经营空间（默认空间优先，否则第一个可进入空间）。
    // 平台管理租户没有成员关系，解析结果为 undefined —— 那是合法状态，
    // 但其会话访问经营接口会被 fail-closed 拒绝。
    const workspaceId = await this.platformService.resolveSessionWorkspaceId(user.id);
    await this.platformService.createAuthSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      currentWorkspaceId: workspaceId ?? null
    });
    // 权限必须按解析出的空间重算：成员关系上的角色与数据范围优先于租户级默认值。
    const scoped = (await this.platformService.findWorkspaceScopedUser(user.id, workspaceId)) ?? user;
    return this.buildLoginResponse(scoped, tenant, sessionId, workspaceId, refreshToken);
  }

  /**
   * 组装登录/切换响应。切换时不换 refreshToken（会话本身没变），
   * 因此 refreshToken 允许为空并原样回传空串以外的既有值由调用方决定。
   */
  private async buildLoginResponse(
    user: SystemUserRow,
    tenant: Awaited<ReturnType<PlatformService["findTenantByIdForAuth"]>>,
    sessionId: string,
    workspaceId: string | undefined,
    refreshToken: string | undefined
  ): Promise<LoginResponse> {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = this.signAccessToken({
      sub: user.id,
      tid: user.tenantId,
      sid: sessionId,
      wid: workspaceId,
      iat: now,
      exp: now + this.accessTtlSeconds
    });
    const workspaces = await this.platformService.listUserWorkspaces(user.id);
    return {
      accessToken,
      refreshToken: refreshToken ?? "",
      expiresIn: this.accessTtlSeconds,
      tenant: {
        tenantId: tenant.tenantId,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.tenantName,
        tenantStatus: tenant.tenantStatus,
        categoryCode: tenant.categoryCode,
        categoryName: tenant.categoryName,
        capabilities: tenant.capabilities
      },
      user: this.toAuthUser(user),
      // SPACE-02：登录返回可进入的空间与当前空间，供前端渲染切换器（前端属 SPACE-05）。
      workspaces,
      currentWorkspaceId: workspaceId
    };
  }

  private toAuthUser(user: SystemUserRow): AuthUser {
    return {
      id: user.id,
      tenantId: user.tenantId,
      account: user.account,
      displayName: user.displayName,
      roleIds: user.roleIds,
      roleNames: user.roleNames,
      scope: user.scope,
      dataScope: user.dataScope,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      isPlatformAdmin: user.isPlatformAdmin,
      isSaasAdmin: user.isSaasAdmin,
      mustChangePassword: user.mustChangePassword,
      permissions: user.permissions
    };
  }

  private signAccessToken(payload: AccessTokenPayload) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.sign(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  private verifyAccessToken(token: string): AccessTokenPayload | undefined {
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

  private sign(value: string) {
    return createHmac("sha256", this.tokenSecret()).update(value).digest("base64url");
  }

  private tokenSecret() {
    const configuredSecret = this.configService.get<string>("AUTH_TOKEN_SECRET")?.trim();
    if (configuredSecret) return configuredSecret;
    if (this.configService.get<string>("NODE_ENV") === "production") {
      throw new InternalServerErrorException("生产环境必须配置 AUTH_TOKEN_SECRET");
    }
    return "rental-os-development-secret-change-before-production";
  }

  private assertPasswordPolicy(
    password: string,
    policy: { minLength: number; requireLetter: boolean; requireNumber: boolean; disallowDefaultPassword: boolean }
  ) {
    if (password.length < Math.max(8, policy.minLength)) {
      throw new BadRequestException(`密码长度不能少于 ${Math.max(8, policy.minLength)} 位`);
    }
    if (!/[a-z]/i.test(password)) throw new BadRequestException("密码必须包含字母");
    if (!/\d/.test(password)) throw new BadRequestException("密码必须包含数字");
    if (!/[^a-z0-9]/i.test(password)) throw new BadRequestException("密码必须包含特殊字符");
    if (policy.disallowDefaultPassword && password === "123456") throw new BadRequestException("不能使用默认演示密码");
  }

  private assertNotLocked(loginKey: string) {
    const state = this.loginFailures.get(loginKey);
    if (state?.lockedUntil && state.lockedUntil > Date.now()) {
      const minutes = Math.ceil((state.lockedUntil - Date.now()) / 60_000);
      throw new UnauthorizedException(`登录失败次数过多，请 ${minutes} 分钟后再试`);
    }
  }

  private recordFailedLogin(
    loginKey: string,
    policy: { enabled: boolean; maxFailures: number; windowMinutes: number; lockMinutes: number }
  ) {
    if (!policy.enabled) return;
    const now = Date.now();
    const current = this.loginFailures.get(loginKey);
    const state = current && now - current.firstFailedAt <= policy.windowMinutes * 60_000
      ? current
      : { count: 0, firstFailedAt: now };
    state.count += 1;
    if (state.count >= policy.maxFailures) state.lockedUntil = now + policy.lockMinutes * 60_000;
    this.loginFailures.set(loginKey, state);
  }
}
