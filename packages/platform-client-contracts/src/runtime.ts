/**
 * 客户端页面寿命协调：切换立即清展示、取消原请求，丢弃旧成功与旧鉴权错误。
 * 不发认证 HTTP、不管理令牌、不缓存业务授权；当前业务与收据许可仍逐次向原权威核对。
 */
import { ClientError, clientAudience, type ClientAccessPort, type ClientAccessRequest,
  type ClientContribution, type ClientDestination, type ClientLifetime, type ClientPageRequest,
  type ClientScope, type ClientSession, type ClientSessionPort, type ClientSurface } from "./contracts";

export interface ClientRuntimeOptions {
  surface: ClientSurface;
  session: ClientSessionPort;
  access: ClientAccessPort;
  contributions: readonly ClientContribution[];
}

export function clientScopeKey(scope: ClientScope): string {
  return JSON.stringify([scope.principal.audience, scope.principal.tenantId, scope.principal.subjectId,
    scope.sessionRevision, scope.authorizationRevision, scope.workspaceId ?? null, scope.locationId ?? null]);
}

export function createClientRuntime(options: ClientRuntimeOptions) {
  const audience = clientAudience(options.surface), listeners = new Set<() => void>();
  const pending = new Map<string, { cancel(): void }>();
  const routes = new Map<string, { contribution: ClientContribution; route: ClientContribution["routes"][number] }>();
  let revision = 0, sessionKey = "", disposed = false, transition = 0;
  let override: ClientSession | undefined;
  const registered = /^[a-z][a-z0-9.-]{0,127}$/;
  const coreIds = new Set<string>();
  for (const contribution of options.contributions) {
    if (!registered.test(contribution.coreId) || !contribution.version || contribution.audience !== audience
      || coreIds.has(contribution.coreId)) throw new ClientError("unavailable");
    coreIds.add(contribution.coreId);
    for (const route of contribution.routes) {
      if (!registered.test(route.id) || !route.id.startsWith(`${contribution.coreId}.`) || routes.has(route.id)
        || typeof route.load !== "function" || new Set(route.actions?.map(action => action.id)).size !== (route.actions?.length ?? 0))
        throw new ClientError("unavailable");
      routes.set(route.id, { contribution, route });
    }
  }
  function snapshot(): ClientSession {
    if (disposed) return { status: "unavailable" };
    if (override) return override;
    const value = options.session.getSnapshot();
    if (value.status !== "authenticated") return value;
    const scope = value.scope;
    if (scope.principal.audience !== audience || !scope.principal.tenantId || !scope.principal.subjectId
      || !scope.sessionRevision || !scope.authorizationRevision) return { status: "unavailable" };
    return { status: "authenticated", displayName: value.displayName, tenantName: value.tenantName,
      workspaceName: value.workspaceName, locationName: value.locationName,
      scope: { principal: { audience: scope.principal.audience, tenantId: scope.principal.tenantId, subjectId: scope.principal.subjectId },
        sessionRevision: scope.sessionRevision, authorizationRevision: scope.authorizationRevision,
        workspaceId: scope.workspaceId, locationId: scope.locationId } };
  }
  function changed() {
    revision++;
    const previous = [...pending.values()]; pending.clear();
    for (const item of previous) item.cancel();
    for (const listener of listeners) { try { listener(); } catch { /* 单个宿主展示错误不能保留其他旧页面。 */ } }
  }
  function sync() {
    const state = snapshot(), key = state.status === "authenticated" ? clientScopeKey(state.scope) : state.status;
    if (key !== sessionKey) { sessionKey = key; changed(); }
  }
  const unsubscribe = options.session.subscribe(sync);
  sync();
  function lifetime(key: string): ClientLifetime {
    if (disposed) throw new ClientError("unavailable");
    sync(); pending.get(key)?.cancel();
    const original = revision, cancellation = new Set<() => void>();
    let active = true;
    const current = () => { sync(); return active && !disposed && original === revision; };
    const holder = { cancel() { if (!active) return; active = false;
      for (const listener of cancellation) { try { listener(); } catch { /* 取消运输失败仍须隔离迟到结果。 */ } }
      cancellation.clear(); } };
    pending.set(key, holder);
    return { current, assertCurrent() { if (!current()) throw new ClientError("stale"); },
      onCancel(listener) { if (!current()) { listener(); return () => {}; } cancellation.add(listener); return () => { cancellation.delete(listener); }; } };
  }
  function scope(): ClientScope {
    sync(); const state = snapshot();
    if (state.status !== "authenticated") throw new ClientError(state.status === "anonymous" ? "anonymous" : "unavailable");
    return state.scope;
  }
  function find(routeId: string) {
    const value = routes.get(routeId);
    if (!value) throw new ClientError("route_missing");
    return value;
  }
  async function withAccess<T>(routeId: string, purpose: ClientAccessRequest["purpose"], key: string,
    work: (scope: ClientScope, life: ClientLifetime) => Promise<T>, actionId?: string,
    context: Pick<ClientAccessRequest, "request" | "reference"> = {}): Promise<T> {
    const { contribution } = find(routeId), owner = scope(), life = lifetime(key);
    const request = { coreId: contribution.coreId, routeId, purpose, scope: owner, ...context, ...(actionId ? { actionId } : {}) };
    try {
      const decision = await options.access.authorize(request, life);
      life.assertCurrent();
      if (decision.status !== "allowed") throw new ClientError(decision.status);
      const result = await work(owner, life);
      life.assertCurrent();
      const finalDecision = await options.access.authorize(request, life);
      life.assertCurrent();
      if (finalDecision.status !== "allowed") throw new ClientError(finalDecision.status);
      return result;
    } catch (error) {
      life.assertCurrent(); // 旧401/403与旧成功都不得改变新会话或页面。
      throw error instanceof ClientError ? error : new ClientError("unavailable");
    }
  }
  async function changeSession(kind: "loading" | "anonymous", work: (life: ClientLifetime) => Promise<void>) {
    const attempt = ++transition;
    override = { status: kind }; changed();
    const life = lifetime("session-change");
    try {
      await work(life);
      // 原适配采用新会话会通知订阅；override 使这次采用不误取消自身。
      if (attempt !== transition || disposed) throw new ClientError("stale");
      override = undefined; sync();
    } catch (error) {
      if (attempt !== transition || disposed) throw new ClientError("stale");
      override = { status: kind === "anonymous" || error instanceof ClientError && error.code === "anonymous" ? "anonymous" : "unavailable" }; changed();
      throw error instanceof ClientError ? error : new ClientError("unavailable");
    }
  }
  return {
    surface: options.surface, audience,
    session: options.session,
    getSnapshot: snapshot,
    getRevision: () => revision,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    routes: [...routes.values()].map(({ route }) => route),
    scope, find, withAccess,
    /** 为本地读取捕获同一页面寿命；它不提供业务或原收据准入。 */
    captureLifetime: lifetime,
    /** 页面卸载/切路由只取消展示；不证明任何已派发业务回滚。 */
    cancel(key: string) { pending.get(key)?.cancel(); pending.delete(key); },
    invalidate() { changed(); },
    refresh() { return changeSession("loading", life => options.session.refresh(life)); },
    signIn(fields: Readonly<Record<string, string>>) { return changeSession("loading", life => options.session.signIn(fields, life)); },
    signOut() { return changeSession("anonymous", async () => {
      await options.session.signOut();
      if (options.session.getSnapshot().status === "authenticated") throw new ClientError("unavailable");
    }); },
    selectScope(id: string) {
      const select = options.session.selectScope;
      if (!select) return Promise.reject(new ClientError("unavailable"));
      return changeSession("loading", life => select.call(options.session, id, life));
    },
    scopeChoices() {
      scope();
      const read = options.session.scopeChoices;
      if (!read) return Promise.resolve([]);
      const life = lifetime("scope-choices");
      return read.call(options.session, life).then(value => { life.assertCurrent(); return value; });
    },
    read(routeId: string, request: ClientPageRequest) {
      const { route } = find(routeId);
      const fixed = { search: request.search, params: Object.freeze({ ...request.params }) };
      return withAccess(routeId, "page", "page", (owner, life) => route.load(fixed, owner, life), undefined, { request: fixed });
    },
    scan(routeId: string, value: string): Promise<ClientDestination | undefined> {
      const { contribution } = find(routeId);
      if (!contribution.scan) return Promise.reject(new ClientError("unavailable"));
      return withAccess(routeId, "page", "scan", async (owner, life) => {
        const destination = await contribution.scan!(value, owner, life);
        if (destination) find(destination.routeId);
        return destination;
      });
    },
    dispose() { if (disposed) return; disposed = true; transition++; unsubscribe(); changed(); listeners.clear(); },
  };
}
export type ClientRuntime = ReturnType<typeof createClientRuntime>;
