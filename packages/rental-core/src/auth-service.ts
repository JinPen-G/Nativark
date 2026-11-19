/** Original Web authentication and scoped current-principal resolution.
 * External issuer/grant verification belongs to its original authority; roles and
 * workspace access come from original Platform storage, never model/request fields. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SystemUserRow, ResetLocalDemoPasswordResult } from "@rental-os/platform-contracts";
import type { LoginResponse } from "./auth-contracts";
import type { RentalCapability } from "./contracts";
import { AuthSessionService, type AuthAudience } from "@rental-os/platform-server/auth-session";
export type { AuthAudience } from "@rental-os/platform-server/auth-session";
import type { RentalAuthenticationSource, RentalAuthenticationDatabase } from "./auth-source";
import type { TenantBrandingSource, AccountAppearanceSource } from "@rental-os/platform-server/auth-session";
import { WorkspaceCapabilityService } from "./workspace-capabilities";
import { resolveUserBusinessLocationScope } from "./business-location-scope";
import type { OrganizationLocationScope } from "@rental-os/platform-server/organization-location-scope";
import { Prisma } from "@prisma/client";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";

export interface WorkspaceAccessLease {
  user: SystemUserRow;
  /** Same transaction and original session; expiry still needs a final check. */
  revalidate: () => Promise<SystemUserRow>;
}

import { snapshotTrustedWorkspacePrincipal } from './trusted-workspace-principal';
import type { AuthAccessContext, TrustedWorkspaceAccess, TrustedWorkspacePrincipal } from './trusted-workspace-principal';
import type { TrustedBrowserPrincipal } from './trusted-browser-principal';
import type { TrustedPlatformBrowserPrincipal } from './trusted-platform-browser-principal';

