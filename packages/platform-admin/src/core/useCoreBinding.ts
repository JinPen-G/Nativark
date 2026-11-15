/** Core首次设置复用原绑定/收据接口；本机只保留核对引用，结果未知不重发，也不保存初始化配置。 */
import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BindCoreScopeSchema, CoreBindingOperationQuerySchema, type CoreBinding,
  type CoreBindingOperationQuery, type CoreScopeReference } from "@rental-os/core-contracts";
import { useAdminSession, useAdminRuntime } from "../runtime";
import { useCoreManagementApi, coreManagementRejectedBeforeCommit } from "./management-client";
import { useCoreSession } from "./useCoreSession";

export function useCoreBinding(coreId: string, container?: CoreScopeReference["container"]) {
  const { currentSessionEpoch } = useAdminRuntime(), coreManagementApi = useCoreManagementApi();
  const { tenant, user, sessionVerified } = useAdminSession(), session = useCoreSession(), client = useQueryClient();
  const epoch = currentSessionEpoch();
  const scope = { coreId, ...(container ? { container } : {}) };
  const journalKey = JSON.stringify(["core-binding-operation", tenant?.tenantId, user?.id, coreId, container?.type, container?.id]);
  const generation = JSON.stringify([epoch, journalKey]);
  const canManage = Boolean(sessionVerified && session.data?.canManageMembers);
  const canInitialize = canManage && session.canAccess(coreId, []);
  const loadReference = () => {
    const saved = window.sessionStorage.getItem(journalKey);
    if (!saved) return;
    const reference = CoreBindingOperationQuerySchema.parse(JSON.parse(saved));
    if (reference.coreId !== coreId || reference.container?.type !== container?.type || reference.container?.id !== container?.id)
      throw new Error("原Core设置操作不属于当前范围");
    return reference;
  };
  const [original, setOriginal] = useState<CoreBindingOperationQuery | undefined>(loadReference);
  const reference = useRef(original);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<"rejected" | "unknown" | "unavailable">();
  const lifetime = useRef<{ generation: string; controller: AbortController } | null>(null);
  const inFlight = useRef<Promise<CoreBinding> | null>(null);
  const live = useRef({ generation, canManage, canInitialize }); live.current = { generation, canManage, canInitialize };
  useLayoutEffect(() => {
    const controller = new AbortController(); lifetime.current = { generation, controller };
    inFlight.current = null; setBusy(false);
    reference.current = loadReference(); setOriginal(reference.current); setFailure(undefined);
    return () => controller.abort();
  }, [generation]);
  const validateBinding = (binding: CoreBinding) => {
    if (binding.tenantId !== tenant?.tenantId || binding.coreId !== coreId
      || binding.container?.type !== container?.type || binding.container?.id !== container?.id)
      throw new Error("Core设置结果与当前范围不一致");
    return binding;
  };
  const query = useQuery({
    queryKey: ["platform-core-binding", epoch, tenant?.tenantId, user?.id, coreId, container?.type, container?.id],
    queryFn: async ({ signal }) => {
      const observation = await coreManagementApi.binding(scope, signal);
      if (observation.status === "recorded") validateBinding(observation.binding);
      return observation;
    }, enabled: canManage, meta: { liveRefresh: false }
  });
  const current = () => {
    const boundary = lifetime.current;
    if (!live.current.canManage || currentSessionEpoch() !== epoch || live.current.generation !== generation || boundary?.generation !== generation
      || boundary.controller.signal.aborted) throw new DOMException("原Core设置页面已失效", "AbortError");
    return boundary.controller.signal;
  };
  const clearOriginal = () => { window.sessionStorage.removeItem(journalKey); reference.current = undefined; setOriginal(undefined); setFailure(undefined); };
  const refresh = async () => {
    await query.refetch();
    // 配置页的绑定代次变化会释放旧页面；失效观察只标脏，下一次访问按原query取真实状态。
    await client.invalidateQueries({ queryKey: ["platform-core-scope"], refetchType: "none" });
  };
  const run = (work: (signal: AbortSignal) => Promise<CoreBinding>) => {
    if (inFlight.current) return inFlight.current;
    const signal = current(); setBusy(true);
    const pending = work(signal).finally(() => {
      if (inFlight.current === pending) inFlight.current = null;
      if (!signal.aborted && live.current.generation === generation) setBusy(false);
    });
    inFlight.current = pending;
    return pending;
  };
  const initialize = (configuration?: unknown) => run(async signal => {
    if (!live.current.canInitialize || reference.current || query.isFetching || query.error || !query.data)
      throw new Error("请先核对当前Core使用权、设置状态及原操作");
    // 已有设置直接读取，不再次初始化；配置更新由Core自己的接口办理。
    if (query.data.status === "recorded") {
      if (configuration !== undefined) throw new Error("已有Core设置请使用本Core配置接口修改");
      return validateBinding(query.data.binding);
    }
    const input = BindCoreScopeSchema.parse({ ...scope, expectedRevision: 0, operationId: crypto.randomUUID(),
      ...(configuration === undefined ? {} : { configuration }) });
    const pending = CoreBindingOperationQuerySchema.parse({ ...scope, operationId: input.operationId });
    window.sessionStorage.setItem(journalKey, JSON.stringify(pending)); reference.current = pending; setOriginal(pending); setFailure(undefined);
    let binding: CoreBinding;
    try {
      binding = validateBinding(await coreManagementApi.bind(input, signal)); current();
    } catch (error) {
      if (!signal.aborted && live.current.generation === generation) {
        if (coreManagementRejectedBeforeCommit(error)) { clearOriginal(); setFailure("rejected"); await query.refetch(); }
        else setFailure("unknown");
      }
      throw error;
    }
    clearOriginal(); await refresh(); return binding;
  });
  const reconcile = () => run(async signal => {
    const pending = reference.current;
    if (!pending) throw new Error("没有待核对的Core设置操作");
    const observed = await coreManagementApi.bindingOperation(pending, signal); current();
    if (observed.status === "unavailable") { setFailure("unavailable"); throw new Error("原Core设置收据尚未取得，请保留引用稍后核对"); }
    const binding = validateBinding(observed.binding), operation = observed.operation;
    if (operation.operationId !== pending.operationId || operation.action !== "initialize" || operation.tenantId !== tenant?.tenantId
      || operation.coreId !== coreId || operation.container?.type !== container?.type || operation.container?.id !== container?.id)
      throw new Error("原Core设置收据与待核对操作不一致");
    clearOriginal(); await refresh(); return binding;
  });
  return { canManage, canInitialize, busy, original, failure, initialize, reconcile, refetch: query.refetch,
    loading: sessionVerified && (session.isPending || canManage && query.isPending), error: session.error ?? query.error,
    binding: canManage && !query.error && query.data?.status === "recorded" ? query.data.binding : undefined };
}
