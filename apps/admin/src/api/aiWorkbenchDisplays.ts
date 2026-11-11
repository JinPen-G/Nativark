/** Current-session reads of the original server display artifact and sources.
 * Keeps only one original generation locator in memory; no code/body cache,
 * model generation, Task start, candidate submission or approval is exposed. */
import { AI_CONVERSATION_HTTP_DRAFT, type ApiResult, type AiWorkbenchDisplayBindingDraft,
  type AiWorkbenchDisplayReadDraft, type AiWorkbenchDisplayRevalidateDraft,
  type AiWorkbenchDisplaySourceReadDraft } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { inspectWorkbenchDisplay, displayLease, displaySame, type WorkbenchDisplayPort,
  type WorkbenchDisplayExpectation, type WorkbenchDisplayLease, type WorkbenchDisplayMaterial } from '@/features/ai-native/workbench-display-host';
import { http } from './http';

type Owner = Pick<WorkbenchDisplayExpectation, 'tenantId' | 'workspaceId'> & { current(): boolean };
type Port = WorkbenchDisplayPort & { activate(): void; dispose(): void };
type Original = { binding: AiWorkbenchDisplayBindingDraft; runId: string; resultId: string };
const unavailable = () => Error('AI_RESOURCE_UNAVAILABLE');

export function createAiWorkbenchDisplayPort(owner: Owner): Port {
  let active = true, generation = 0, lifecycle = new AbortController(), original: Original | null = null;
  const live = (signal: AbortSignal, version = generation) => {
    if (!active || !owner.current() || signal.aborted || lifecycle.signal.aborted || version !== generation) throw unavailable();
  };
  const post = async (action: 'display' | 'display-revalidate' | 'display-source',
    command: AiWorkbenchDisplayReadDraft | AiWorkbenchDisplayRevalidateDraft | AiWorkbenchDisplaySourceReadDraft, signal: AbortSignal) => {
    const version = generation, epoch = currentSessionEpoch(), combined = AbortSignal.any([signal, lifecycle.signal, currentSessionSignal()]);
    live(combined, version);
    // This read-only POST also has one explicit request owner. Authentication
    // changes must return to that owner rather than silently replaying it.
    const config = { signal: combined, timeout: 15000, _authRetry: true };
    const response = await http.post<ApiResult<unknown>>(`/${AI_CONVERSATION_HTTP_DRAFT.basePath}/${action}`, structuredClone(command), config);
    live(combined, version);
    if (epoch !== currentSessionEpoch()) throw unavailable();
    return response.data.data;
  };
  const material = async (value: unknown, taskId: string, signal: AbortSignal) => {
    const version = generation;
    const result = await inspectWorkbenchDisplay(value, { taskId, tenantId: owner.tenantId, workspaceId: owner.workspaceId });
    live(signal, version);
    return result;
  };
  const locator = (binding: AiWorkbenchDisplayBindingDraft) => {
    if (!original || !displaySame(original.binding, binding)) throw unavailable();
    return original;
  };
  return {
    activate() { if (active) return; active = true; lifecycle = new AbortController(); },
    dispose() { active = false; generation++; lifecycle.abort(); original = null; },
    async read(taskId, signal): Promise<WorkbenchDisplayMaterial> {
      live(signal);
      generation++; lifecycle.abort(); lifecycle = new AbortController();
      original = null;
      const result = await material(await post('display', { taskId }, signal), taskId, signal);
      original = { binding: structuredClone(result.presentation.binding),
        runId: result.presentation.generation.runId, resultId: result.presentation.generation.resultId };
      return result;
    },
    async revalidate(lease, signal): Promise<WorkbenchDisplayLease> {
      const ref = locator(lease.binding), binding = lease.binding;
      const command: AiWorkbenchDisplayRevalidateDraft = { taskId: binding.taskId,
        inputFingerprint: binding.inputFingerprint, materialHash: binding.materialHash, materialRevision: binding.materialRevision,
        presentationRevision: binding.presentationRevision, runId: ref.runId, resultId: ref.resultId,
        fieldRevision: lease.fieldRevision, aclRevision: lease.aclRevision, policyVersion: lease.policyVersion, expiresAt: lease.expiresAt };
      const result = await material(await post('display-revalidate', command, signal), binding.taskId, signal);
      const current = displayLease(result);
      if (!displaySame(current.binding, binding) || current.fieldRevision !== lease.fieldRevision
        || current.aclRevision !== lease.aclRevision || current.policyVersion !== lease.policyVersion
        || result.presentation.generation.runId !== ref.runId || result.presentation.generation.resultId !== ref.resultId
        || Date.parse(current.expiresAt) > Date.parse(lease.expiresAt)) throw unavailable();
      return current;
    },
    async readSource(binding, sourceId, signal) {
      const ref = locator(binding);
      const command: AiWorkbenchDisplaySourceReadDraft = { taskId: binding.taskId, sourceId,
        inputFingerprint: binding.inputFingerprint, materialHash: binding.materialHash, presentationRevision: binding.presentationRevision,
        runId: ref.runId, resultId: ref.resultId };
      const value = await post('display-source', command, signal);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
      const source = value as Record<string, unknown>;
      if (Object.keys(source).sort().join(',') !== 'text,trust,truncated' || typeof source.text !== 'string'
        || new TextEncoder().encode(source.text).byteLength > 8192 || typeof source.truncated !== 'boolean'
        || source.trust !== 'source_data_not_instructions') throw unavailable();
      return { text: source.truncated ? `${source.text}\n…` : source.text, trust: 'source_data_not_instructions' as const };
    },
  };
}
