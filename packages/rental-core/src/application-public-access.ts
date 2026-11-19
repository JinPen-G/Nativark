/** Rental 公开客户入口的独立准入：复核原服务解析的租户/空间/挑战/刷新会话与实际 Core 部署。
 * 与已认证请求互斥选择同一业务父锁 fence；不构造成员/客户身份，不执行认证、限流或业务写入。
 * 原服务仍负责凭据、公开投影、提交与运输结果；本层不把已提交操作或外部 unknown 重新解释成未执行。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import { CoreBindingSchema, CoreScopeReferenceSchema, TenantCoreGrantSchema, isCoreVersionSupported } from "@rental-os/core-contracts";
import { CoreAccessError, coreBindingScopeKey, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import type { createRentalAuthorization } from "./http-auth";
import { createRentalBusinessTenantFence, lockRentalBusinessTenant, type RentalBusinessTenantTransaction } from "./mysql-business-fence";
import { RENTAL_CORE_ID, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { RENTAL_DATA_READABLE } from "./data";

export interface RentalPublicAccessRequest {
  method: string;
  url: string;
  user?: unknown;
  client?: unknown;
}

/** 仅供原服务在完成查询后调用，不是 HTTP DTO。所有指针在同事务内重新查询，不能自授权。
 * challenge/session 指针和刷新摘要只留在请求内存，不输出到日志或响应。 */
export interface RentalPublicTarget {
  tenantId: string;
  workspaceId?: string;
  requirePublished?: boolean;
  loginMethod?: "password" | "sms";
  origin: { kind: "tenant-code"; tenantCode: string }
    | { kind: "challenge"; challengeId: string }
    | { kind: "session"; sessionId: string; refreshTokenHash: string }
    | { kind: "website-host"; host: string };
}

export interface RentalPublicApplicationAccessDependencies {
  database: {
    $transaction<T>(consume: (transaction: RentalBusinessTenantTransaction) => Promise<T>,
      options: { isolationLevel: "ReadCommitted" }): Promise<T>;
  };
  authorization: Pick<ReturnType<typeof createRentalAuthorization>, "isClientPublicRoute">;
  deploymentForTransaction(reader: Pick<CoreHostSqlTransaction, "$queryRaw">): CoreDeploymentAvailability;
}

type Evidence = {
  request: RentalPublicAccessRequest;
  method: string;
  path: string;
  sourceIdentity: NonNullable<ReturnType<typeof getRequestIdentity>>;
  target?: Readonly<RentalPublicTarget>;
  empty?: "site-resolve" | "logout";
};
type PublicScope = {
  active: boolean;
  bound: boolean;
  evidence?: Evidence;
  bind(target: RentalPublicTarget): Promise<void>;
  recheck(): Promise<void>;
  empty(kind: "site-resolve" | "logout"): void;
};
const scopes = new AsyncLocalStorage<PublicScope>();
const present = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const hasAuthority = (identity: NonNullable<ReturnType<typeof getRequestIdentity>>) =>
  Boolean(identity.userId || identity.audience || identity.accessSession || identity.isSaasAdmin || identity.isPlatformAdmin
    || identity.permissions?.length || identity.dataScope || identity.organizationId || identity.locationScope
    || identity.staffApi || identity.staffLocationScope || identity.operationToken);
const targetKey = (target: RentalPublicTarget) => JSON.stringify([target.tenantId, target.workspaceId,
  Boolean(target.requirePublished), target.loginMethod, target.origin.kind,
  target.origin.kind === "tenant-code" ? target.origin.tenantCode : target.origin.kind === "challenge" ? target.origin.challengeId
    : target.origin.kind === "session" ? [target.origin.sessionId, target.origin.refreshTokenHash] : target.origin.host]);

/** 原服务提供已查询的事实；未选标准宿主时保留旧宿主行为，已选却未绑定/结束时严格拒绝。 */
export async function enterRentalPublicTarget(target: RentalPublicTarget): Promise<void> {
  const scope = scopes.getStore();
  if (scope) await scope.bind(target);
}

/** 仅在新的外部派发之前检查；结果回写遵循原 reservation，不把运输成功改成授权失败。 */
export async function assertRentalPublicAccessBeforeEffect(): Promise<void> {
  const scope = scopes.getStore();
  if (scope) await scope.recheck();
}

/** 原限流桶有独立提交；仅已选匿名请求的租户验证码预算使用父锁和同事务门禁。
 * Guard 的 IP 桶没有租户事实，仍按原安全限流执行，不消费业务授权。 */
