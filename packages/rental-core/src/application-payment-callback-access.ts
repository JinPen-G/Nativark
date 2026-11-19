/** 已验签支付回调的原对象范围。只消费原支付服务核实的持久单据，不能创建支付、退款或用户身份。
 * 原 Tenant/Core → Order → Workspace/集成 → 支付单锁序仍由原事务持有；停用只允许此处明确的结果收口。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import { CoreBindingSchema, CoreScopeReferenceSchema, TenantCoreGrantSchema, isCoreVersionSupported } from "@rental-os/core-contracts";
import { CoreAccessError, coreBindingScopeKey, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import { createRentalBusinessTenantFence, hasRentalBusinessTenantFence, type RentalBusinessTenantTransaction } from "./mysql-business-fence";
import { RENTAL_CORE_ID, RENTAL_WORKSPACE_CONTAINER_TYPE } from "./core-identity";
import { RENTAL_DATA_READABLE } from "./data";

type Provider = "alipay" | "wechat_pay" | "stripe";
export type RentalVerifiedPaymentCallbackSubject = Readonly<{
  kind: "payment" | "refund";
  tenantId: string;
  workspaceId: string;
  orderId: string;
  id: string;
  provider: Provider;
  method: string;
  merchantNo: string;
  currency: string;
  amount: number;
  paymentIntentId?: string;
}>;
type VerifyConfiguration = (transaction: RentalBusinessTenantTransaction) => Promise<void>;
type CallbackRequest = { method: string; url: string; user?: unknown; client?: unknown };
type RequestEvidence = { active: boolean; request: CallbackRequest; path: string; provider: Provider;
  kind: "payment" | "refund" | "both"; identity: NonNullable<ReturnType<typeof getRequestIdentity>> };
type SubjectEvidence = { active: boolean; subject: RentalVerifiedPaymentCallbackSubject; configuration: VerifyConfiguration };
type SelectedCallbacks = { withVerified<T>(subject: RentalVerifiedPaymentCallbackSubject,
  configuration: VerifyConfiguration, consume: () => Promise<T>): Promise<T> };
const selections = new AsyncLocalStorage<SelectedCallbacks>();

const callbackPaths = new Map<string, { provider: Provider; kind: RequestEvidence["kind"] }>([
  ["/payments/webhooks/alipay", { provider: "alipay", kind: "payment" }],
  ["/payments/webhooks/wechat_pay", { provider: "wechat_pay", kind: "payment" }],
  ["/payments/webhooks/stripe", { provider: "stripe", kind: "both" }],
  ["/payments/webhooks/alipay/refund", { provider: "alipay", kind: "refund" }],
  ["/payments/webhooks/wechat_pay/refund", { provider: "wechat_pay", kind: "refund" }]
]);

export function isRentalPaymentCallbackRoute(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && callbackPaths.has(matchableRequestPath(path));
}

/** Called only after the original provider signature, merchant and amount checks.
 * A selected HTTP request cannot fall back to legacy behavior when its binder is missing.
 * Legacy applications retain their original authority and transaction contracts. */
export function withVerifiedRentalPaymentCallback<T>(subject: RentalVerifiedPaymentCallbackSubject,
  configuration: VerifyConfiguration, consume: () => Promise<T>): Promise<T> {
  const selected = selections.getStore();
  if (selected) return selected.withVerified(subject, configuration, consume);
  if (hasRentalBusinessTenantFence()) throw new CoreAccessError("denied", "支付回调缺少本宿主的已验签原对象范围");
  return consume();
}

/** Scope is selected before the sole original Guard. Neither headers nor an empty
 * request identity authorize a transaction: an original verified subject must be bound.
 */
