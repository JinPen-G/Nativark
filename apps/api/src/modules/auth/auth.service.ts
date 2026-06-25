import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  AuthUser,
  LoginRequest,
  LoginResponse,
  RoleScope
} from "@store-rental/shared";
import { PlatformService } from "../platform/platform.service";

interface LoginFailureState {
  count: number;
  firstFailedAt: number;
  lockedUntil?: number;
}

@Injectable()
export class AuthService {
  private readonly loginFailures = new Map<string, LoginFailureState>();

  constructor(private readonly platformService: PlatformService) {}

  async login(input: LoginRequest): Promise<LoginResponse> {
    const tenantCode = input.tenantCode.trim() || "demo";
    const account = input.account.trim() || "admin";
    const security = await this.platformService.getSecurityBaseline();
    const loginKey = `${tenantCode}:${account}`.toLowerCase();

    this.assertPasswordPolicy(input.password, security.passwordPolicy);
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
        detail: "登录失败：租户、账号或密码不正确。"
      });
      throw new UnauthorizedException("租户、账号或密码不正确");
    }

    const { tenant, user } = loginResult;
    this.loginFailures.delete(loginKey);
    await this.platformService.recordSecurityAudit({
      tenantId: tenant.tenantId,
      action: "auth.login.success",
      operator: user.displayName || user.account,
      targetId: user.id,
      detail: "登录成功。"
    });

    return {
      accessToken: `mock-token.${tenantCode}.${account}`,
      tenant: {
        tenantId: tenant.tenantId,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.tenantName,
        tenantStatus: tenant.tenantStatus
      },
      user: {
        id: user.id,
        account: user.account,
        displayName: user.displayName,
        roleIds: user.roleIds,
        roleNames: user.roleNames,
        scope: user.scope,
        dataScope: user.dataScope,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
        isPlatformAdmin: user.isPlatformAdmin,
        permissions: user.permissions
      }
    };
  }

  async getCurrentUser(authorization?: string): Promise<AuthUser> {
    const user = await this.platformService.findUserByToken(authorization);
    return {
      id: user.id,
      account: user.account,
      displayName: user.displayName,
      roleIds: user.roleIds,
      roleNames: user.roleNames,
      scope: user.scope ?? RoleScope.Operator,
      dataScope: user.dataScope,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      isPlatformAdmin: user.isPlatformAdmin,
      permissions: user.permissions
    };
  }

  private assertPasswordPolicy(
    password: string,
    policy: {
      minLength: number;
      requireLetter: boolean;
      requireNumber: boolean;
      disallowDefaultPassword: boolean;
    }
  ) {
    if (password.length < policy.minLength) {
      throw new BadRequestException(`密码长度不能少于 ${policy.minLength} 位`);
    }
    if (policy.requireLetter && !/[a-z]/i.test(password)) {
      throw new BadRequestException("密码必须包含字母");
    }
    if (policy.requireNumber && !/\d/.test(password)) {
      throw new BadRequestException("密码必须包含数字");
    }
    if (policy.disallowDefaultPassword && password === "123456") {
      throw new BadRequestException("默认演示密码已被当前策略禁止");
    }
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
    policy: {
      enabled: boolean;
      maxFailures: number;
      windowMinutes: number;
      lockMinutes: number;
    }
  ) {
    if (!policy.enabled) {
      return;
    }

    const now = Date.now();
    const windowMs = policy.windowMinutes * 60_000;
    const current = this.loginFailures.get(loginKey);
    const state =
      current && now - current.firstFailedAt <= windowMs
        ? current
        : { count: 0, firstFailedAt: now };

    state.count += 1;
    if (state.count >= policy.maxFailures) {
      state.lockedUntil = now + policy.lockMinutes * 60_000;
    }
    this.loginFailures.set(loginKey, state);
  }
}
