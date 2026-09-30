import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RefreshSessionRequest,
  RentalCapability,
  ResetLocalDemoPasswordResult,
  SystemUserRow
} from "@rental-os/shared";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { hashOpaqueToken } from "../../common/password";
import { PrismaService } from "../database/prisma.service";
import { ClientChannelProfileService } from "../client/client-channel-profile.service";
import { PlatformService } from "../platform/platform.service";
import { WorkspaceCapabilityService } from "../rental-core/workspace-capability.service";

interface LoginFailureState {
  count: number;
  firstFailedAt: number;
  lockedUntil?: number;
}

interface AccessTokenPayload {
  sub: string;
  tid: string;
  sid: string;
  /** 登录界面受众；旧令牌缺省按 operator 处理，staff 令牌必须显式携带。 */
  aud?: AuthAudience;
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

export type AuthAudience = "operator" | "staff";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly loginFailures = new Map<string, LoginFailureState>();
  private failedLoginPruneCounter = 0;
  private readonly accessTtlSeconds = 15 * 60;
  private readonly refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly platformService: PlatformService,
    private readonly configService: ConfigService,
    // CORE-EXT-02C：会话上下文里的能力集改为「已启用实例」。可选是为了让既有单测
    // 继续用两个参数构造本服务；缺失时返回空启用集（fail-closed），不回退到品类声明。
    @Optional() private readonly capabilities?: WorkspaceCapabilityService,
    // 主题色是展示配置，不应阻断登录；可选依赖也兼容无数据库的内存测试模式。
    @Optional() private readonly clientChannelProfile?: ClientChannelProfileService,
    // AUTH-LOCKOUT-01：持久化跨进程失败计数；测试/纯内存模式继续使用进程内后备实现。
    @Optional() private readonly prisma?: PrismaService
  ) {}

  async login(input: LoginRequest, audience: AuthAudience = "operator"): Promise<LoginResponse> {
    const tenantCode = input.tenantCode.trim().toLowerCase();
    const account = input.account.trim();
    if (!tenantCode || !account || !input.password) {
      throw new BadRequestException("租户编码、账号和密码不能为空");
    }
    const security = await this.platformService.getSecurityBaseline();
    const loginKey = `${tenantCode}:${account}`.toLowerCase();
    await this.assertNotLocked(loginKey, security.loginRateLimit);

    const loginResult = await this.platformService.findUserForLogin(
      tenantCode,
      account,
      input.password
    );
    if (!loginResult) {
      await this.recordFailedLogin(loginKey, security.loginRateLimit);
      await this.platformService.recordSecurityAudit({
        tenantCode,
        action: "auth.login.failed",
        operator: account,
        targetId: account,
        detail: "登录失败：租户、账号或密码不正确，或租户已冻结。"
      });
      throw new UnauthorizedException("租户、账号或密码不正确");
    }

    await this.clearFailedLogin(loginKey);
    await this.platformService.recordSecurityAudit({
      tenantId: loginResult.tenant.tenantId,
      action: "auth.login.success",
      operator: loginResult.user.displayName,
      targetId: loginResult.user.id,
      detail: "登录成功。"
    });
    if (audience === "staff" && loginResult.user.isSaasAdmin) {
      throw new UnauthorizedException("该账号不能登录租户员工端");
    }
    return this.issueSession(
      loginResult.user,
      loginResult.tenant,
      undefined,
      loginResult.needsTenantOnboarding,
      audience
    );
  }

  /**
   * 仅非生产环境的本地演示重置。此处刻意只返回固定账号标识，不返回提交的密码；
   * 密码由下游立即哈希，且全部既有会话都会失效。
   */
  async resetLocalDemoPassword(password: string): Promise<ResetLocalDemoPasswordResult> {
    if (this.configService.get<string>("NODE_ENV") === "production") {
      throw new ForbiddenException("生产环境不提供演示账号密码重置入口");
    }
    const security = await this.platformService.getSecurityBaseline();
    this.assertPasswordPolicy(password, security.passwordPolicy);
    await this.platformService.setLocalDemoAccountPassword(password);
    // 重置这三个演示账号时，只清理它们各自的失败计数。清空整张表会让其他租户
    // 的锁定状态被本地开发操作解除，既越出目标范围，也会削弱跨账号暴力破解保护。
    const demoLoginKeyHashes = ["demo:admin", "demo2:admin", "platform:admin"]
      .map((key) => this.loginFailureKeyHash(key));
    for (const key of ["demo:admin", "demo2:admin", "platform:admin"]) this.loginFailures.delete(key);
    if (this.usesPersistentLoginFailureStore()) {
      await this.prisma!.authLoginFailure.deleteMany({ where: { loginKeyHash: { in: demoLoginKeyHashes } } });
    }
    return {
      reset: true,
      accounts: ["demo/admin", "demo2/admin", "platform/admin"]
    };
  }

  async refresh(input: RefreshSessionRequest, audience: AuthAudience = "operator"): Promise<LoginResponse> {
    if (!input.refreshToken) throw new UnauthorizedException("刷新令牌缺失");
    const session = await this.platformService.getAuthSessionByRefreshHash(
      hashOpaqueToken(input.refreshToken)
    );
    if (!session || this.sessionAudience(session) !== audience) throw new UnauthorizedException("会话已失效，请重新登录");
    const user = await this.platformService.findUserById(session.userId);
    if (!user) throw new UnauthorizedException("账号或租户已停用");
    const tenant = await this.platformService.findTenantByIdForAuth(user.tenantId);
    // 续期优先保留当前空间；空间在会话存续期内被撤销或停用时，退回账号仍可进入
    // 的默认空间。先解析再轮换，避免拿到新令牌后才发现上下文无效。
    const workspaceId =
      (await this.platformService.resolveSessionWorkspaceId(user.id, session.currentWorkspaceId ?? undefined)) ??
      (await this.platformService.resolveSessionWorkspaceId(user.id));
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString("base64url");
    const scoped = (await this.platformService.findWorkspaceScopedUser(user.id, workspaceId)) ?? user;
    // 响应可在写库前计算；令牌中的 sid 只有 rotate 成功创建会话后才会交给客户端。
    const response = await this.buildLoginResponse(scoped, tenant, sessionId, workspaceId, refreshToken, false, audience);
    // 旧令牌撤销和新会话创建是同一个原子操作。并发刷新只有一方能成功，且不会
    // 出现“旧会话已撤销、新会话尚未创建”的断档。
    const rotated = await this.platformService.rotateAuthSession(session.id, {
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      currentWorkspaceId: workspaceId ?? null,
      audience
    });
    if (!rotated) throw new UnauthorizedException("会话已被刷新或已失效，请重新登录");
    return response;
  }

  async logout(input: RefreshSessionRequest, audience: AuthAudience = "operator") {
    if (input.refreshToken) {
      const session = await this.platformService.getAuthSessionByRefreshHash(
        hashOpaqueToken(input.refreshToken)
      );
      if (session && this.sessionAudience(session) === audience) await this.platformService.revokeAuthSession(session.id);
    }
    return { loggedOut: true };
  }

  async changePassword(
    authorization: string | undefined,
    input: ChangePasswordRequest,
    audience: AuthAudience = "operator"
  ): Promise<LoginResponse> {
    const user = await this.resolveAccessToken(authorization, audience);
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
    return this.issueSession(refreshedUser, tenant, undefined, false, audience);
  }

  async getCurrentUser(authorization?: string, audience: AuthAudience = "operator"): Promise<AuthUser> {
    const context = await this.resolveAccessContext(authorization, { allowInvalidWorkspace: true, audience });
    if (!context) throw new UnauthorizedException("会话已失效，请重新登录");
    return this.toAuthUser(context.user, context.tenantUser);
  }

  async assertLegacyVehicleDomainWorkspace(tenantId: string, workspaceId?: string) {
    if (!workspaceId || !(await this.platformService.isLegacyVehicleDomainWorkspaceAllowed(tenantId, workspaceId))) {
      throw new ForbiddenException("旧车辆兼容接口仅允许默认车辆经营空间使用，空间级迁移完成前请使用 Rental Core 接口");
    }
  }

  async getSessionContext(authorization?: string, audience: AuthAudience = "operator") {
    const context = await this.resolveAccessContext(authorization, { allowInvalidWorkspace: true, audience });
    const user = context?.user;
    if (!user) throw new UnauthorizedException("会话已失效，请重新登录");
    const workspaceId = context.workspaceValid ? context.workspaceId : undefined;
    // SPACE-05：品类与能力按**当前经营空间**取。
    //
    // 原先固定取租户级档案，于是刷新页面后停留在非默认空间的会话会显示
    // 另一个空间的品类与 capability——前端据此渲染菜单，等于换了空间却
    // 沿用旧品类的界面。这与 Guard 的判定口径也不一致。
    const scope = await this.getCategoryContext(user.tenantId, workspaceId);
    const tenant = await this.platformService.findTenantByIdForAuth(user.tenantId);
    const branding = user.isSaasAdmin ? {} : await this.tenantBranding(tenant.tenantId);
    // CORE-EXT-02C：菜单入口按**已启用能力**判定，不再按品类声明。
    //
    // `scope.capabilities` 是品类定义的 `defaultCapabilities`，即「这个品类可能相关的
    // 能力」。前端 `hasCapability` 早前直接用它渲染菜单，于是只有 code、没有可执行模块
    // 的能力也会长出入口，暂停与停用更是完全无法反映（数组里永远有它）。
    // 现在换成该空间的已启用实例，与 Guard 的判定口径一致——否则会出现
    // 「菜单可见但一点就 403」或反之的错位。
    const capabilityView = workspaceId ? await this.capabilityOverviewFor(user.tenantId, workspaceId) : undefined;
    return {
      tenant: {
        tenantId: tenant.tenantId,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.tenantName,
        tenantStatus: tenant.tenantStatus,
        ...branding,
        categoryCode: scope.categoryCode,
        categoryName: scope.categoryName,
        capabilities: capabilityView?.enabled ?? []
      },
      user: await this.toAuthUser(user, context.tenantUser),
      // 刷新页面后切换器仍需知道「在哪、能去哪」，因此这里必须带出空间列表。
      workspaces: await this.platformService.listUserWorkspaces(user.id),
      currentWorkspaceId: workspaceId,
      locationScope: context.user.locationScope ?? { mode: "all", locationIds: [] },
      missingRequiredCapabilities: capabilityView?.missingRequired ?? [],
      capabilityProductionReady: capabilityView?.productionReady ?? false,
      workspaceRunMode: capabilityView?.runMode
    };
  }

  /**
   * 该空间的已启用能力、缺失必选能力与生产就绪标记。
   *
   * 没有注入能力服务时返回「空启用集 + 未就绪」而不是回退到品类声明：
   * 回退会让菜单在装配被改坏时重新按声明放行，正是本任务要消除的 fail-open。
   */
  private async capabilityOverviewFor(tenantId: string, workspaceId: string) {
    const failClosed = { enabled: [] as RentalCapability[], missingRequired: [] as RentalCapability[], productionReady: false, runMode: undefined };
    if (!this.capabilities) return failClosed;
    try {
      const overview = await this.capabilities.overview(tenantId, workspaceId);
      return {
        enabled: overview.capabilities.filter((row) => row.state === "enabled").map((row) => row.definition.code),
        missingRequired: overview.missingRequired,
        productionReady: overview.productionReady,
        // 前端据此明确标注「演示 / 开发空间」，而不是只靠 productionReady 猜。
        runMode: await this.capabilities.workspaceRunMode(tenantId, workspaceId)
      };
    } catch (error) {
      // 能力范围解析失败**不得**让登录或会话上下文整体失败。
      //
      // 这里的取值只服务于「菜单入口显示什么」；解析不出来时返回空启用集是 fail-closed
      // 的方向（少显示入口，不多显示），而 API 侧的放行由 Guard 独立判定，不依赖这份结果。
      // 反过来，让它把登录打成 500 才是真的危险：运营连不进来，连去修的入口都没有。
      // 失败必须留日志，不能静默——它通常意味着空间或品类数据不一致。
      this.logger.warn(
        `解析经营空间 ${workspaceId} 的能力范围失败，本次会话按空启用集处理：${(error as Error).message}`
      );
      return failClosed;
    }
  }

  /** SPACE-03：有会话空间时按空间取品类与能力；无空间时退回租户级档案。 */
  async getCategoryContext(tenantId: string, workspaceId?: string) {
    if (workspaceId) {
      const scoped = await this.platformService.getWorkspaceCategoryContext(tenantId, workspaceId);
      // 会话里有明确的空间，就必须用那个空间的品类判定，解析不出来要拒绝而不是放行。
      //
      // 早前这里在 `!scoped.categoryCode` 时退回 getTenantContext——那是 fail-open：
      // 租户级档案的品类是「最后一个持久化配置的空间」的品类，于是守卫会用**另一个
      // 空间**的能力集给当前请求放行。空间存在而品类查不到只有两种成因：空间被删了，
      // 或数据坏了；两者都该让请求失败，而不是借用别处的品类。
      if (!scoped.categoryCode) {
        throw new ForbiddenException("当前经营空间不存在或经营品类缺失，请重新选择经营空间");
      }
      return scoped;
    }
    return this.getTenantContext(tenantId);
  }

  getTenantContext(tenantId: string) {
    return this.platformService.findTenantByIdForAuth(tenantId);
  }

  async resolveAccessToken(authorization?: string, audience: AuthAudience = "operator"): Promise<SystemUserRow | undefined> {
    return (await this.resolveAccessContext(authorization, { audience }))?.user;
  }

  /**
   * SPACE-02：解析访问令牌，同时给出当前经营空间与**按该空间生效**的权限。
   *
   * 当前空间取自会话行而不是令牌：切换空间后旧令牌仍在有效期内，
   * 若信任令牌里的 wid，旧令牌就能继续访问切换前的空间。
   * 令牌里的 wid 只作提示，不作判据。
   */
  async resolveAccessContext(
    authorization?: string,
    options: { allowInvalidWorkspace?: boolean; audience?: AuthAudience } = {}
  ): Promise<{ user: SystemUserRow; tenantUser: SystemUserRow; workspaceId?: string; hasWorkspaces: boolean; workspaceValid: boolean } | undefined> {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return undefined;
    const payload = this.verifyAccessToken(token);
    if (!payload) return undefined;
    const session = await this.platformService.getAuthSession(payload.sid);
    const expectedAudience = options.audience ?? "operator";
    if (!session || session.userId !== payload.sub || this.sessionAudience(session) !== expectedAudience) return undefined;
    if ((payload.aud ?? "operator") !== expectedAudience) return undefined;
    const workspaceId = session.currentWorkspaceId ?? undefined;
    // 同一个请求只读取一次空间成员关系，并同时用于权限身份与有效性判断。
    // 若分两次查询，授权恰好在两次查询之间恢复时，可能出现「租户级身份 +
    // workspaceValid=true」的瞬时组合，使该请求绕过空间角色权限。
    const tenantUser = await this.platformService.findUserById(payload.sub);
    if (!tenantUser?.isActive || tenantUser.tenantId !== payload.tid) return undefined;
    const workspaceUser = await this.platformService.findWorkspaceScopedUser(payload.sub, workspaceId, tenantUser);
    const user = workspaceUser ?? (options.allowInvalidWorkspace ? tenantUser : undefined);
    if (!user || user.tenantId !== payload.tid) return undefined;
    // hasWorkspaces 用于区分两种"没有当前空间"：
    //   - 该账号本来就有可进入空间却没选（必须 fail-closed，让它去选）
    //   - 该账号一个可进入空间都没有（平台管理租户、内存演示模式）——
    //     这类会话不该被空间检查拦住，它们的边界由 SaaS 管理员白名单与
    //     SPACE-03 的事实层空间条件负责。
    const hasWorkspaces = workspaceId
      ? true
      : (await this.platformService.listUserWorkspaces(payload.sub)).length > 0;
    // TENANT-READY/ACCESS-ACCEPT：会话指向的空间必须有有效成员关系才算「空间已验证」。
    // 撤销/停用后 fallback 到租户级身份时，workspaceId 不能再当有效范围使用——
    // 否则被撤销的账号拿着旧会话仍能读旧空间的经营数据。
    const workspaceValid = Boolean(workspaceId) && Boolean(workspaceUser);
    return { user, tenantUser, workspaceId, hasWorkspaces, workspaceValid };
  }

  /** SPACE-02：切换当前经营空间。校验成员资格与空间状态后重新签发访问令牌。 */
  async switchWorkspace(authorization: string | undefined, workspaceId: string, audience: AuthAudience = "operator"): Promise<LoginResponse> {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    const payload = token ? this.verifyAccessToken(token) : undefined;
    if (!payload) throw new UnauthorizedException("会话已失效，请重新登录");
    const session = await this.platformService.getAuthSession(payload.sid);
    if (!session || session.userId !== payload.sub || this.sessionAudience(session) !== audience || (payload.aud ?? "operator") !== audience) throw new UnauthorizedException("会话已失效，请重新登录");
    if (!workspaceId?.trim()) throw new BadRequestException("经营空间不能为空");
    // 逐项校验成员关系与空间状态；无权或已冻结/停用在此抛 403。
    const resolved = await this.platformService.resolveSessionWorkspaceId(payload.sub, workspaceId.trim());
    if (!resolved) throw new ForbiddenException("无权进入该经营空间");
    const updated = await this.platformService.setSessionWorkspace(
      session.id,
      resolved,
      session.currentWorkspaceId
    );
    if (updated === false) {
      throw new ConflictException("当前会话已在其他标签页切换空间，请刷新后重试");
    }
    const user = await this.platformService.findWorkspaceScopedUser(payload.sub, resolved);
    if (!user) throw new UnauthorizedException("账号已停用");
    const tenant = await this.platformService.findTenantByIdForAuth(user.tenantId);
    // 复用现有会话（refreshToken 不变），只换访问令牌与其携带的 wid。
    return this.buildLoginResponse(user, tenant, session.id, resolved, undefined, false, audience);
  }

  private async issueSession(
    user: SystemUserRow,
    tenant: Awaited<ReturnType<PlatformService["findTenantByIdForAuth"]>>,
    requestedWorkspaceId?: string | null,
    needsTenantOnboarding = false,
    audience: AuthAudience = "operator"
  ): Promise<LoginResponse> {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString("base64url");
    // SPACE-02：登录即解析当前经营空间（默认空间优先，否则第一个可进入空间）。
    // 平台管理租户没有成员关系，解析结果为 undefined —— 那是合法状态，
    // 但其会话访问经营接口会被 fail-closed 拒绝。
    const workspaceId = await this.platformService.resolveSessionWorkspaceId(
      user.id,
      requestedWorkspaceId ?? undefined
    );
    if (audience === "staff" && (!workspaceId || user.isSaasAdmin)) {
      throw new UnauthorizedException("该账号没有可进入的员工经营空间");
    }
    if (audience === "staff" && !(await this.platformService.findWorkspaceScopedUser(user.id, workspaceId))) {
      throw new UnauthorizedException("该账号没有可进入的员工经营空间");
    }
    await this.platformService.createAuthSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
      currentWorkspaceId: workspaceId ?? null,
      audience
    });
    // 权限必须按解析出的空间重算：成员关系上的角色与数据范围优先于租户级默认值。
    const scoped = (await this.platformService.findWorkspaceScopedUser(user.id, workspaceId)) ?? user;
    return this.buildLoginResponse(
      scoped,
      tenant,
      sessionId,
      workspaceId,
      refreshToken,
      needsTenantOnboarding,
      audience
    );
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
    refreshToken: string | undefined,
    needsTenantOnboarding = false,
    audience: AuthAudience = "operator"
  ): Promise<LoginResponse> {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = this.signAccessToken({
      sub: user.id,
      tid: user.tenantId,
      sid: sessionId,
      aud: audience,
      wid: workspaceId,
      iat: now,
      exp: now + this.accessTtlSeconds
    });
    const workspaces = await this.platformService.listUserWorkspaces(user.id);
    const sessionScope = await this.getCategoryContext(user.tenantId, workspaceId);
    // 与 session-context 完全同口径：能力集是**已启用实例**，不是品类声明。
    // 两处若不一致，前端会在「刚登录」与「刷新后」看到两套菜单。
    const capabilityView = workspaceId ? await this.capabilityOverviewFor(user.tenantId, workspaceId) : undefined;
    const branding = user.isSaasAdmin ? {} : await this.tenantBranding(tenant.tenantId);
    return {
      accessToken,
      refreshToken: refreshToken ?? "",
      expiresIn: this.accessTtlSeconds,
      tenant: {
        tenantId: tenant.tenantId,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.tenantName,
        tenantStatus: tenant.tenantStatus,
        ...branding,
        // 与 session-context 同口径：品类和能力取当前经营空间，不取租户级档案。
        categoryCode: sessionScope.categoryCode,
        categoryName: sessionScope.categoryName,
        capabilities: capabilityView?.enabled ?? []
      },
      user: await this.toAuthUser(user),
      needsTenantOnboarding: Boolean(needsTenantOnboarding && workspaceId),
      // SPACE-02：登录返回可进入的空间与当前空间，供前端渲染切换器（前端属 SPACE-05）。
      workspaces,
      currentWorkspaceId: workspaceId
    };
  }

  /** 展示配置读取失败时回退平台默认品牌，不影响认证与业务接口。 */
  private async tenantBranding(tenantId: string): Promise<{
    brandName?: string;
    brandLogoUrl?: string;
    faviconUrl?: string;
    themeColor?: string;
    adminCornerRadius?: number;
    adminContainerRadius?: number;
    adminButtonRadius?: number;
    adminInputRadius?: number;
  }> {
    if (!this.clientChannelProfile) return {};
    try {
      return await this.clientChannelProfile.getBranding(tenantId);
    } catch (error) {
      this.logger.warn(`读取租户 ${tenantId} 的管理后台品牌失败，回退平台默认品牌：${(error as Error).message}`);
      return {};
    }
  }

  private async toAuthUser(user: SystemUserRow, baseUser?: SystemUserRow): Promise<AuthUser> {
    const tenantUser = baseUser ?? await this.platformService.findUserById(user.id);
    if (!tenantUser?.isActive || tenantUser.tenantId !== user.tenantId) throw new UnauthorizedException("账号或租户已停用");
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
      tenantMembership: {
        permissions: tenantUser.isSaasAdmin ? [] : tenantUser.permissions,
        dataScope: tenantUser.dataScope,
        isTenantAdmin: !tenantUser.isSaasAdmin && tenantUser.isPlatformAdmin
      }
    };
  }

  private signAccessToken(payload: AccessTokenPayload) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = this.sign(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  private sessionAudience(session: { audience?: string | null }): AuthAudience {
    return session.audience === "staff" ? "staff" : "operator";
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

  private usesPersistentLoginFailureStore() {
    const dataSource = this.configService.get<string>("PLATFORM_DATA_SOURCE") ?? process.env.PLATFORM_DATA_SOURCE ?? "mysql";
    return Boolean(this.prisma) && dataSource.trim().toLowerCase() === "mysql";
  }

  private loginFailureKeyHash(loginKey: string) {
    return createHmac("sha256", `${this.tokenSecret()}:login-lockout-v1`).update(loginKey).digest("hex");
  }

  private async assertNotLocked(
    loginKey: string,
    policy: { enabled: boolean; maxFailures: number; windowMinutes: number; lockMinutes: number }
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

  private async recordFailedLogin(
    loginKey: string,
    policy: { enabled: boolean; maxFailures: number; windowMinutes: number; lockMinutes: number }
  ) {
    if (!policy.enabled) return;
    if (this.usesPersistentLoginFailureStore()) {
      const loginKeyHash = this.loginFailureKeyHash(loginKey);
      const now = new Date();
      const windowMs = Math.max(1, policy.windowMinutes) * 60_000;
      const lockMs = Math.max(1, policy.lockMinutes) * 60_000;
      const expiresAtFor = (lockedUntil?: Date | null) => new Date(Math.max(now.getTime() + windowMs, lockedUntil?.getTime() ?? 0));
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = await this.prisma!.authLoginFailure.findUnique({ where: { loginKeyHash } });
        if (!current) {
          const lockedUntil = policy.maxFailures <= 1 ? new Date(now.getTime() + lockMs) : null;
          try {
            await this.prisma!.authLoginFailure.create({
              data: { loginKeyHash, failureCount: 1, firstFailedAt: now, lockedUntil, expiresAt: expiresAtFor(lockedUntil), revision: 1 }
            });
          } catch (error) {
            if ((error as { code?: string })?.code === "P2002") {
              if (attempt === 19) throw new InternalServerErrorException("登录失败保护状态并发冲突，请稍后重试");
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
          data: { failureCount, firstFailedAt, lockedUntil, expiresAt: expiresAtFor(lockedUntil), revision: { increment: 1 } }
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
    const state = current && now - current.firstFailedAt <= policy.windowMinutes * 60_000
      ? current
      : { count: 0, firstFailedAt: now };
    state.count += 1;
    if (state.count >= policy.maxFailures) state.lockedUntil = now + policy.lockMinutes * 60_000;
    this.loginFailures.set(loginKey, state);
  }

  private async clearFailedLogin(loginKey: string) {
    this.loginFailures.delete(loginKey);
    if (this.usesPersistentLoginFailureStore()) {
      await this.prisma!.authLoginFailure.deleteMany({ where: { loginKeyHash: this.loginFailureKeyHash(loginKey) } });
    }
  }
}
