/** Current-session reads of the original server display artifact and sources.
 * Keeps one generation locator and its safe field projection in memory. A
 * candidate can open trusted review; no code cache, submission or approval. */
import { AI_CONVERSATION_HTTP_DRAFT, type ApiResult, type AiWorkbenchDisplayBindingDraft,
  type AiWorkbenchDisplayReadDraft, type AiWorkbenchDisplayRevalidateDraft,
  type AiWorkbenchDisplaySourceReadDraft, type AiWorkbenchFieldMaterialDraft, type AiWorkbenchHostDraft,
  type AiApprovalApplicationReferenceDraft } from '@rental-os/shared';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { inspectWorkbenchDisplay, displayLease, displaySame, type WorkbenchDisplayPort,
  type WorkbenchDisplayExpectation, type WorkbenchDisplayLease, type WorkbenchDisplayMaterial } from '@/features/ai-native/workbench-display-host';
import { http } from './http';

type Owner = Pick<WorkbenchDisplayExpectation, 'tenantId' | 'workspaceId'> & { current(): boolean;
  reviewCandidate?(candidate: AiWorkbenchHostDraft, material: AiWorkbenchFieldMaterialDraft, signal: AbortSignal): Promise<void>;
  openConfirmation?(binding: AiWorkbenchDisplayBindingDraft, reference: AiApprovalApplicationReferenceDraft, signal: AbortSignal): Promise<void> };
type Port = WorkbenchDisplayPort & { activate(): void; dispose(): void };
type Original = { binding: AiWorkbenchDisplayBindingDraft; runId: string; resultId: string };
const unavailable = () => Error('AI_RESOURCE_UNAVAILABLE');

export function createAiWorkbenchDisplayPort(owner: Owner): Port {
  let active = true, generation = 0, lifecycle = new AbortController(), original: Original | null = null;
  let fieldMaterial: AiWorkbenchFieldMaterialDraft | null = null, lease: WorkbenchDisplayLease | null = null;
  let proposals: WorkbenchDisplayMaterial['proposals'] = [];
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
  const revalidate = async (previous: WorkbenchDisplayLease, signal: AbortSignal): Promise<WorkbenchDisplayLease> => {
    const ref = locator(previous.binding), binding = previous.binding;
    const command: AiWorkbenchDisplayRevalidateDraft = { taskId: binding.taskId,
      inputFingerprint: binding.inputFingerprint, materialHash: binding.materialHash, materialRevision: binding.materialRevision,
      presentationRevision: binding.presentationRevision, runId: ref.runId, resultId: ref.resultId,
      fieldRevision: previous.fieldRevision, aclRevision: previous.aclRevision, policyVersion: previous.policyVersion, expiresAt: previous.expiresAt };
    const result = await material(await post('display-revalidate', command, signal), binding.taskId, signal);
    const current = displayLease(result);
    if (!displaySame(current.binding, binding) || current.fieldRevision !== previous.fieldRevision
      || current.aclRevision !== previous.aclRevision || current.policyVersion !== previous.policyVersion
      || result.presentation.generation.runId !== ref.runId || result.presentation.generation.resultId !== ref.resultId
      || Date.parse(current.expiresAt) > Date.parse(previous.expiresAt)) throw unavailable();
    fieldMaterial = result.fieldMaterial ? structuredClone(result.fieldMaterial) : null;
    proposals = structuredClone(result.proposals);
    lease = structuredClone(current);
    return current;
  };
  return {
    activate() { if (active) return; active = true; lifecycle = new AbortController(); },
    dispose() { active = false; generation++; lifecycle.abort(); original = null; fieldMaterial = null; lease = null; proposals = []; },
    async read(taskId, signal): Promise<WorkbenchDisplayMaterial> {
      live(signal);
      generation++; lifecycle.abort(); lifecycle = new AbortController();
      original = null; fieldMaterial = null; lease = null; proposals = [];
      const result = await material(await post('display', { taskId }, signal), taskId, signal);
      original = { binding: structuredClone(result.presentation.binding),
        runId: result.presentation.generation.runId, resultId: result.presentation.generation.resultId };
      fieldMaterial = result.fieldMaterial ? structuredClone(result.fieldMaterial) : null;
      proposals = structuredClone(result.proposals);
      lease = displayLease(result);
      return result;
    },
    revalidate,
    ...(owner.reviewCandidate ? { async reviewCandidate(candidate: AiWorkbenchHostDraft, signal: AbortSignal) {
      const command = structuredClone(candidate), version = generation;
      live(signal, version);
      if (!lease || !fieldMaterial || !displaySame(command.binding, fieldMaterial.binding)
        || command.fieldRevision !== fieldMaterial.fieldRevision) throw unavailable();
      await revalidate(structuredClone(lease), signal);
      live(signal, version);
      if (!fieldMaterial || !displaySame(command.binding, fieldMaterial.binding)
        || command.fieldRevision !== fieldMaterial.fieldRevision) throw unavailable();
      await owner.reviewCandidate!(command, structuredClone(fieldMaterial), signal);
      live(signal, version);
    } } : {}),
    ...(owner.openConfirmation ? { async openConfirmation(binding: AiWorkbenchDisplayBindingDraft,
      reference: AiApprovalApplicationReferenceDraft, signal: AbortSignal) {
      const command = structuredClone(reference), version = generation;
      live(signal, version);
      if (!lease || !displaySame(binding, lease.binding) || !proposals.some(value => displaySame(value, command))) throw unavailable();
      await revalidate(structuredClone(lease), signal);
      live(signal, version);
      if (!proposals.some(value => displaySame(value, command))) throw unavailable();
      await owner.openConfirmation!(structuredClone(binding), command, signal);
      live(signal, version);
    } } : {}),
    async readSource(binding, sourceId, signal) {
      const ref = locator(binding);
      const command: AiWorkbenchDisplaySourceReadDraft = { taskId: binding.taskId, sourceId,
        inputFingerprint: binding.inputFingerprint, materialHash: binding.materialHash, presentationRevision: binding.presentationRevision,
        runId: ref.runId, resultId: ref.resultId };
      const value = await post('display-source', command, signal);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
      const source = value as Record<string, unknown>;
      if (Object.keys(source).sort().join(',') !== 'text,truncated,trust' || typeof source.text !== 'string'
        || new TextEncoder().encode(source.text).byteLength > 8192 || typeof source.truncated !== 'boolean'
        || source.trust !== 'source_data_not_instructions') throw unavailable();
      return { text: source.truncated ? `${source.text}\n…` : source.text, trust: 'source_data_not_instructions' as const };
    },
  };
}
