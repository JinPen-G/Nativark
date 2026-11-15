/** 公共operator会话适配：复用原签名/刷新/改密，不解析或创建任何行业空间。 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PlatformLoginResponse, PlatformTenantSummary, SystemUserRow } from "@rental-os/shared/platform";
import {
  AuthSessionService,
  type AuthAudience,
  type PlatformAuthAccessContext,
} from "./auth-session.service";
import { PlatformAuthenticationRepository } from "../platform/platform-authentication.source";
import { PLATFORM_AUTH_DATA_STORE, type PlatformAuthDataStore } from "../platform/platform-auth-data-store";
import { TenantAppearanceProfileService } from "../client/tenant-appearance-profile.service";
import { AccountAppearanceService } from "../client/account-appearance.service";

@Injectable()
export class PlatformAuthService extends AuthSessionService<
  PlatformLoginResponse,
  PlatformAuthAccessContext
> {
  constructor(
    identity: PlatformAuthenticationRepository,
    config: ConfigService,
    tenantAppearance: TenantAppearanceProfileService,
    accountAppearance: AccountAppearanceService,
    @Inject(PLATFORM_AUTH_DATA_STORE) database: PlatformAuthDataStore,
  ) {
    super(identity, config, tenantAppearance, accountAppearance, database);
  }

  async resolveAccessContext(
    authorization?: string,
    options: { audience?: AuthAudience } = {},
  ): Promise<PlatformAuthAccessContext | undefined> {
    if (options.audience === "staff") return undefined;
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return undefined;
    const payload = this.verifyAccessToken(token);
    if (!payload || (payload.aud ?? "operator") !== "operator") return undefined;
    const session = await this.identity.getAuthSession(payload.sid);
    if (!session || session.userId !== payload.sub || this.sessionAudience(session) !== "operator")
      return undefined;
    if ((payload.wid ?? null) !== session.currentWorkspaceId)
      throw new ConflictException("原会话范围已变化，请刷新页面后核对");
    const user = await this.identity.findUserById(payload.sub);
    if (!user?.isActive || user.tenantId !== payload.tid) return undefined;
    // 原会话可能仍关联已移除Core的空间；公共操作只消费租户身份，绝不沿旧ID恢复业务权。
    return {
      user,
      tenantUser: user,
      hasWorkspaces: false,
      workspaceValid: false,
      accessSession: { sessionId: payload.sid, expiresAt: payload.exp },
    };
  }

  async getSessionContext(authorization?: string) {
    const context = await this.resolveAccessContext(authorization);
    if (!context) throw new UnauthorizedException("会话已失效，请重新登录");
    const tenant = await this.identity.findTenantByIdForAuth(context.user.tenantId);
    return {
      tenant: { ...tenant, ...(context.user.isSaasAdmin ? {} : await this.tenantBranding(tenant.tenantId)) },
      user: await this.toAuthUser(context.user, context.tenantUser),
    };
  }

  protected async resolveSessionWorkspaceId(_userId: string, _requested?: string): Promise<undefined> {
    // 刷新原签名会话时可进入公共面；新令牌不保留已移除Core的业务范围。
    return undefined;
  }

  protected findWorkspaceScopedUser(userId: string, workspaceId?: string) {
    if (workspaceId) return Promise.resolve(undefined);
    return this.identity.findUserById(userId);
  }

  protected async buildLoginResponse(
    user: SystemUserRow,
    tenant: PlatformTenantSummary,
    sessionId: string,
    workspaceId: string | undefined,
    refreshToken: string | undefined,
    _needsTenantOnboarding = false,
    audience: AuthAudience = "operator",
  ): Promise<PlatformLoginResponse> {
    if (audience !== "operator" || workspaceId)
      throw new ForbiddenException("公共宿主不签发业务空间或员工会话");
    const now = Math.floor(Date.now() / 1000);
    return {
      accessToken: this.signAccessToken({
        sub: user.id,
        tid: user.tenantId,
        sid: sessionId,
        aud: audience,
        iat: now,
        exp: now + this.accessTtlSeconds,
      }),
      refreshToken: refreshToken ?? "",
      expiresIn: this.accessTtlSeconds,
      tenant: { ...tenant, ...(user.isSaasAdmin ? {} : await this.tenantBranding(tenant.tenantId)) },
      user: await this.toAuthUser(user),
      needsTenantOnboarding: false,
    };
  }
}
