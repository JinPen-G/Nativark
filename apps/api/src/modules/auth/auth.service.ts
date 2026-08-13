import {
  BadRequestException,
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

  async resolveAccessToken(authorization?: string): Promise<SystemUserRow | undefined> {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return undefined;
    const payload = this.verifyAccessToken(token);
    if (!payload) return undefined;
    const session = await this.platformService.getAuthSession(payload.sid);
    if (!session || session.userId !== payload.sub) return undefined;
    const user = await this.platformService.findUserById(payload.sub);
    return user?.tenantId === payload.tid ? user : undefined;
  }

  private async issueSession(
    user: SystemUserRow,
    tenant: Awaited<ReturnType<PlatformService["findTenantByIdForAuth"]>>
  ): Promise<LoginResponse> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString("base64url");
    await this.platformService.createAuthSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs)
    });
    const now = Math.floor(Date.now() / 1000);
    const accessToken = this.signAccessToken({
      sub: user.id,
      tid: user.tenantId,
      sid: sessionId,
      iat: now,
      exp: now + this.accessTtlSeconds
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSeconds,
      tenant: {
        tenantId: tenant.tenantId,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.tenantName,
        tenantStatus: tenant.tenantStatus,
        categoryCode: tenant.categoryCode,
        categoryName: tenant.categoryName
      },
      user: this.toAuthUser(user)
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
