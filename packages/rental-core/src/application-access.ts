/** 旧 Rental HTTP 的标准 Core 准入与原业务父锁接点。只消费原 Guard 写入的身份，
 * 在业务原事务复核 Core 授权；不替代角色/对象/文件/客户授权，不包裹外部副作用或改写事务。
 * 未经过 mysql-business-fence 的直接写入和独立事务尚未覆盖，宿主须逐条接入后才能开放。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import { CoreBindingSchema, CoreScopeReferenceSchema, MemberCoreAssignmentSchema, TenantCoreGrantSchema,
  isCoreVersionSupported } from "@rental-os/core-contracts";
import { CoreAccessError, coreBindingScopeKey, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import type { PublicSubscriptionReader } from "@rental-os/platform-server/subscription-reader";
import type { ClientRequestContext } from "./client-context";
import type { createRentalAuthorization } from "./http-auth";
import { createRentalBusinessTenantFence, type RentalBusinessTenantTransaction } from "./mysql-business-fence";
import { RENTAL_CORE_ID, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { RENTAL_DATA_READABLE } from "./data";

/** These are the server request properties written/used by the original Guard,
 * not a DTO to populate from body/query parameters. Staff routing must run first. */
export interface RentalApplicationAccessRequest {
  method: string;
  url: string;
  user?: SystemUserRow;
  client?: ClientRequestContext;
}

/** Server route registration only. The consumer must return a buffered value,
 * without writing the response/stream or committing a business action. GET alone
 * cannot establish this: legacy media handlers can call res.send themselves. */
export interface RentalApplicationBufferedRead {
  bufferedRead: true;
  auditedRead?: never;
}

/** 原读取审计在自己的短事务提交，返回数据前仍复核当前准入。
 * 审计可能已持久化而返回被拒；此类型不适用于含业务动作或外部调用的 GET。 */
export interface RentalApplicationAuditedRead {
  auditedRead: true;
  bufferedRead?: never;
}

export interface RentalApplicationAccessDependencies {
  database: {
    $transaction<T>(consume: (transaction: RentalBusinessTenantTransaction) => Promise<T>,
      options: { isolationLevel: "ReadCommitted" }): Promise<T>;
  };
  /** Pass the policies returned by the SAME createRentalAuthorization as the Guard. */
  authorization: Pick<ReturnType<typeof createRentalAuthorization>, "isNewBusinessRoute" | "isTenantMembershipRoute"
    | "isClientRoute" | "isClientPublicRoute" | "requiredPermissions" | "UNMATCHED_ROUTE_PERMISSION">;
  /** The original public subscription policy needs only its real reader. No tenant
   * status, Core state or historical-result exemption is synthesized here. */
  term: { requireNewBusiness(transaction: PublicSubscriptionReader, tenantId: string): Promise<void> };
  /** A read-only SQL view delegating to the exact business transaction. Construct the
   * original deployment observer with this reader, never with the root database. */
  deploymentForTransaction(reader: Pick<CoreHostSqlTransaction, "$queryRaw">): CoreDeploymentAvailability;
}

type RequestEvidence = {
  active: boolean;
  request: RentalApplicationAccessRequest;
  method: string;
  path: string;
  tenantId: string;
  userId: string;
  audience: "operator" | "staff" | "client";
  workspaceId?: string;
  /** Client session remains client evidence; it is never used as an auth_sessions id. */
  sessionId: string;
  expiresAt?: number;
  sourceIdentity: NonNullable<ReturnType<typeof getRequestIdentity>>;
  identity: string;
  actor: string;
  tenantScope: boolean;
  newBusiness: boolean;
};
type ApplicationRequestScope = { bound: boolean; evidence?: RequestEvidence };
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function identityFingerprint() {
  const identity = getRequestIdentity();
  if (!identity) throw new CoreAccessError("denied", "Rental 请求缺少原 Guard 身份");
  return JSON.stringify({ tenantId: identity.tenantId, userId: identity.userId, audience: identity.audience,
    accessSession: identity.accessSession, workspaceId: identity.workspaceId, permissions: identity.permissions,
    isSaasAdmin: identity.isSaasAdmin, isPlatformAdmin: identity.isPlatformAdmin, dataScope: identity.dataScope,
    organizationId: identity.organizationId, locationScope: identity.locationScope,
    staffApi: identity.staffApi, staffLocationScope: identity.staffLocationScope });
}

