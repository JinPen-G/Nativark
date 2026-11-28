/**
 * 客户端一次派发与原结果入口。原键由 Core 准备，派发前由宿主持久保留定位。
 * unknown/取消/失应答仅读原收据；此层不确认业务提交、不生成替代键、不重试写入。
 */
import { ClientError, type ClientOperationReference, type ClientOperationResult, type ClientOperationStore,
  type ClientPageRequest, type ClientScope } from "./contracts";
import { clientScopeKey, type ClientRuntime } from "./runtime";

/** 原定位可在同一本人再次登录后核对，当前权限仍由每次原收据读取检查。 */
export function clientOperationOwnerKey(scope: ClientScope): string {
  return JSON.stringify([scope.principal.audience, scope.principal.tenantId, scope.principal.subjectId,
    scope.workspaceId ?? null, scope.locationId ?? null]);
}
function same(left: ClientOperationReference, right: ClientOperationReference) {
  return ["operationKey", "coreId", "routeId", "actionId", "targetId"].every(key =>
    left[key as keyof ClientOperationReference] === right[key as keyof ClientOperationReference]);
}
function valid(reference: ClientOperationReference) {
  return reference && [reference.operationKey, reference.coreId, reference.routeId, reference.actionId, reference.targetId]
    .every(value => typeof value === "string" && value.length > 0 && value.length <= 256);
}
function capture(reference: ClientOperationReference): ClientOperationReference {
  return Object.freeze({ operationKey: reference.operationKey, coreId: reference.coreId, routeId: reference.routeId,
    actionId: reference.actionId, targetId: reference.targetId });
}

export function createClientOperations(runtime: ClientRuntime, store: ClientOperationStore) {
  const busy = new Set<string>();
  function binding(routeId: string, actionId: string) {
    const { contribution, route } = runtime.find(routeId), action = route.actions?.find(value => value.id === actionId);
    if (!action) throw new ClientError("unavailable");
    return { contribution, action };
  }
  async function accept(owner: ClientScope, reference: ClientOperationReference, result: ClientOperationResult) {
    if (!result || !valid(result.reference) || !same(reference, result.reference)
      || !["recorded", "rejected", "unknown"].includes(result.status)) throw new ClientError("unavailable");
    if (result.status !== "unknown") {
      // 本地删除失败不改写已观察的原结果；保留定位只会要求再次只读核对。
      try { await store.remove(owner, reference); } catch { /* 持久原定位保持。 */ }
    }
    return result;
  }
  return {
    async pending(routeId: string) {
      return runtime.withAccess(routeId, "original_receipt", "pending-operations", async (owner, life) => {
        const references = await store.read(owner); life.assertCurrent();
        return references.filter(reference => valid(reference) && reference.routeId === routeId
          && reference.coreId === runtime.find(routeId).contribution.coreId).map(capture);
      });
    },
    async execute(routeId: string, actionId: string, request: ClientPageRequest,
      values: Readonly<Record<string, string>> = {}): Promise<ClientOperationResult> {
      const { contribution, action } = binding(routeId, actionId), owner = runtime.scope();
      const input = Object.freeze({ ...values }), page = { params: Object.freeze({ ...request.params }), search: request.search };
      const epoch = runtime.getRevision();
      const current = () => {
        const state = runtime.getSnapshot();
        return state.status === "authenticated" && runtime.getRevision() === epoch && clientScopeKey(state.scope) === clientScopeKey(owner);
      };
      const slot = JSON.stringify([clientOperationOwnerKey(owner), routeId, actionId]);
      if (busy.has(slot)) throw new ClientError("operation_pending");
      busy.add(slot);
      let reference: ClientOperationReference | undefined;
      try {
        const prepared = await runtime.withAccess(routeId, "action", "prepare-operation", async (current, life) => {
          const retained = await store.read(current); life.assertCurrent();
          if (retained.some(value => value.coreId === contribution.coreId && value.routeId === routeId && value.actionId === actionId))
            throw new ClientError("operation_pending");
          return action.prepare(page, input, current, life);
        }, actionId, { request: page });
        if (!valid(prepared.reference) || prepared.reference.coreId !== contribution.coreId
          || prepared.reference.routeId !== routeId || prepared.reference.actionId !== actionId) throw new ClientError("unavailable");
        const candidate = capture(prepared.reference);
        await store.save(owner, candidate); // 无持久定位时不派发，刷新页面仍只核对原键。
        reference = candidate;
        if (!current()) throw new ClientError("stale");
        const result = await runtime.withAccess(routeId, "action", "execute-operation", (_current, life) => prepared.execute(life), actionId,
          { request: page, reference });
        const accepted = await accept(owner, reference, result);
        if (!current()) throw new ClientError("stale");
        return accepted;
      } catch (error) {
        if (!current()) throw new ClientError("stale");
        if (!reference || error instanceof ClientError && error.code === "stale") throw error;
        return { status: "unknown", reference };
      } finally { busy.delete(slot); }
    },
    async readReceipt(reference: ClientOperationReference): Promise<ClientOperationResult> {
      const fixed = capture(reference), { contribution, action } = binding(fixed.routeId, fixed.actionId);
      if (!valid(fixed) || fixed.coreId !== contribution.coreId) throw new ClientError("unavailable");
      const owner = runtime.scope();
      const epoch = runtime.getRevision();
      const result = await runtime.withAccess(fixed.routeId, "original_receipt", `receipt:${fixed.operationKey}`,
        (current, life) => action.readReceipt(fixed, current, life), fixed.actionId, { reference: fixed });
      const accepted = await accept(owner, fixed, result), state = runtime.getSnapshot();
      if (state.status !== "authenticated" || runtime.getRevision() !== epoch || clientScopeKey(state.scope) !== clientScopeKey(owner))
        throw new ClientError("stale");
      return accepted;
    },
  };
}
export type ClientOperations = ReturnType<typeof createClientOperations>;