export class RentalAuthService extends AuthSessionService<LoginResponse, AuthAccessContext & { accessSession: { sessionId: string; expiresAt: number } }> {
  // Opaque, single-consumption tickets scoped to an original authority callback;
  // no token cache, durable grant, or permission supplied by a request/model.
  readonly #trustedWorkspaceContexts = new WeakMap<object, {
    context: AuthAccessContext; transaction: Prisma.TransactionClient; live: () => boolean; release: () => void;
  }>();

  constructor(
    private readonly platformService: RentalAuthenticationSource,
    configService: ConfigService,
    // CORE-EXT-02C：会话上下文里的能力集改为「已启用实例」。可选是为了让既有单测
    // 继续用两个参数构造本服务；缺失时返回空启用集（fail-closed），不回退到品类声明。
    private readonly capabilities?: Pick<WorkspaceCapabilityService, "overview" | "workspaceRunMode">,
    // 品牌与外观（主题色/圆角/品牌标识）来自独立的「品牌与外观」领域，不阻断登录；可选依赖兼容内存测试模式。
    tenantAppearance?: TenantBrandingSource,
    // 账户级外观（跟随登录账户的管理后台主题色），与租户品牌色独立；可选，缺失时不阻断登录。
    accountAppearance?: AccountAppearanceSource,
    // AUTH-LOCKOUT-01：持久化跨进程失败计数；测试/纯内存模式继续使用进程内后备实现。
    private readonly businessDatabase?: RentalAuthenticationDatabase
  ) { super(platformService, configService, tenantAppearance, accountAppearance, businessDatabase); }

  isPersonalDemoPasswordResetEnabled() {
    return this.configService.get<string>("RENTAL_DEPLOYMENT_PROFILE") === "personal-demo"
      && this.configService.get<string>("LOCAL_DEMO_PASSWORD_RESET_ENABLED") === "true";
  }

  private async assertLocalDemoResetAccess(authorization?: string) {
    if (this.isPersonalDemoPasswordResetEnabled()) return;
    if (this.configService.get<string>("NODE_ENV") !== "development"
      || this.configService.get<string>("RENTAL_DEPLOYMENT_PROFILE") === "production"
      || this.configService.get<string>("LOCAL_DEMO_PASSWORD_RESET_ENABLED") !== "true") {
      throw new ForbiddenException("演示账号密码重置未启用");
    }
    const user = await this.getCurrentUser(authorization);
    if (!user.isSaasAdmin || user.mustChangePassword
      || !user.permissions?.some(permission => permission === "system:params:manage" || permission === "*")) {
      throw new ForbiddenException("演示账号密码重置需要当前平台管理员的系统参数管理权限");
    }
  }

  /** Personal-demo configuration enables the original pre-login demonstration reset.
   * Other development maintenance requires current platform authentication. The
   * configuration and authority are rechecked after reading the password policy.
   */
  async resetLocalDemoPassword(password: string, authorization?: string): Promise<ResetLocalDemoPasswordResult> {
    await this.assertLocalDemoResetAccess(authorization);
    const security = await this.platformService.getSecurityBaseline();
    this.assertPasswordPolicy(password, security.passwordPolicy);
    await this.assertLocalDemoResetAccess(authorization);
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
        operatorShortName: tenant.operatorShortName,
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

  /** Original current grant owner supplies the binding in its SAME Serializable
   * transaction. This is not OAuth verification, consent or a public identity DTO.
   * Callback lifetime bounds both the resolver and its opaque, one-use tickets. */
  async withTrustedWorkspacePrincipal<T>(
    transaction: Prisma.TransactionClient,
    current: (transaction: Prisma.TransactionClient, signal: AbortSignal) => Promise<TrustedWorkspacePrincipal | undefined>,
    signal: AbortSignal,
    consume: (resolve: () => Promise<TrustedWorkspaceAccess | undefined>) => Promise<T>
  ): Promise<T> {
    if (!transaction || typeof current !== 'function' || typeof consume !== 'function' || signal.aborted) {
      throw new ForbiddenException('可信主体授权未就绪');
    }
    let active = true, captured: TrustedWorkspacePrincipal | undefined;
    const tickets = new Set<object>();
    const live = () => { if (!active || signal.aborted) throw new ForbiddenException('可信主体授权已停止'); };
    const readBinding = async () => {
      live(); const original = await current(transaction, signal); live();
      return original === undefined ? undefined : snapshotTrustedWorkspacePrincipal(original);
    };
    const resolve = async (): Promise<TrustedWorkspaceAccess | undefined> => {
      const before = await readBinding();
      if (!before) return undefined;
      if (captured && JSON.stringify(captured) !== JSON.stringify(before)) throw new ForbiddenException('可信主体范围已变化');
      const context = await this.platformService.resolveTrustedWorkspacePrincipal(before, transaction); live();
      const after = await readBinding();
      if (!after || JSON.stringify(after) !== JSON.stringify(before)) throw new ForbiddenException('可信主体范围已变化');
      if (!context || context.user.isSaasAdmin || !context.user.isActive || context.user.id !== before.userId
        || context.user.tenantId !== before.tenantId || context.workspaceId !== before.workspaceId || !context.workspaceValid) return undefined;
      captured ??= before;
      const ticket = Object.freeze({}) as TrustedWorkspaceAccess;
      tickets.add(ticket);
      this.#trustedWorkspaceContexts.set(ticket, { context: structuredClone(context), transaction,
        live: () => active && !signal.aborted, release: () => tickets.delete(ticket) });
      return ticket;
    };
    try { const result = await consume(resolve); live(); return result; }
    finally { active = false; for (const ticket of tickets) this.#trustedWorkspaceContexts.delete(ticket); }
  }

  /** Guard-only consumption: JSON/lookalikes, other AuthService instances, used
   * tickets and tickets whose original callback ended cannot authenticate. */
  consumeTrustedWorkspaceAccess(ticket: TrustedWorkspaceAccess | undefined) {
    const entry = ticket && this.#trustedWorkspaceContexts.get(ticket);
    if (!entry || !entry.live()) throw new UnauthorizedException('缺少当前可信主体授权');
    this.#trustedWorkspaceContexts.delete(ticket!); entry.release();
    return { context: structuredClone(entry.context), transaction: entry.transaction };
  }

  /** Original Web-only identity for a trusted consent transaction. Reuses this
   * service's signature verifier and original Platform account/space mapping;
   * caller fields cannot select a session, user or workspace. No consent/MFA/CSRF
   * is inferred. The original owner must use Serializable and recheck at commit. */
  async resolveTrustedBrowserPrincipal(
    authorization: string | undefined,
    transaction: Prisma.TransactionClient,
    signal: AbortSignal
  ): Promise<TrustedBrowserPrincipal | undefined> {
    if (signal.aborted) throw new UnauthorizedException('浏览器身份核对已停止');
    if (!transaction || typeof authorization !== 'string' || authorization.length > 8192) return undefined;
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) return undefined;
    // OAuth control-plane identity must not depend on Web's development-secret
    // fallback. Original login behavior remains unchanged outside this method.
    const configured = this.configService.get<string>('AUTH_TOKEN_SECRET');
    if (typeof configured !== 'string' || !configured.trim()) return undefined;
    const token = match[1], live = () => { if (signal.aborted) throw new UnauthorizedException('浏览器身份核对已停止'); };
    const read = async (): Promise<TrustedBrowserPrincipal | undefined> => {
      live(); const payload = this.verifyAccessToken(token);
      if (!payload || (payload.aud ?? 'operator') !== 'operator' || !Number.isSafeInteger(payload.exp)
        || !Number.isSafeInteger(payload.iat) || payload.iat <= 0 || payload.iat > Date.now() / 1000 || payload.exp <= payload.iat
        || typeof payload.sid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(payload.sid)) return undefined;
      const binding = snapshotTrustedWorkspacePrincipal({ userId: payload.sub, tenantId: payload.tid, workspaceId: payload.wid, audience: 'operator' });
      const session = await this.platformService.getAuthSession(payload.sid, transaction); live();
      if (!session) return undefined;
      if (typeof session !== 'object' || Array.isArray(session) || ![Object.prototype, null].includes(Object.getPrototypeOf(session))) {
        throw new UnauthorizedException('浏览器会话证据不可用');
      }
      const descriptors = Object.getOwnPropertyDescriptors(session);
      const value = (key: string) => { const field = descriptors[key];
        if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new UnauthorizedException('浏览器会话证据不可用'); return field.value; };
      const expires = value('expiresAt');
      if (!(expires instanceof Date) || Object.getPrototypeOf(expires) !== Date.prototype) throw new UnauthorizedException('浏览器会话期限不可用');
      const expiresAt = Math.min(payload.exp, Math.floor(Date.prototype.getTime.call(expires) / 1000));
      if (value('id') !== payload.sid || value('userId') !== binding.userId || value('audience') !== 'operator'
        || value('revokedAt') !== null || value('currentWorkspaceId') !== binding.workspaceId || !Number.isSafeInteger(expiresAt)
        || expiresAt <= Date.now() / 1000) return undefined;
      const context = await this.platformService.resolveTrustedWorkspacePrincipal(binding, transaction); live();
      if (!context || context.user.isSaasAdmin || !context.user.isActive || context.user.mustChangePassword !== false
        || context.user.id !== binding.userId || context.user.tenantId !== binding.tenantId
        || context.workspaceId !== binding.workspaceId || !context.workspaceValid) return undefined;
      return Object.freeze({ ...binding, sessionId: payload.sid, expiresAt });
    };
    try {
      const before = await read(); if (!before) return undefined;
      const after = await read(); live();
      if (!after || JSON.stringify(after) !== JSON.stringify(before)) throw new UnauthorizedException('浏览器会话范围已变化');
      return after;
    } catch { throw new UnauthorizedException('当前可信浏览器身份不可用'); }
  }

  /** Original Web-only PLATFORM identity. Uses this service's original signature
   * verifier/session fence and current SaaS account gate, not workspace authority.
   * Caller owns Serializable and commit rechecks; no consent/MFA/CSRF is inferred. */
  async resolveTrustedPlatformBrowserPrincipal(
    authorization: string | undefined,
    transaction: Prisma.TransactionClient,
    signal: AbortSignal
  ): Promise<TrustedPlatformBrowserPrincipal | undefined> {
    if (signal.aborted) throw new UnauthorizedException('平台身份核对已停止');
    if (!transaction || typeof authorization !== 'string' || authorization.length > 8192) return undefined;
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) return undefined;
    const configured = this.configService.get<string>('AUTH_TOKEN_SECRET');
    if (typeof configured !== 'string' || !configured.trim()) return undefined;
    const token = match[1], id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/.test(value);
    const live = () => { if (signal.aborted) throw new UnauthorizedException('平台身份核对已停止'); };
    const read = async (): Promise<TrustedPlatformBrowserPrincipal | undefined> => {
      live(); const payload = this.verifyAccessToken(token);
      if (!payload || (payload.aud ?? 'operator') !== 'operator' || !id(payload.sub) || !id(payload.tid) || !id(payload.sid)
        || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.iat <= 0
        || payload.iat > Date.now() / 1000 || payload.exp <= payload.iat || payload.wid !== undefined && !id(payload.wid)) return undefined;
      const session = await this.platformService.getAuthSession(payload.sid, transaction); live();
      if (!session) return undefined;
      if (typeof session !== 'object' || Array.isArray(session) || ![Object.prototype, null].includes(Object.getPrototypeOf(session))) throw new UnauthorizedException('平台会话证据不可用');
      const descriptors = Object.getOwnPropertyDescriptors(session);
      const value = (key: string) => { const field = descriptors[key];
        if (!field?.enumerable || !Object.hasOwn(field, 'value')) throw new UnauthorizedException('平台会话证据不可用'); return field.value; };
      const expires = value('expiresAt');
      if (!(expires instanceof Date) || Object.getPrototypeOf(expires) !== Date.prototype) throw new UnauthorizedException('平台会话期限不可用');
      const expiresAt = Math.min(payload.exp, Math.floor(Date.prototype.getTime.call(expires) / 1000));
      if (value('id') !== payload.sid || value('userId') !== payload.sub || value('audience') !== 'operator' || value('revokedAt') !== null
        || value('currentWorkspaceId') !== (payload.wid ?? null) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000) return undefined;
      const binding = Object.freeze({ userId: payload.sub, tenantId: payload.tid });
      const current = await this.platformService.assertTrustedSaasManagement(binding, transaction); live();
      if (!current || current.userId !== binding.userId || current.tenantId !== binding.tenantId) return undefined;
      return Object.freeze({ ...binding, audience: 'operator' as const, sessionId: payload.sid, expiresAt });
    };
    try {
      const before = await read(); if (!before) return undefined;
      const after = await read(); live();
      if (!after || JSON.stringify(after) !== JSON.stringify(before)) throw new UnauthorizedException('平台会话主体已变化');
      return after;
    } catch { throw new UnauthorizedException('当前可信平台身份不可用'); }
  }

  /**
   * SPACE-02：解析访问令牌，同时给出当前经营空间与**按该空间生效**的权限。
   *
   * 当前空间取自会话行，且必须与签发令牌的 wid 一致。切换后的旧令牌失效，
   * 不把原页面在途请求转到新空间，也不允许旧令牌继续使用原空间。
   */
  async resolveAccessContext(
    authorization?: string,
    options: { allowInvalidWorkspace?: boolean; audience?: AuthAudience; businessScope?: boolean } = {}
  ): Promise<{ user: SystemUserRow; tenantUser: SystemUserRow; workspaceId?: string; hasWorkspaces: boolean; workspaceValid: boolean;
    accessSession: { sessionId: string; expiresAt: number }; businessLocationScope?: OrganizationLocationScope } | undefined> {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return undefined;
    const payload = this.verifyAccessToken(token);
    if (!payload) return undefined;
    const session = await this.platformService.getAuthSession(payload.sid);
    const expectedAudience = options.audience ?? "operator";
    if (!session || session.userId !== payload.sub || this.sessionAudience(session) !== expectedAudience) return undefined;
    if ((payload.aud ?? "operator") !== expectedAudience) return undefined;
    // 内存会话同样可能在等待后被切换；捕获本次校验值，不能下游再读活动对象。
    const workspaceId = session.currentWorkspaceId ?? undefined;
    if ((payload.wid ?? undefined) !== workspaceId) throw new ConflictException("会话经营空间已变化，请刷新页面后核对，原请求未执行");
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
    // Internal business consumers opt into the SAME current organization/location
    // projection as the Guard. Keep raw role configuration and tenant-wide auth
    // callers unchanged; this projection is not route/resource authorization.
    const businessLocationScope = options.businessScope
      ? await resolveUserBusinessLocationScope(user, workspaceValid ? workspaceId : undefined,
        user.locationScope ?? { mode: "all", locationIds: [] }, this.businessDatabase) : undefined;
    return { user, tenantUser, workspaceId, hasWorkspaces, workspaceValid,
      accessSession: { sessionId: payload.sid, expiresAt: payload.exp },
      ...(businessLocationScope ? { businessLocationScope } : {}) };
  }

  /** Lock the current authenticated workspace principal before business locks.
   * Uses the original Guard evidence and platform permission mapping. The lease
   * grants no business action and is valid only in the supplied transaction;
   * callers check their action/scope and revalidate immediately before return. */
  async lockRequestWorkspaceAccess(tx: Prisma.TransactionClient): Promise<WorkspaceAccessLease> {
    const identity = getRequestIdentity();
    const evidence = identity?.accessSession;
    if (!identity?.tenantId || !identity.userId || !identity.workspaceId ||
        !["operator", "staff"].includes(identity.audience ?? "") || !evidence?.sessionId ||
        !Number.isSafeInteger(evidence.expiresAt)) {
      throw new UnauthorizedException("缺少原认证会话依据，不能执行空间事务");
    }
    // Capture values: later context changes must not reinterpret this request.
    const expected = { tenantId: identity.tenantId, userId: identity.userId, workspaceId: identity.workspaceId,
      sessionId: evidence.sessionId, audience: identity.audience as AuthAudience };
    const expiresAt = evidence.expiresAt;
    const assertNotExpired = () => {
      if (expiresAt <= Math.floor(Date.now() / 1000)) throw new UnauthorizedException("原访问令牌已到期，请先核对原操作结果");
    };
    assertNotExpired();
    const user = await this.platformService.lockWorkspaceSessionUser(tx, expected);
    const assertUser = (current: SystemUserRow) => {
      assertNotExpired();
      if (!current.isActive || current.mustChangePassword) throw new ForbiddenException("账号已停用或须先修改密码，空间操作未获准");
      return current;
    };
    return { user: assertUser(user), revalidate: async () => {
      assertNotExpired();
      return assertUser(await this.platformService.readWorkspaceSessionUser(tx, expected));
    } };
  }

  /** SPACE-02：切换当前经营空间。校验成员资格与空间状态后重新签发访问令牌。 */
  async switchWorkspace(authorization: string | undefined, workspaceId: string, audience: AuthAudience = "operator"): Promise<LoginResponse> {
    const token = authorization?.replace(/^Bearer\s+/i, "").trim();
    const payload = token ? this.verifyAccessToken(token) : undefined;
    if (!payload) throw new UnauthorizedException("会话已失效，请重新登录");
    const session = await this.platformService.getAuthSession(payload.sid);
    if (!session || session.userId !== payload.sub || this.sessionAudience(session) !== audience || (payload.aud ?? "operator") !== audience) throw new UnauthorizedException("会话已失效，请重新登录");
    const previousWorkspaceId = session.currentWorkspaceId ?? null;
    if ((payload.wid ?? undefined) !== (previousWorkspaceId ?? undefined)) throw new ConflictException("会话经营空间已变化，请刷新后重新选择");
    if (!workspaceId?.trim()) throw new BadRequestException("经营空间不能为空");
    // 逐项校验成员关系与空间状态；无权或已冻结/停用在此抛 403。
    const resolved = await this.platformService.resolveSessionWorkspaceId(payload.sub, workspaceId.trim());
    if (!resolved) throw new ForbiddenException("无权进入该经营空间");
    const updated = await this.platformService.setSessionWorkspace(
      session.id,
      resolved,
      previousWorkspaceId
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

  /**
   * 组装登录/切换响应。切换时不换 refreshToken（会话本身没变），
   * 因此 refreshToken 允许为空并原样回传空串以外的既有值由调用方决定。
   */
  protected async buildLoginResponse(
    user: SystemUserRow,
    tenant: Awaited<ReturnType<RentalAuthenticationSource["findTenantByIdForAuth"]>>,
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
        operatorShortName: tenant.operatorShortName,
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

  protected resolveSessionWorkspaceId(userId: string, requested?: string) {
    return this.platformService.resolveSessionWorkspaceId(userId, requested);
  }

  protected findWorkspaceScopedUser(userId: string, workspaceId?: string) {
    return this.platformService.findWorkspaceScopedUser(userId, workspaceId);
  }
}