function actorFingerprint(request: RentalApplicationAccessRequest, audience: RequestEvidence["audience"]) {
  if (audience === "client") {
    const client = request.client;
    return JSON.stringify(client && { tenantId: client.tenantId, customerId: client.customerId,
      customerType: client.customerType, workspaceId: client.workspaceId, sessionId: client.sessionId });
  }
  const user = request.user;
  return JSON.stringify(user && { id: user.id, tenantId: user.tenantId, isActive: user.isActive,
    mustChangePassword: user.mustChangePassword, isSaasAdmin: user.isSaasAdmin, isPlatformAdmin: user.isPlatformAdmin,
    permissions: user.permissions, dataScope: user.dataScope, organizationId: user.organizationId,
    locationScope: user.locationScope });
}

/** Subscription writers hold Tenant X before these rows. Current shared reads under
 * the existing parent lock also work when an original business caller uses RR;
 * an ordinary ORM read could otherwise reuse a snapshot from before a term change.
 * Only transport is adapted; the supplied public policy owns term projection. */
function currentSubscriptionReader(transaction: RentalBusinessTenantTransaction, tenantId: string): PublicSubscriptionReader {
  type State = NonNullable<Awaited<ReturnType<PublicSubscriptionReader["tenant"]["findUnique"]>>>;
  return { tenant: { async findUnique(query) {
    if (query.where.id !== tenantId) throw new CoreAccessError("denied", "Rental 订阅政策不能切换原事务租户");
    const subscriptions = await transaction.$queryRaw<Array<NonNullable<State["subscription"]>>>(sql`
      SELECT revision, startAt, endAt FROM tenant_subscriptions WHERE tenantId = ${tenantId} LOCK IN SHARE MODE`);
    if (subscriptions.length > 1) throw new CoreAccessError("core_unavailable", "原租户统一期限记录不唯一");
    const subscriptionSegments = await transaction.$queryRaw<State["subscriptionSegments"]>(sql`
      SELECT id, status, startAt, endAt FROM tenant_subscription_segments
      WHERE tenantId = ${tenantId} AND status = 'SCHEDULED' ORDER BY id LOCK IN SHARE MODE`);
    return { subscription: subscriptions[0] ?? null, subscriptionSegments };
  } } };
}

/** Create once per createRentalApplication. run belongs around the request pipeline;
 * after the original Guard succeeds, withRequest encloses the awaited controller work.
 * Registered buffered GET/HEAD reads receive admission and pre-return transactions.
 * Existing writes re-enter assertCurrent
 * through their original parent fence, holding Core locks until THEIR commit.
 * This does not claim that request admission revalidates an uncovered write at commit.
 */