export async function lockRentalPublicQuotaTenant(transaction: RentalBusinessTenantTransaction, tenantId: string): Promise<void> {
  if (scopes.getStore()) await lockRentalBusinessTenant(transaction, tenantId);
}

/** 两个原无业务事实成功分支：未知域名 null、只消费原 refresh token 的退出。
 * 其他方法缺少 target 不能返回成功；本标记不授予任何业务事务权威。 */
export function acknowledgeRentalPublicEmptyResult(kind: "site-resolve" | "logout"): void {
  scopes.getStore()?.empty(kind);
}

export function createRentalPublicApplicationAccess(input: RentalPublicApplicationAccessDependencies) {
  if (typeof input?.database?.$transaction !== "function" || typeof input.authorization?.isClientPublicRoute !== "function"
    || typeof input.deploymentForTransaction !== "function") {
    throw new CoreAccessError("core_unavailable", "Rental 公开入口缺少原路由政策、真实事务或部署观察器");
  }
  const owned = new WeakSet<PublicScope>();
  const current = () => {
    fence.assertBound();
    const scope = scopes.getStore();
    if (!scope || !owned.has(scope) || !scope.active || !scope.bound || !scope.evidence) {
      throw new CoreAccessError("denied", "Rental 公开请求未绑定或已结束");
    }
    const evidence = scope.evidence, identity = getRequestIdentity();
    if (!identity || evidence.request.user || evidence.request.client || hasAuthority(identity)
      || evidence.request.method.toUpperCase() !== evidence.method || matchableRequestPath(evidence.request.url) !== evidence.path
      || (identity !== evidence.sourceIdentity && (!evidence.target || identity.tenantId !== evidence.target.tenantId
        || identity.workspaceId !== evidence.target.workspaceId))
      || (identity.tenantId !== undefined && identity.tenantId !== evidence.target?.tenantId)
      || (identity.workspaceId !== undefined && identity.workspaceId !== evidence.target?.workspaceId)) {
      throw new CoreAccessError("denied", "Rental 公开请求的原范围或匿名身份已变化");
    }
    return evidence;
  };

  const assertCurrent = async (transaction: RentalBusinessTenantTransaction, tenantId: string): Promise<void> => {
    const evidence = current(), target = evidence.target;
    if (!target || target.tenantId !== tenantId || typeof transaction?.$queryRaw !== "function" || "$transaction" in transaction) {
      throw new CoreAccessError("denied", "Rental 公开事务未绑定原目标与同一事务");
    }
    // 与管理写入相同的 Tenant → Core gate 顺序。已有 Tenant X 的挑战不能先取 S 再升级。
    const tenants = await transaction.$queryRaw<Array<{ id: string; code: string; status: string }>>(sql`
      SELECT id, code, status FROM Tenant WHERE id = ${tenantId} LOCK IN SHARE MODE`);
    const tenant = tenants.length === 1 ? tenants[0] : undefined;
    if (!tenant || tenant.id !== tenantId || tenant.status !== "active"
      || target.origin.kind === "tenant-code" && tenant.code !== target.origin.tenantCode) {
      throw new CoreAccessError("denied", "Rental 公开目标租户不存在、已停用或与原解析不符");
    }
    const gates = await transaction.$queryRaw<Array<{ tenantId: string; coreId: string }>>(sql`
      SELECT tenant_id AS tenantId, core_id AS coreId FROM platform_core_access_locks
      WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    if (gates.length !== 1 || gates[0].tenantId !== tenantId || gates[0].coreId !== RENTAL_CORE_ID) {
      throw new CoreAccessError("denied", "Rental 公开目标缺少租户 Core 门禁");
    }
    const grants = await transaction.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>(sql`
      SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants
      WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    const grant = grants.length === 1 ? TenantCoreGrantSchema.safeParse({ ...grants[0],
      revision: Number(grants[0].revision), tenantId, coreId: RENTAL_CORE_ID }) : undefined;
    if (!grant?.success || grant.data.state !== "enabled") {
      throw new CoreAccessError("denied", "Rental Core 当前未获租户授权");
    }
    const scope = CoreScopeReferenceSchema.parse({ coreId: RENTAL_CORE_ID, tenantId,
      ...(target.workspaceId ? { container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: target.workspaceId } } : {}) });
    const scopeKey = coreBindingScopeKey(scope), scopeHash = createHash("sha256").update(scopeKey).digest("hex");
    const bindings = await transaction.$queryRaw<Array<{ bindingId: string; revision: bigint | number; dataVersion: string;
      containerType: string | null; containerId: string | null }>>(sql`
      SELECT binding_id AS bindingId, revision, data_version AS dataVersion,
        container_type AS containerType, container_id AS containerId FROM platform_core_bindings
      WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} AND scope_hash = ${scopeHash} LOCK IN SHARE MODE`);
    const row = bindings.length === 1 ? bindings[0] : undefined;
    const binding = row ? CoreBindingSchema.safeParse({ coreId: RENTAL_CORE_ID, tenantId, bindingId: row.bindingId,
      revision: Number(row.revision), dataVersion: row.dataVersion,
      ...(row.containerType !== null || row.containerId !== null ? { container: { type: row.containerType, id: row.containerId } } : {}) }) : undefined;
    if (!binding?.success || coreBindingScopeKey(binding.data) !== scopeKey
      || !isCoreVersionSupported(binding.data.dataVersion, RENTAL_DATA_READABLE)) {
      throw new CoreAccessError("denied", "Rental 公开目标绑定缺失、范围不符或数据版本不兼容");
    }
    const reader: Pick<CoreHostSqlTransaction, "$queryRaw"> = {
      async $queryRaw<T>(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<T> {
        return transaction.$queryRaw<T>("raw" in query ? sql(query, ...values) : query);
      }
    };
    const deployment = input.deploymentForTransaction(reader);
    if (typeof deployment?.requireAvailable !== "function") throw new CoreAccessError("core_unavailable", "Rental 公开入口缺少实际部署观察器");
    await deployment.requireAvailable(RENTAL_CORE_ID, tenantId);
    if (target.workspaceId) {
      const workspaces = await transaction.$queryRaw<Array<{ id: string; tenantId: string; status: string }>>(sql`
        SELECT id, tenantId, status FROM business_workspaces
        WHERE tenantId = ${tenantId} AND id = ${target.workspaceId} LOCK IN SHARE MODE`);
      if (workspaces.length !== 1 || workspaces[0].id !== target.workspaceId || workspaces[0].tenantId !== tenantId || workspaces[0].status !== "active") {
        throw new CoreAccessError("denied", "Rental 公开目标空间不存在、归属变化或已停用");
      }
      if (target.requirePublished) {
        const publications = await transaction.$queryRaw<Array<{ workspaceId: string; enabled: boolean | number }>>(sql`
          SELECT workspaceId, enabled FROM client_channel_workspaces
          WHERE tenantId = ${tenantId} AND workspaceId = ${target.workspaceId} LOCK IN SHARE MODE`);
        if (publications.length !== 1 || publications[0].workspaceId !== target.workspaceId
          || ![true, 1].includes(publications[0].enabled)) throw new CoreAccessError("denied", "Rental 服务当前未向游客发布");
      }
    }
    if (target.loginMethod) {
      const profiles = await transaction.$queryRaw<Array<{ passwordLoginEnabled: boolean | number; smsLoginEnabled: boolean | number }>>(sql`
        SELECT passwordLoginEnabled, smsLoginEnabled FROM client_channel_profiles WHERE tenantId = ${tenantId} LOCK IN SHARE MODE`);
      const enabled = target.loginMethod === "password" ? profiles[0]?.passwordLoginEnabled : profiles[0]?.smsLoginEnabled;
      if (profiles.length > 1 || enabled !== undefined && ![true, 1].includes(enabled)) {
        throw new CoreAccessError("denied", "Rental 原客户登录方式当前未开放");
      }
    }
    if (target.origin.kind === "challenge") {
      const rows = await transaction.$queryRaw<Array<{ tenantId: string; sourceWorkspaceId: string | null }>>(sql`
        SELECT tenantId, sourceWorkspaceId FROM client_registration_challenges
        WHERE id = ${target.origin.challengeId}`);
      if (rows.length !== 1 || rows[0].tenantId !== tenantId || (rows[0].sourceWorkspaceId ?? undefined) !== target.workspaceId) {
        throw new CoreAccessError("denied", "Rental 原验证码挑战归属已变化");
      }
    } else if (target.origin.kind === "session") {
      // 仅核原指针的不可变归属；不先锁会话行，保留刷新原有 customer → session 锁序和一次消费 CAS。
      const rows = await transaction.$queryRaw<Array<{ tenantId: string; workspaceId: string }>>(sql`
        SELECT tenantId, workspaceId FROM client_auth_sessions
        WHERE id = ${target.origin.sessionId} AND refreshTokenHash = ${target.origin.refreshTokenHash}`);
      if (rows.length !== 1 || rows[0].tenantId !== tenantId || rows[0].workspaceId !== target.workspaceId) {
        throw new CoreAccessError("denied", "Rental 原刷新会话归属已变化");
      }
    } else if (target.origin.kind === "website-host") {
      const rows = await transaction.$queryRaw<Array<{ tenantId: string }>>(sql`
        SELECT tenantId FROM website_channel_profiles WHERE customDomain = ${target.origin.host} AND enabled = true LOCK IN SHARE MODE`);
      if (rows.length !== 1 || rows[0].tenantId !== tenantId) throw new CoreAccessError("denied", "Rental 原官网域名映射已变化");
    }
    current();
  };
  const fence = createRentalBusinessTenantFence(assertCurrent);
  const recheck = async () => {
    const target = current().target;
    if (!target) throw new CoreAccessError("denied", "Rental 公开请求尚无可信目标");
    await input.database.$transaction(tx => assertCurrent(tx, target.tenantId), { isolationLevel: "ReadCommitted" });
  };

  return Object.freeze({
    run<T>(consume: () => Promise<T>): Promise<T> {
      return fence.run(async () => {
        const scope: PublicScope = {
          active: true, bound: false, recheck,
          async bind(target) {
            const evidence = current();
            if (evidence.empty || !present(target?.tenantId) || !target.origin
              || target.workspaceId !== undefined && !present(target.workspaceId)
              || target.requirePublished && !target.workspaceId
              || target.origin.kind === "tenant-code" && !present(target.origin.tenantCode)
              || target.origin.kind === "challenge" && (!present(target.origin.challengeId) || evidence.method !== "POST"
                || !/^\/client\/v1\/auth\/registration\/challenges\/[^/]+\/verify$/u.test(evidence.path))
              || target.origin.kind === "session" && (!present(target.origin.sessionId) || !/^[a-f0-9]{64}$/u.test(target.origin.refreshTokenHash)
                || evidence.method !== "POST" || evidence.path !== "/client/v1/auth/refresh")
              || target.origin.kind === "website-host" && (!present(target.origin.host) || evidence.method !== "GET"
                || evidence.path !== "/client/v1/public/site-resolve")
              || !["tenant-code", "challenge", "session", "website-host"].includes(target.origin.kind)) {
              throw new CoreAccessError("denied", "Rental 公开目标未由原处理器解析或已绑定");
            }
            if (evidence.target) {
              // 原应用组合可重用同一公开服务；相同事实只复核，不切换已选权威或放宽发布/登录门槛。
              if (targetKey(evidence.target) !== targetKey(target)) throw new CoreAccessError("denied", "Rental 公开请求不能切换已绑定目标");
              await recheck();
              return;
            }
            evidence.target = Object.freeze({ ...target, origin: Object.freeze({ ...target.origin }) });
            await recheck();
          },
          empty(kind) {
            const evidence = current();
            if (evidence.target || evidence.empty || kind === "logout" && (evidence.method !== "POST" || evidence.path !== "/client/v1/auth/logout")
              || kind === "site-resolve" && (evidence.method !== "GET" || evidence.path !== "/client/v1/public/site-resolve")
              || !["logout", "site-resolve"].includes(kind)) throw new CoreAccessError("denied", "Rental 公开入口不能省略可信目标");
            evidence.empty = kind;
          }
        };
        owned.add(scope);
        return scopes.run(scope, async () => { try { return await consume(); } finally { scope.active = false; } });
      });
    },
    async withRequest<T>(request: RentalPublicAccessRequest, consume: () => Promise<T>, read?: { bufferedRead: true }): Promise<T> {
      fence.assertBound();
      const scope = scopes.getStore(), identity = getRequestIdentity();
      const method = request?.method?.toUpperCase(), path = matchableRequestPath(request?.url ?? "");
      if (!scope || !owned.has(scope) || !scope.active || scope.bound || !identity || request.user || request.client
        || identity.tenantId || identity.workspaceId || hasAuthority(identity)
        || !input.authorization.isClientPublicRoute(method, path)
        || (method === "GET" || method === "HEAD") !== (read?.bufferedRead === true)) {
        throw new CoreAccessError("denied", "Rental 公开入口需要唯一原 Guard 后的独立匿名范围");
      }
      scope.bound = true;
      scope.evidence = { request, method, path, sourceIdentity: identity };
      try {
        const result = await consume();
        if (!scope.evidence.target && !scope.evidence.empty) throw new CoreAccessError("denied", "Rental 公开处理器尚未接入可信目标");
        if (read?.bufferedRead) {
          if (scope.evidence.target) await recheck();
          else current();
        }
        return result;
      } finally { scope.active = false; }
    },
    assertCurrent
  });
}

export type RentalPublicApplicationAccess = ReturnType<typeof createRentalPublicApplicationAccess>;
