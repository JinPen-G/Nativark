/** Web / 微信共用展示协调；原认证、当前准入、业务执行和原收据仍由正式端口负责。 */
import { ClientError, type ClientDestination, type ClientOperationReference, type ClientOperationResult,
  type ClientOperationStore, type ClientPageData, type ClientPageRequest, type ClientScopeChoice,
  type ClientSession } from "./contracts";
import { createClientOperations } from "./operations";
import type { ClientRuntime } from "./runtime";

export interface ClientViewState {
  readonly session: ClientSession;
  /** 会话/路由变化后表单也应以此键重建，不能保留上一身份输入。 */
  readonly generation: number;
  readonly destination?: ClientDestination;
  readonly request: ClientPageRequest;
  readonly page: { readonly status: "idle" | "loading" | "ready" | "error"; readonly data?: ClientPageData; readonly error?: ClientError["code"] };
  readonly pending: readonly ClientOperationReference[];
  readonly receiptError?: ClientError["code"];
  readonly feedback?: ClientOperationResult | { readonly status: "error"; readonly code: ClientError["code"] };
  readonly busy: boolean;
  readonly scopeChoices: readonly ClientScopeChoice[];
}
const code = (error: unknown): ClientError["code"] => error instanceof ClientError ? error.code : "unavailable";

export function createClientView(runtime: ClientRuntime, store?: ClientOperationStore) {
  const operations = store ? createClientOperations(runtime, store) : undefined;
  const listeners = new Set<() => void>();
  let generation = 0, readSequence = 0, sessionAttempt = 0, disposed = false, suspended = false;
  let queuedDestination: ClientDestination | undefined;
  let state: ClientViewState = { session: runtime.getSnapshot(), generation, request: { params: {}, search: "" },
    page: { status: "idle" }, pending: [], busy: false, scopeChoices: [] };
  const current = (value: number) => !disposed && value === generation;
  function update(patch: Partial<ClientViewState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) { try { listener(); } catch { /* 一个端的渲染错误不能保留其他旧页面。 */ } }
  }
  function clear(destination = state.destination, request: ClientPageRequest = { params: {}, search: "" }) {
    generation++; readSequence++;
    for (const key of ["page", "scan", "pending-operations", "prepare-operation", "execute-operation"]) runtime.cancel(key);
    update({ generation, session: runtime.getSnapshot(), destination, request, page: { status: "idle" }, pending: [],
      receiptError: undefined, feedback: undefined, busy: false, scopeChoices: [] });
  }
  async function loadPending(expected: number) {
    if (!operations || !state.destination) return;
    const routeId = state.destination.routeId;
    try {
      const pending = await operations.pending(routeId);
      if (current(expected)) update({ pending, receiptError: undefined });
    } catch (error) { if (current(expected) && code(error) !== "stale") update({ pending: [], receiptError: code(error) }); }
  }
  async function reload() {
    if (disposed || suspended || state.session.status !== "authenticated" || !state.destination) return;
    const expected = generation, sequence = ++readSequence, { routeId } = state.destination, request = state.request;
    update({ page: { status: "loading" } });
    const receipts = loadPending(expected);
    try {
      const data = await runtime.read(routeId, request);
      if (current(expected) && sequence === readSequence) update({ page: { status: "ready", data } });
    } catch (error) {
      if (current(expected) && sequence === readSequence && code(error) !== "stale") update({ page: { status: "error", error: code(error) } });
    }
    await receipts;
  }
  async function choices(expected: number) {
    try { const values = await runtime.scopeChoices(); if (current(expected)) update({ scopeChoices: values }); }
    catch { /* 无当前候选时不显示可猜测的租户/地点输入。 */ }
  }
  function navigate(destination?: ClientDestination) {
    const target = destination ?? (runtime.routes.find(route => route.navigation === true)
      ? { routeId: runtime.routes.find(route => route.navigation === true)!.id } : undefined);
    queuedDestination = state.session.status === "authenticated" ? undefined : target;
    clear(target && { routeId: target.routeId, params: Object.freeze({ ...target.params }) },
      { params: Object.freeze({ ...target?.params }), search: "" });
    if (target) {
      try { runtime.find(target.routeId); }
      catch { update({ page: { status: "error", error: "route_missing" } }); return; }
    }
    void reload();
    if (state.session.status === "authenticated") void choices(generation);
  }
  const unsubscribe = runtime.subscribe(() => {
    // 同步清展示。排队读取时再核代次，旧任务不会在新账号中发起请求。
    const destination = queuedDestination ?? (state.destination && { routeId: state.destination.routeId });
    clear(destination, { params: Object.freeze({ ...queuedDestination?.params }), search: "" });
    if (state.session.status === "authenticated") queuedDestination = undefined;
    const expected = generation;
    void Promise.resolve().then(() => {
      if (!current(expected) || suspended || state.session.status !== "authenticated") return;
      if (!state.destination) navigate();
      else { void reload(); void choices(expected); }
    });
  });
  async function sessionChange(work: () => Promise<void>) {
    const attempt = ++sessionAttempt;
    try { await work(); }
    catch (error) {
      if (!disposed && attempt === sessionAttempt && code(error) !== "stale") update({ feedback: { status: "error", code: code(error) } });
    }
  }
  async function action(work: () => Promise<ClientOperationResult>) {
    if (state.busy) return;
    const expected = generation;
    update({ busy: true, feedback: undefined });
    try {
      const result = await work();
      if (!current(expected)) return;
      update({ feedback: result });
      if (result.status !== "unknown") await reload();
      else await loadPending(expected);
    } catch (error) {
      if (current(expected) && code(error) !== "stale") {
        update({ feedback: { status: "error", code: code(error) } });
        await loadPending(expected);
      }
    } finally { if (current(expected)) update({ busy: false }); }
  }
  return {
    runtime, writable: !!operations,
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    navigate, reload,
    search(value: string) { clear(state.destination, { params: state.request.params, search: value }); void reload(); void choices(generation); },
    suspend() { suspended = true; clear(state.destination && { routeId: state.destination.routeId }); },
    resume() { suspended = false; return sessionChange(() => runtime.refresh()); },
    async scan(value: string): Promise<ClientDestination | undefined> {
      if (!state.destination || state.busy) return;
      const expected = generation;
      try {
        const destination = await runtime.scan(state.destination.routeId, value);
        if (!current(expected)) return;
        if (!destination) throw new ClientError("route_missing");
        navigate(destination); return destination;
      } catch (error) { if (current(expected) && code(error) !== "stale") update({ feedback: { status: "error", code: code(error) } }); }
    },
    signIn(fields: Readonly<Record<string, string>>) { return sessionChange(() => runtime.signIn(fields)); },
    signOut() { queuedDestination = undefined; return sessionChange(() => runtime.signOut()); },
    selectScope(id: string) { return sessionChange(() => runtime.selectScope(id)); },
    refreshSession() { return sessionChange(() => runtime.refresh()); },
    execute(actionId: string, values: Readonly<Record<string, string>>) {
      if (!operations || state.page.status !== "ready" || !state.destination || state.receiptError) return Promise.resolve();
      const { routeId } = state.destination, request = { ...state.request, actionBasis: state.page.data?.actionBasis };
      return action(() => operations.execute(routeId, actionId, request, values));
    },
    readReceipt(reference: ClientOperationReference) {
      if (!operations) return Promise.resolve();
      return action(() => operations.readReceipt(reference));
    },
    dispose() { if (disposed) return; unsubscribe(); clear(undefined); disposed = true; listeners.clear(); },
  };
}
export type ClientView = ReturnType<typeof createClientView>;