export function createRentalApplicationAccess(input: RentalApplicationAccessDependencies) {
  if (typeof input?.database?.$transaction !== "function" || typeof input.term?.requireNewBusiness !== "function"
    || typeof input.deploymentForTransaction !== "function" || !input.authorization
    || (["isNewBusinessRoute", "isTenantMembershipRoute", "isClientRoute", "isClientPublicRoute", "requiredPermissions"] as const)
      .some(method => typeof input.authorization[method] !== "function")) {
    throw new CoreAccessError("core_unavailable", "Rental HTTP 缺少原路由政策、事务、订阅或实际部署观察器");
  }
  const requests = new AsyncLocalStorage<ApplicationRequestScope>();
  const policy = input.authorization;

  const capture = (request: RentalApplicationAccessRequest): RequestEvidence => {
    const identity = getRequestIdentity();
    if (!identity || !nonempty(identity.tenantId) || !nonempty(identity.userId) || identity.isSaasAdmin !== false
      || !["operator", "staff", "client"].includes(identity.audience ?? "")
      || !nonempty(request?.method) || !nonempty(request.url)) {
      throw new CoreAccessError("denied", "Rental HTTP 需要原 Guard 已核定的租户业务主体");
    }
    const method = request.method.toUpperCase(), path = matchableRequestPath(request.url);
    const workspaceId = identity.workspaceId;
    if (workspaceId !== undefined && !nonempty(workspaceId)) {
      throw new CoreAccessError("denied", "Rental HTTP 原经营空间无效");
    }
    let audience: RequestEvidence["audience"], sessionId: string, expiresAt: number | undefined;
    if (identity.audience === "client") {
      const client = request.client;
      if (!policy.isClientRoute(path) || policy.isClientPublicRoute(method, path) || request.user
        || !client || client.tenantId !== identity.tenantId || client.customerId !== identity.userId
        || !nonempty(workspaceId) || client.workspaceId !== workspaceId || !nonempty(client.sessionId)) {
        throw new CoreAccessError("denied", "Rental 客户请求缺少原专用会话或业务范围不一致");
      }
      audience = "client";
      sessionId = client.sessionId;
    } else {
      const user = request.user, session = identity.accessSession;
      if (policy.isClientRoute(path) || request.client || !user || user.id !== identity.userId
        || user.tenantId !== identity.tenantId || !user.isActive || user.mustChangePassword || user.isSaasAdmin
        || !session || !nonempty(session.sessionId) || !Number.isSafeInteger(session.expiresAt)
        || session.expiresAt <= Date.now() / 1000
        || session.workspaceId !== undefined && session.workspaceId !== null && session.workspaceId !== workspaceId
        || session.workspaceId === null && workspaceId !== undefined
        || policy.requiredPermissions(method, path).includes(policy.UNMATCHED_ROUTE_PERMISSION)) {
        throw new CoreAccessError("denied", "Rental 成员请求缺少原有效会话、账号或已登记的动作政策");
      }
      audience = identity.audience === "staff" ? "staff" : "operator";
      if (Boolean(identity.staffApi) !== (audience === "staff")) {
        throw new CoreAccessError("denied", "Rental 员工请求与原 Guard 分面不一致");
      }
      sessionId = session.sessionId;
      expiresAt = session.expiresAt;
    }
    const tenantScope = audience !== "client" && policy.isTenantMembershipRoute(path);
    if (!tenantScope && !workspaceId) throw new CoreAccessError("denied", "Rental 经营请求缺少原受权空间，不能退回租户范围");
    return { active: true, request, method, path, tenantId: identity.tenantId, userId: identity.userId,
      audience, workspaceId, sessionId, expiresAt, identity: identityFingerprint(),
      sourceIdentity: identity, actor: actorFingerprint(request, audience), tenantScope,
      newBusiness: policy.isNewBusinessRoute(method, path) };
  };

  const assertEvidence = (evidence: RequestEvidence) => {
    fence.assertBound();
    if (!evidence.active || requests.getStore()?.evidence !== evidence
      || getRequestIdentity() !== evidence.sourceIdentity
      || identityFingerprint() !== evidence.identity || actorFingerprint(evidence.request, evidence.audience) !== evidence.actor
      || evidence.request.method.toUpperCase() !== evidence.method || matchableRequestPath(evidence.request.url) !== evidence.path
      || evidence.expiresAt !== undefined && evidence.expiresAt <= Date.now() / 1000) {
      throw new CoreAccessError("denied", "Rental 请求已结束，或原主体、会话、动作和空间已变化");
    }
  };

  const assertCurrent = async (transaction: RentalBusinessTenantTransaction, tenantId: string): Promise<void> => {
    fence.assertBound();
    const evidence = requests.getStore()?.evidence;
    if (!evidence || !evidence.active || tenantId !== evidence.tenantId || typeof transaction?.$queryRaw !== "function"
      || "$transaction" in transaction) {
      throw new CoreAccessError("denied", "Rental 事务未绑定本请求的原身份与租户");
    }
    assertEvidence(evidence);
    const scope = CoreScopeReferenceSchema.parse({ coreId: RENTAL_CORE_ID, tenantId,
      ...(!evidence.tenantScope ? { container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: evidence.workspaceId } } : {}) });
    const scopeKey = coreBindingScopeKey(scope), scopeHash = createHash("sha256").update(scopeKey).digest("hex");
    // Core management takes the tenant parent before the Core gate. Shared current
    // reads preserve that order and never upgrade the existing business parent lock.
    // No workspace/config/principal lock is introduced ahead of an original order lock.
    const tenants = await transaction.$queryRaw<Array<{ id: string; status: string }>>(sql`
      SELECT id, status FROM Tenant WHERE id = ${tenantId} LOCK IN SHARE MODE`);
    if (tenants.length !== 1 || tenants[0].id !== tenantId || tenants[0].status?.toLowerCase() !== "active") {
      throw new CoreAccessError("denied", "Rental 租户当前不可用；尚无停用后的专项善后授权");
    }
    const gates = await transaction.$queryRaw<Array<{ tenantId: string; coreId: string }>>(sql`
      SELECT tenant_id AS tenantId, core_id AS coreId FROM platform_core_access_locks
      WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    if (gates.length !== 1 || gates[0].tenantId !== tenantId || gates[0].coreId !== RENTAL_CORE_ID) {
      throw new CoreAccessError("denied", "Rental 缺少已登记的租户 Core 门禁");
    }
    type AccessRow = { state: string; revision: bigint | number; operationId: string };
    const grants = await transaction.$queryRaw<AccessRow[]>(sql`
      SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants
      WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    const grant = grants.length === 1 ? TenantCoreGrantSchema.safeParse({ ...grants[0],
      revision: Number(grants[0].revision), tenantId, coreId: RENTAL_CORE_ID }) : undefined;
    if (!grant?.success || grant.data.state !== "enabled") {
      throw new CoreAccessError("denied", "Rental Core 当前未获租户授权；停用后的善后政策尚未登记");
    }
    if (evidence.audience !== "client") {
      const assignments = await transaction.$queryRaw<AccessRow[]>(sql`
        SELECT state, revision, operation_id AS operationId FROM platform_member_core_assignments
        WHERE tenant_id = ${tenantId} AND core_id = ${RENTAL_CORE_ID} AND user_id = ${evidence.userId} LOCK IN SHARE MODE`);
      const assignment = assignments.length === 1 ? MemberCoreAssignmentSchema.safeParse({ ...assignments[0],
        revision: Number(assignments[0].revision), tenantId, coreId: RENTAL_CORE_ID, userId: evidence.userId }) : undefined;
      if (!assignment?.success || assignment.data.state !== "assigned") {
        throw new CoreAccessError("denied", "当前成员未分配 Rental Core 或使用权已撤回");
      }
    }
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
      throw new CoreAccessError("denied", "Rental 原绑定缺失、业务范围不符或数据版本不兼容");
    }
    // Adapt only SQL call shape/PromiseLike; every query still executes on the same
    // transaction. No whole-client cast, connection swap, ORM proxy or nested commit.
    const reader: Pick<CoreHostSqlTransaction, "$queryRaw"> = {
      async $queryRaw<T>(query: TemplateStringsArray | Sql, ...values: unknown[]): Promise<T> {
        return transaction.$queryRaw<T>("raw" in query ? sql(query, ...values) : query);
      }
    };
    const deployment = input.deploymentForTransaction(reader);
    if (typeof deployment?.requireAvailable !== "function") {
      throw new CoreAccessError("core_unavailable", "Rental 缺少业务同事务的实际部署观察器");
    }
    await deployment.requireAvailable(RENTAL_CORE_ID, tenantId);
    if (evidence.newBusiness) {
      await input.term.requireNewBusiness(currentSubscriptionReader(transaction, tenantId), tenantId);
    }
    assertEvidence(evidence);
  };
  const fence = createRentalBusinessTenantFence(assertCurrent);

  return Object.freeze({
    /** Required host selection, including the phase before the original Guard has
     * bound a request. Business writes in that phase fail closed, not legacy fallback. */
    run<T>(consume: () => Promise<T>): Promise<T> {
      return fence.run(() => requests.run({ bound: false }, consume));
    },
    async withRequest<T>(request: RentalApplicationAccessRequest, consume: () => Promise<T>,
      read?: RentalApplicationBufferedRead | RentalApplicationAuditedRead): Promise<T> {
      fence.assertBound();
      const scope = requests.getStore();
      if (!scope || scope.bound) throw new CoreAccessError("denied", "Rental 应用请求只能绑定一次原 Guard 身份");
      scope.bound = true;
      const evidence = capture(request);
      const isRead = evidence.method === "GET" || evidence.method === "HEAD";
      const buffered = read?.bufferedRead === true, audited = read?.auditedRead === true;
      if (buffered && audited || isRead !== (buffered || audited)) {
        throw new CoreAccessError("denied", "Rental GET/HEAD 须明确登记缓冲纯读或独立事务审计读取；其他方法不能借读取回查执行");
      }
      scope.evidence = evidence;
      try {
        await input.database.$transaction(transaction => assertCurrent(transaction, evidence.tenantId),
          { isolationLevel: "ReadCommitted" });
        const result = await consume();
        // Keep writes' original commit/receipt semantics. A post-commit denial must
        // not disguise a successful write or suggest that it is safe to retry.
        if (isRead) await input.database.$transaction(transaction => assertCurrent(transaction, evidence.tenantId),
          { isolationLevel: "ReadCommitted" });
        return result;
      } finally { evidence.active = false; }
    },
    assertCurrent
  });
}

export type RentalApplicationAccess = ReturnType<typeof createRentalApplicationAccess>;