export function createRentalPaymentCallbackAccess(input: {
  database: { $transaction<T>(consume: (transaction: RentalBusinessTenantTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" }): Promise<T> };
  deploymentForTransaction(reader: Pick<CoreHostSqlTransaction, "$queryRaw">): CoreDeploymentAvailability;
}) {
  if (typeof input?.database?.$transaction !== "function" || typeof input.deploymentForTransaction !== "function") {
    throw new CoreAccessError("core_unavailable", "Rental 支付回调缺少原事务和实际部署观察");
  }
  const requests = new AsyncLocalStorage<{ bound: boolean; evidence?: RequestEvidence }>();
  const subjects = new AsyncLocalStorage<SubjectEvidence>();
  const deny = (message: string): never => { throw new CoreAccessError("denied", message); };
  const assertEvidence = () => {
    const request = requests.getStore()?.evidence, evidence = subjects.getStore();
    if (!request?.active || !evidence?.active || getRequestIdentity() !== request.identity
      || request.request.method.toUpperCase() !== "POST" || matchableRequestPath(request.request.url) !== request.path
      || request.request.user || request.request.client || request.identity.tenantId || request.identity.userId
      || request.identity.audience || request.identity.workspaceId || request.identity.accessSession
      || request.provider !== evidence.subject.provider || request.kind !== "both" && request.kind !== evidence.subject.kind) {
      return deny("支付回调请求、原签名渠道或原对象范围已变化");
    }
    return evidence;
  };
  const assertParent = async (tx: RentalBusinessTenantTransaction, tenantId: string) => {
    fence.assertBound();
    const { subject } = assertEvidence();
    if (tenantId !== subject.tenantId || typeof tx?.$queryRaw !== "function" || "$transaction" in tx) {
      return deny("支付回调必须使用原租户和原业务事务");
    }
    const tenants = await tx.$queryRaw<Array<{ id: string; status: string }>>(sql`
      SELECT id, status FROM Tenant WHERE id=${tenantId} LOCK IN SHARE MODE`);
    if (tenants.length !== 1 || tenants[0].id !== tenantId || tenants[0].status?.toLowerCase() !== "active") {
      return deny("租户冻结后的支付善后政策尚未授权");
    }
    const gates = await tx.$queryRaw<Array<{ tenantId: string; coreId: string }>>(sql`
      SELECT tenant_id AS tenantId, core_id AS coreId FROM platform_core_access_locks
      WHERE tenant_id=${tenantId} AND core_id=${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    if (gates.length !== 1 || gates[0].tenantId !== tenantId || gates[0].coreId !== RENTAL_CORE_ID) return deny("支付回调缺少原 Core 门禁");
    const grants = await tx.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>(sql`
      SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants
      WHERE tenant_id=${tenantId} AND core_id=${RENTAL_CORE_ID} LOCK IN SHARE MODE`);
    const grant = grants.length === 1 ? TenantCoreGrantSchema.safeParse({ ...grants[0],
      revision: Number(grants[0].revision), tenantId, coreId: RENTAL_CORE_ID }) : undefined;
    if (!grant?.success || !["enabled", "disabled"].includes(grant.data.state)) return deny("支付回调缺少已登记的原 Core 授权记录");
    // PCH-R04.4/.7: disabled closes ordinary admission. A verified provider result
    // for an existing immutable payment/refund is a separate current settlement
    // authority; it never creates an order/payment/refund or invokes a provider.
    const scope = CoreScopeReferenceSchema.parse({ coreId: RENTAL_CORE_ID, tenantId,
      container: { type: RENTAL_WORKSPACE_CONTAINER_TYPE, id: subject.workspaceId } });
    const key = coreBindingScopeKey(scope), hash = createHash("sha256").update(key).digest("hex");
    const rows = await tx.$queryRaw<Array<{ bindingId: string; revision: bigint | number; dataVersion: string;
      containerType: string; containerId: string }>>(sql`
      SELECT binding_id AS bindingId, revision, data_version AS dataVersion,
        container_type AS containerType, container_id AS containerId FROM platform_core_bindings
      WHERE tenant_id=${tenantId} AND core_id=${RENTAL_CORE_ID} AND scope_hash=${hash} LOCK IN SHARE MODE`);
    const binding = rows.length === 1 ? CoreBindingSchema.safeParse({ coreId: RENTAL_CORE_ID, tenantId,
      bindingId: rows[0].bindingId, revision: Number(rows[0].revision), dataVersion: rows[0].dataVersion,
      container: { type: rows[0].containerType, id: rows[0].containerId } }) : undefined;
    if (!binding?.success || coreBindingScopeKey(binding.data) !== key
      || !isCoreVersionSupported(binding.data.dataVersion, RENTAL_DATA_READABLE)) return deny("支付回调原业务绑定或数据版本不可用");
    const reader: Pick<CoreHostSqlTransaction, "$queryRaw"> = { async $queryRaw<T>(query: TemplateStringsArray | Sql, ...values: unknown[]) {
      return tx.$queryRaw<T>("raw" in query ? sql(query, ...values) : query);
    } };
    await input.deploymentForTransaction(reader).requireAvailable(RENTAL_CORE_ID, tenantId);
    assertEvidence();
  };
  const assertOperation = async (tx: RentalBusinessTenantTransaction, tenantId: string, workspaceId: string) => {
    const evidence = assertEvidence(), { subject } = evidence;
    if (tenantId !== subject.tenantId || workspaceId !== subject.workspaceId) return deny("支付回调不能切换原经营空间");
    await assertParent(tx, tenantId);
    // The caller holds its original Order X first; this never introduces a reverse
    // Workspace -> Order lock acquisition into payment/funding participants.
    const workspaces = await tx.$queryRaw<Array<{ id: string; tenantId: string; status: string }>>(sql`
      SELECT id, tenantId, status FROM business_workspaces WHERE tenantId=${tenantId} AND id=${workspaceId} FOR UPDATE`);
    if (workspaces.length !== 1 || workspaces[0].id !== workspaceId || workspaces[0].tenantId !== tenantId
      || workspaces[0].status?.toLowerCase() !== "active") return deny("支付回调原经营空间不可用");
    await evidence.configuration(tx);
    assertEvidence();
  };
  const fence = createRentalBusinessTenantFence(assertParent, undefined, assertOperation);
  const withVerified: SelectedCallbacks["withVerified"] = async (value, configuration, consume) => {
    const request = requests.getStore()?.evidence;
    if (!request?.active || subjects.getStore() || typeof configuration !== "function" || typeof consume !== "function") {
      return deny("支付回调原对象不能嵌套、过期或在请求外绑定");
    }
    const subject = Object.freeze({ ...value });
    if (!["payment", "refund"].includes(subject.kind) || !["alipay", "wechat_pay", "stripe"].includes(subject.provider)
      || [subject.tenantId, subject.workspaceId, subject.orderId, subject.id, subject.method, subject.merchantNo, subject.currency]
        .some(part => typeof part !== "string" || !part.trim() || part.length > 191)
      || subject.method !== subject.provider || !Number.isFinite(subject.amount) || subject.amount <= 0
      || subject.kind === "refund" && (typeof subject.paymentIntentId !== "string" || !subject.paymentIntentId.trim())) {
      return deny("支付回调缺少原持久单据的完整不可变依据");
    }
    const evidence: SubjectEvidence = { active: true, subject, configuration };
    return subjects.run(evidence, async () => {
      try {
        await input.database.$transaction(async tx => {
          await assertParent(tx, subject.tenantId);
          const orders = await tx.$queryRaw<Array<{ id: string }>>(sql`SELECT id FROM rental_orders
            WHERE tenantId=${subject.tenantId} AND workspaceId=${subject.workspaceId} AND id=${subject.orderId} FOR UPDATE`);
          if (orders.length !== 1 || orders[0].id !== subject.orderId) return deny("支付回调缺少原订单");
          await assertOperation(tx, subject.tenantId, subject.workspaceId);
          type Original = { id: string; tenantId: string; workspaceId: string; orderId: string; provider: string;
            method: string; currency: string; amount: unknown; merchantOrderNo?: string; merchantRefundNo?: string; paymentIntentId?: string };
          const rows = subject.kind === "payment"
            ? await tx.$queryRaw<Original[]>(sql`SELECT * FROM rental_payment_intents WHERE tenantId=${subject.tenantId} AND id=${subject.id} FOR UPDATE`)
            : await tx.$queryRaw<Original[]>(sql`SELECT * FROM rental_payment_refunds WHERE tenantId=${subject.tenantId} AND id=${subject.id} FOR UPDATE`);
          const original = rows.length === 1 ? rows[0] : undefined;
          if (!original || ["id", "tenantId", "workspaceId", "orderId", "provider", "method", "currency"].some(key =>
            original[key as keyof Original] !== subject[key as keyof RentalVerifiedPaymentCallbackSubject])
            || Number(original.amount) !== subject.amount
            || (subject.kind === "payment" ? original.merchantOrderNo : original.merchantRefundNo) !== subject.merchantNo
            || subject.kind === "refund" && original.paymentIntentId !== subject.paymentIntentId) return deny("支付回调原单据已变化");
          assertEvidence();
        }, { isolationLevel: "ReadCommitted" });
        // No post-commit admission: original result CAS and funding receipts own
        // outcomes. Failure/unknown cannot be converted into permission to resend.
        return await consume();
      } finally { evidence.active = false; }
    });
  };
  return Object.freeze({
    run<T>(consume: () => Promise<T>): Promise<T> {
      if (selections.getStore()) return Promise.reject(new CoreAccessError("denied", "支付回调不能切换应用范围"));
      return fence.run(() => requests.run({ bound: false }, () => selections.run({ withVerified }, consume)));
    },
    async withRequest<T>(request: CallbackRequest, consume: () => Promise<T>): Promise<T> {
      fence.assertBound();
      const scope = requests.getStore(), path = matchableRequestPath(request.url), route = callbackPaths.get(path), identity = getRequestIdentity();
      if (!scope || scope.bound || !route || request.method.toUpperCase() !== "POST" || !identity
        || request.user || request.client || identity.tenantId || identity.userId || identity.audience || identity.workspaceId || identity.accessSession) {
        return deny("支付回调须由原匿名 Guard 与精确回调路径进入");
      }
      scope.bound = true;
      const evidence: RequestEvidence = { active: true, request, path, ...route, identity };
      scope.evidence = evidence;
      try { return await consume(); }
      finally { evidence.active = false; }
    }
  });
}

export type RentalPaymentCallbackAccess = ReturnType<typeof createRentalPaymentCallbackAccess>;
