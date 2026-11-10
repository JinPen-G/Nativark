/** One explicit current-facts/manual navigation lifetime. No storage, new
 * original request, model dispatch, allowed-action calculation or write port. */
import { aiTaskOrderHandoffQuery, type AiTaskOrderHandoffQuery, type AiTaskOrderHandoffResponse, type AiWorkspaceScope } from '@rental-os/shared';
type View = { frame: AiTaskOrderHandoffResponse | null; busy: 'read' | 'open' | null; error: unknown; changedOrder: boolean };
export function createOrderHumanHandoffSession(input: { query: AiTaskOrderHandoffQuery; scope: AiWorkspaceScope;
  current(): boolean; changed(): void; verify?(signal: AbortSignal): Promise<void>; validate?(value: AiTaskOrderHandoffResponse): void;
  api: { read(query: AiTaskOrderHandoffQuery, signal: AbortSignal): Promise<AiTaskOrderHandoffResponse> } }) {
  const query = aiTaskOrderHandoffQuery.parse(structuredClone(input.query)), scope = structuredClone(input.scope);
  let active = true, generation = 0, request: AbortController | null = null;
  let view: View = { frame: null, busy: null, error: null, changedOrder: false };
  const current = () => active && input.current();
  const assert = (owner = generation) => { if (!current() || owner !== generation || request?.signal.aborted) throw Error('AI_SCOPE_CHANGED'); };
  const publish = (patch: Partial<View>) => { if (current()) { view = { ...view, ...patch }; input.changed(); } };
  const fetch = async (signal: AbortSignal, owner: number) => {
    assert(owner); await input.verify?.(signal); assert(owner);
    const value = structuredClone(await input.api.read(query, signal)); assert(owner);
    if (value.taskId !== query.taskId || (query.runId !== undefined && value.runId !== query.runId)
      || value.scope.tenantId !== scope.tenantId || value.scope.workspaceId !== scope.workspaceId
      || value.next.manual.orderId !== value.order.id || JSON.stringify(value.next.manual.scope) !== JSON.stringify(value.scope)) throw Error('AI_SCOPE_CHANGED');
    input.validate?.(value); await input.verify?.(signal); assert(owner); return value;
  };
  const run = async <T>(kind: NonNullable<View['busy']>, action: (signal: AbortSignal, owner: number) => Promise<T>) => {
    assert(); if (view.busy) throw Error('AI_OPERATION_BUSY'); const owner = ++generation, controller = new AbortController(); request = controller;
    publish({ busy: kind, error: null });
    try { return await action(controller.signal, owner); }
    catch (error) { if (generation === owner) publish({ frame: null, error }); throw error; }
    finally { if (request === controller) { request = null; publish({ busy: null }); } }
  };
  const basis = (value: AiTaskOrderHandoffResponse) => JSON.stringify({ taskId: value.taskId, runId: value.runId,
    scope: value.scope, origin: value.origin, order: { id: value.order.id, orderNo: value.order.orderNo, status: value.order.status, version: value.order.version } });
  return Object.freeze({ get view() { return view; }, isCurrent: current,
    async read() { return run('read', async (signal, owner) => { publish({ frame: null, changedOrder: false });
      const value = await fetch(signal, owner); assert(owner); publish({ frame: value }); }); },
    async open(navigate: (value: AiTaskOrderHandoffResponse) => void | Promise<void>) {
      assert(); const frame = view.frame && structuredClone(view.frame); if (!frame) throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('open', async (signal, owner) => {
        const latest = await fetch(signal, owner); assert(owner);
        if (basis(latest) !== basis(frame)) { publish({ frame: latest, changedOrder: true }); return false; }
        publish({ frame: latest, changedOrder: false }); assert(owner);
        // The host callback owns the registered destination. Navigation ends
        // this old view lifetime; its destination rechecks original permissions.
        await navigate(latest); return true;
      });
    },
    clear() { generation++; request?.abort(); request = null; view = { frame: null, busy: null, error: null, changedOrder: false }; if (current()) input.changed(); },
    activate() { active = true; generation++; view = { frame: null, busy: null, error: null, changedOrder: false }; input.changed(); },
    dispose() { active = false; generation++; request?.abort(); request = null; view = { frame: null, busy: null, error: null, changedOrder: false }; }
  });
}
