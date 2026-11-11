/** Only current owned Task IDs are transported. Epoch checks suppress old
 * reads; this endpoint never starts a model, task or business operation. */
import { AI_TASK_ORDER_HANDOFF_HTTP, aiTaskOrderHandoffQuery, aiTaskOrderHandoffResponse,
  AI_ORDER_EXPLANATION_HTTP_V2, AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, aiOrderSceneTaskMaterialV2,
  type AiTaskOrderHandoffQuery, type AiTaskOrderHandoffResponse, type AiOrderSceneTaskMaterialV2, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
async function read(input: AiTaskOrderHandoffQuery, signal: AbortSignal): Promise<AiTaskOrderHandoffResponse> {
  const query = aiTaskOrderHandoffQuery.parse(structuredClone(input));
  const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
  if (active.aborted) throw Error('AI_SCOPE_CHANGED');
  const response = await http.post<ApiResult<unknown>>(`/${AI_TASK_ORDER_HANDOFF_HTTP.basePath}/${AI_TASK_ORDER_HANDOFF_HTTP.read}`,
    query, { signal: active, timeout: 12000 });
  if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED');
  if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 32768) throw Error('AI_RESOURCE_UNAVAILABLE');
  const value = aiTaskOrderHandoffResponse.parse(response.data.data);
  if (value.taskId !== query.taskId || (query.runId !== undefined && value.runId !== query.runId)) throw Error('AI_SCOPE_CHANGED');
  return value;
}
const identity = (value: AiTaskOrderHandoffResponse) => JSON.stringify([value.taskId, value.runId,
  value.scope.tenantId, value.scope.workspaceId, value.origin, value.order.id, value.order.version, value.order.status]);

export const aiTaskOrderHandoffApi = Object.freeze({ read,
  /** Additional existing Core evidence, separate from the original model answer.
   * Its public v2 parser and server publication must be available; no fallback
   * to private DTOs, current-rule substitution or unverified financial totals. */
  async readEvidence(frame: AiTaskOrderHandoffResponse, signal: AbortSignal): Promise<AiOrderSceneTaskMaterialV2> {
    const expected = aiTaskOrderHandoffResponse.parse(structuredClone(frame));
    const epoch = currentSessionEpoch(), active = AbortSignal.any([signal, currentSessionSignal()]);
    const check = () => { if (active.aborted || epoch !== currentSessionEpoch()) throw Error('AI_SCOPE_CHANGED'); };
    const query = { taskId: expected.taskId, runId: expected.runId };
    check(); const before = await read(query, active); check();
    if (identity(before) !== identity(expected)) throw Error('AI_REVISION_CONFLICT');
    const response = await http.post<ApiResult<unknown>>(`/${AI_ORDER_EXPLANATION_HTTP_V2.basePath}/${AI_ORDER_EXPLANATION_HTTP_V2.material}`,
      { draftVersion: before.origin.draftVersion, inputRef: before.origin.inputRef }, { signal: active, timeout: 15000 });
    check();
    if (new TextEncoder().encode(JSON.stringify(response.data.data)).length > 524288) throw Error('AI_RESOURCE_UNAVAILABLE');
    const value = aiOrderSceneTaskMaterialV2.parse(response.data.data), payload = value.material.payload;
    if (value.original.inputRef !== before.origin.inputRef || value.original.contentHash !== before.origin.contentHash
      || value.original.sceneVersion !== before.origin.sceneVersion || value.original.requestKey !== before.origin.requestKey
      || value.original.state === 'revoked' || value.task.state !== 'observed' || value.task.taskId !== before.taskId || value.task.runId !== before.runId
      || value.material.version !== AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION || payload.orderId !== before.order.id
      || payload.orderVersion !== before.order.version || payload.scope.tenantId !== before.scope.tenantId
      || payload.scope.workspaceId !== before.scope.workspaceId || payload.audience !== 'operator') throw Error('AI_SCOPE_CHANGED');
    const references = [payload.facts.order, ...('amounts' in payload.facts ? [payload.facts.amounts] : []),
      ...('fulfillment' in payload.facts ? [payload.facts.fulfillment] : []),
      ...('history' in payload.facts && payload.facts.history.coverage === 'partial' ? [payload.facts.history] : []),
      ...('inspections' in payload.facts && payload.facts.inspections.coverage === 'partial' ? [payload.facts.inspections] : []),
      ...('payments' in payload.facts && payload.facts.payments.coverage === 'partial' ? [payload.facts.payments] : []),
      ...('fundingLedger' in payload.facts && payload.facts.fundingLedger.coverage === 'partial' ? [payload.facts.fundingLedger] : []),
      ...('lifecycle' in payload.facts && payload.facts.lifecycle.coverage === 'partial' ? [payload.facts.lifecycle] : [])];
    if (references.some(row => row.source.resourceId !== before.order.id || row.source.version !== payload.orderVersion
      || row.source.scope.tenantId !== before.scope.tenantId || row.source.scope.workspaceId !== before.scope.workspaceId)) throw Error('AI_SCOPE_CHANGED');
    const latest = await read(query, active); check();
    if (identity(latest) !== identity(before)) throw Error('AI_REVISION_CONFLICT');
    return value;
  }
});
