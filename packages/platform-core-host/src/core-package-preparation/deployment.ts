/** 原候选到可信宿主的单次部署提交。不可变意图先持久化，再调用静态执行端口；
 * 发布/事务失应答保留原 ID，只观察原结果，不把回调返回或文件存在推导为部署成功。 */
import { isDeepStrictEqual } from "node:util";
import { CoreAccessError } from "@rental-os/core-host";
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "../ports";
import { CorePackagePreparationRecordSchema, type CorePackagePreparationStore, type CorePackageDeploymentSourceGuard } from "./ports";
import { CorePackageDeploymentOperationSchema, CorePackageDeploymentRequestSchema, CorePackageDeploymentQuerySchema,
  CorePackageDeploymentObservationSchema, type CorePackageDeploymentApplication, type CorePackageDeploymentExecutor,
  type CorePackageDeploymentOperation, type CorePackageDeploymentResult } from "./deployment-ports";

export function composeCorePackageDeployment<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>; users: PlatformCoreUsers<Tx>; store?: CorePackagePreparationStore;
  guard: CorePackageDeploymentSourceGuard; executor?: CorePackageDeploymentExecutor; now?: () => number;
}): CorePackageDeploymentApplication {
  const now = input.now ?? Date.now, principals = new PlatformPrincipalAuthority(input.users, now);
  const executor = input.executor && { id: input.executor.id, authorize: input.executor.authorize.bind(input.executor),
    submit: input.executor.submit.bind(input.executor), observe: input.executor.observe.bind(input.executor) };
  const unavailable = (): CorePackageDeploymentResult => ({ status: "unavailable", error: {
    code: "deployment_executor_unavailable", message: "宿主未接入可信部署执行器及持久派发存储，候选仍为待部署"
  } });
  const unknown = (query: { sha256: string; dispatchId: string }): CorePackageDeploymentResult => ({ status: "unknown", ...query });
  async function locked<T>(work: (actor: CorePackageDeploymentOperation["actor"]) => Promise<T>): Promise<T> {
    const original = structuredClone(getRequestIdentity());
    return input.database.$transaction(async transaction => {
      const actor = principals.current(), lease = await principals.lock(transaction, actor, actor.tenantId);
      const check = (user: typeof lease.user) => {
        if (actor.tenantId !== "tenant_platform" || !user.isSaasAdmin
          || !user.permissions.includes("*") && !user.permissions.includes("system:tenant:manage")
          || !isDeepStrictEqual(original, getRequestIdentity()))
          throw new CoreAccessError("denied", "部署提交及原结果须由当前平台 SaaS 管理主体读取");
      };
      check(lease.user);
      try { return await work({ tenantId: actor.tenantId, userId: actor.subjectId }); }
      finally { check(await lease.revalidate()); }
    }, { isolationLevel: "ReadCommitted", timeout: 30_000 });
  }
  function original(query: { sha256: string; dispatchId: string }, actor: CorePackageDeploymentOperation["actor"], approval?: string) {
    const value = input.store?.readDeployment?.(query.sha256);
    if (!value) return undefined;
    const operation = CorePackageDeploymentOperationSchema.parse(value);
    if (operation.sha256 !== query.sha256 || operation.dispatchId !== query.dispatchId
      || !isDeepStrictEqual(operation.actor, actor) || approval !== undefined && operation.approvalReference !== approval)
      throw new CoreAccessError("operation_conflict", "原候选已绑定另一派发、主体或批准，须核对原 ID");
    return operation;
  }
  async function observe(operation: CorePackageDeploymentOperation): Promise<CorePackageDeploymentResult> {
    const query = { sha256: operation.sha256, dispatchId: operation.dispatchId };
    if (!executor || executor.id !== operation.executorId) return unknown(query);
    try {
      const saved = input.store!.read(query.sha256);
      if (saved.status !== "recorded") return unknown(query);
      const record = CorePackagePreparationRecordSchema.parse(saved.record);
      if (record.sha256 !== query.sha256 || requestFingerprint(record.plan) !== query.sha256) return unknown(query);
      const observed = CorePackageDeploymentObservationSchema.parse(await executor.observe(structuredClone(operation)));
      if (observed.sha256 !== query.sha256 || observed.dispatchId !== query.dispatchId) return unknown(query);
      // 成功来自同目标实际锁；失败必须证实仍为原组合。部分切换及缺依据保持 unknown。
      if (observed.status === "succeeded" && !isDeepStrictEqual(observed.current, record.plan.candidate)
        || observed.status === "failed" && !isDeepStrictEqual(observed.current, record.plan.base)) return unknown(query);
      return observed;
    } catch { return unknown(query); }
  }
  return {
    async dispatch(value) {
      const request = CorePackageDeploymentRequestSchema.parse(value);
      const query = { sha256: request.sha256, dispatchId: request.dispatchId };
      const prior = await locked(actor => Promise.resolve(original(query, actor, request.approvalReference)));
      if (prior) return locked(async actor => {
        const current = original(query, actor, request.approvalReference);
        return current ? observe(current) : unknown(query);
      });
      if (!executor || !input.store?.claimDeployment || !input.store.readDeployment) return unavailable();
      let claimedOrUncertain = false;
      try {
        await input.guard.withAccess(request.sha256, async (record, transaction, revalidate) => {
          const identity = getRequestIdentity();
          if (identity?.tenantId !== "tenant_platform" || !identity.userId || identity.audience !== "operator")
            throw new CoreAccessError("denied", "部署提交缺少原平台管理主体");
          const operation = CorePackageDeploymentOperationSchema.parse({ ...request, format: "core-deployment-dispatch-1",
            executorId: executor.id, actor: { tenantId: identity.tenantId, userId: identity.userId }, requestedAt: new Date(now()).toISOString() });
          await executor.authorize(transaction, structuredClone(operation), structuredClone(record));
          await revalidate();
          // 文件意图不随外部提交或数据库事务失败撤回；崩溃窗口只能沿同 ID 观察/人工恢复。
          claimedOrUncertain = true;
          const claim = input.store!.claimDeployment!(operation);
          claimedOrUncertain = claim.claimed;
          const checked = original(query, operation.actor, operation.approvalReference);
          if (!checked || !isDeepStrictEqual(claim.operation, checked) || checked.executorId !== executor.id)
            throw new CoreAccessError("operation_conflict", "部署派发意图与原候选不一致");
          if (claim.claimed) await executor.submit(structuredClone(checked), structuredClone(record));
        });
      } catch (error) {
        if (claimedOrUncertain) return unknown(query);
        throw error;
      }
      return locked(async actor => {
        const operation = original(query, actor, request.approvalReference);
        return operation ? observe(operation) : unknown(query);
      }).catch(() => unknown(query));
    },
    async receipt(value) {
      const query = CorePackageDeploymentQuerySchema.parse(value);
      return locked(async actor => {
        const operation = original(query, actor);
        return operation ? observe(operation) : unknown(query);
      });
    }
  };
}
