/** Private, read-only display ports. The original server owns material/ACL and
 * human-input/approval receipts; HTML and frame messages never grant authority. */
import {
  AI_WORKBENCH_CONTEXT_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_LIMITS,
  AI_SCENE_REQUEST_DRAFT_VERSION, isAiTaskInputContractDraft, validateAiTaskInputAnswersDraft,
  type AiApprovalApplicationReferenceDraft, type AiTaskInputAnswerDraft,
  type AiWorkbenchContextDraft, type AiWorkbenchDisplayBindingDraft, type AiWorkbenchFieldMaterialDraft,
  type AiWorkbenchHostDraft, type AiWorkbenchMountBindingDraft, type AiWorkbenchPresentationDraft,
  type AiWorkbenchSandboxMessageDraft,
} from '@rental-os/shared';

export const WORKBENCH_HTML_ISOLATION_VERSION = 'opaque-html-static-1' as const;
export interface WorkbenchDisplayMaterial {
  context: AiWorkbenchContextDraft;
  presentation: AiWorkbenchPresentationDraft;
  /** This is the original server's sandbox projection, not the human page's full input. */
  fieldMaterial: AiWorkbenchFieldMaterialDraft | null;
  sourceIds: readonly string[];
  proposals: readonly AiApprovalApplicationReferenceDraft[];
}
export interface WorkbenchDisplayExpectation { taskId: string; tenantId: string; workspaceId: string; runId?: string; resultId?: string }
export interface WorkbenchDisplayLease {
  binding: AiWorkbenchDisplayBindingDraft; fieldRevision: number | null;
  aclRevision: string; policyVersion: string; expiresAt: string;
}
export interface WorkbenchDisplaySource { text: string; trust: 'source_data_not_instructions' }
export interface WorkbenchDisplayPort {
  /** Read the original retained presentation; no model/tool dispatch on mount or read. */
  read(taskId: string, signal: AbortSignal): Promise<WorkbenchDisplayMaterial>;
  revalidate(lease: WorkbenchDisplayLease, signal: AbortSignal): Promise<WorkbenchDisplayLease>;
  readSource?(binding: AiWorkbenchDisplayBindingDraft, sourceId: string, signal: AbortSignal): Promise<WorkbenchDisplaySource>;
  /** Open the original trusted input review. The draft remains candidate/not_attested. */
  reviewCandidate?(draft: AiWorkbenchHostDraft, signal: AbortSignal): Promise<void>;
  /** Open the original fixed approval UI; this callback must not approve or execute. */
  openConfirmation?(binding: AiWorkbenchDisplayBindingDraft, reference: AiApprovalApplicationReferenceDraft, signal: AbortSignal): Promise<void>;
}

export const displayUnavailable = () => Error('AI_RESOURCE_UNAVAILABLE');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(v);
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 4294967294;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const displaySame = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function displayMaterialBinding(binding: AiWorkbenchDisplayBindingDraft) {
  const { presentationRevision: _, instanceId: _instance, channelId: _channel, ...material } = binding as AiWorkbenchMountBindingDraft;
  return material;
}
export function displayLease(material: WorkbenchDisplayMaterial): WorkbenchDisplayLease {
  const p = material.presentation;
  const expires = Math.min(Date.parse(p.retention.expiresAt), Date.parse(material.context.history.expiresAt),
    material.fieldMaterial ? Date.parse(material.fieldMaterial.retention.expiresAt) : Infinity);
  return { binding: structuredClone(p.binding), fieldRevision: material.fieldMaterial?.fieldRevision ?? null,
    aclRevision: p.retention.aclRevision, policyVersion: p.retention.policyVersion, expiresAt: new Date(expires).toISOString() };
}
function validBinding(v: unknown): v is AiWorkbenchDisplayBindingDraft {
  if (!object(v) || Object.keys(v).length !== 10 || !object(v.original)) return false;
  return ['conversationId', 'turnId', 'capabilityCode', 'capabilityVersion', 'taskId'].every(k => id(v[k]))
    && hash(v.inputFingerprint) && hash(v.materialHash) && revision(v.materialRevision) && revision(v.presentationRevision)
    && Object.keys(v.original).length === 2 && v.original.draftVersion === AI_SCENE_REQUEST_DRAFT_VERSION
    && typeof v.original.inputRef === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(v.original.inputRef);
}
export function displayPartialAnswers(material: AiWorkbenchFieldMaterialDraft, answers: unknown): answers is AiTaskInputAnswerDraft[] {
  if (!material.contract || !isAiTaskInputContractDraft(material.contract) || !Array.isArray(answers)
    || answers.length < 1 || answers.length > AI_WORKBENCH_DISPLAY_LIMITS.fieldAnswers) return false;
  const allowed = new Set(material.fields.filter(field => field.editable).map(field => field.fieldId));
  if (answers.some(answer => !object(answer) || Object.keys(answer).length !== 2 || !allowed.has(answer.fieldId as never)
    || typeof answer.value === 'string' && (answer.value.length > 2048 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(answer.value))
    || typeof answer.value === 'number' && (!Number.isSafeInteger(answer.value) || answer.value < 1 || answer.value > 1000000))) return false;
  return validateAiTaskInputAnswersDraft({ ...material.contract, fields: material.contract.fields.map(field => ({ ...field, required: false })) }, answers);
}

export async function inspectWorkbenchDisplay(value: unknown, expected: WorkbenchDisplayExpectation,
  now = Date.now()): Promise<WorkbenchDisplayMaterial> {
  const result = structuredClone(value) as WorkbenchDisplayMaterial;
  const p = result?.presentation, c = result?.context, fields = result?.fieldMaterial;
  if (!object(result) || Object.keys(result).length !== 5 || !p || !c || !validBinding(p.binding)
    || p.binding.taskId !== expected.taskId || c.draftVersion !== AI_WORKBENCH_CONTEXT_DRAFT_VERSION
    || c.scope.kind !== 'workspace' || c.scope.tenantId !== expected.tenantId || c.scope.workspaceId !== expected.workspaceId
    || c.purpose !== 'display' || c.authority !== 'none_reauthorize_before_consumption'
    || !displaySame(c.binding, displayMaterialBinding(p.binding))
    || c.capability.code !== p.binding.capabilityCode || c.capability.version !== p.binding.capabilityVersion
    || c.history.coverage !== 'bounded_authorized_references' || c.history.references.length > 50
    || p.draftVersion !== AI_WORKBENCH_DISPLAY_DRAFT_VERSION || p.trust !== 'untrusted_display_code'
    || p.execution !== 'not_admitted' || p.code.language !== 'html' || p.code.complete !== true
    || typeof p.code.source !== 'string' || !hash(p.code.sha256) || !hash(p.generation.resultHash)
    || p.generation.isolationVersion !== WORKBENCH_HTML_ISOLATION_VERSION
    || expected.runId !== undefined && p.generation.runId !== expected.runId
    || expected.resultId !== undefined && p.generation.resultId !== expected.resultId
    || ['runId', 'stepId', 'resultId', 'promptVersion', 'displayApiVersion'].some(key => !id(p.generation[key as keyof typeof p.generation]))
    || !Array.isArray(result.sourceIds) || result.sourceIds.length > 50 || new Set(result.sourceIds).size !== result.sourceIds.length
    || result.sourceIds.some(source => !id(source)) || !Array.isArray(result.proposals) || result.proposals.length > 20) throw displayUnavailable();
  const retained = p.retention, sourceExpiry = Date.parse(retained.sourceExpiresAt), expiry = Date.parse(retained.expiresAt);
  if (![sourceExpiry, expiry, Date.parse(c.history.expiresAt)].every(Number.isFinite) || expiry <= now || expiry > sourceExpiry
    || sourceExpiry > Date.parse(c.history.expiresAt) || !id(retained.aclRevision) || !id(retained.policyVersion)
    || retained.aclRevision !== c.history.aclRevision || retained.policyVersion !== c.history.policyVersion) throw displayUnavailable();
  if (fields !== null) {
    if (!fields || fields.draftVersion !== AI_WORKBENCH_CONTEXT_DRAFT_VERSION || !displaySame(fields.binding, c.binding)
      || fields.authority !== 'original_business_rules_not_model_rules' || !revision(fields.fieldRevision)
      || !Array.isArray(fields.fields) || fields.fields.length > 8 || !Array.isArray(fields.sources) || fields.sources.length > 50
      || fields.retention.aclRevision !== retained.aclRevision || fields.retention.policyVersion !== retained.policyVersion
      || !Number.isFinite(Date.parse(fields.retention.expiresAt)) || Date.parse(fields.retention.expiresAt) <= now
      || fields.contract !== null && !isAiTaskInputContractDraft(fields.contract)) throw displayUnavailable();
    const ids = new Set(fields.contract?.fields.map(field => field.fieldId) ?? []);
    const sources = new Set(fields.sources.map(source => source.sourceId));
    if (fields.fields.length !== ids.size || new Set(fields.fields.map(field => field.fieldId)).size !== ids.size
      || sources.size !== fields.sources.length
      || fields.fields.some(field => !ids.has(field.fieldId) || typeof field.editable !== 'boolean' || !id(field.sourceId) || !sources.has(field.sourceId)
        || !field.defaultValue || !['provided', 'unavailable'].includes(field.defaultValue.status))) throw displayUnavailable();
  }
  if (new TextEncoder().encode(JSON.stringify(result.proposals)).byteLength > AI_WORKBENCH_DISPLAY_LIMITS.messageBytes / 2) throw displayUnavailable();
  const bytes = new TextEncoder().encode(p.code.source);
  if (!bytes.length || bytes.byteLength > AI_WORKBENCH_DISPLAY_LIMITS.codeBytes || !globalThis.crypto?.subtle) throw displayUnavailable();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== p.code.sha256) throw displayUnavailable();
  if (Date.parse(displayLease(result).expiresAt) <= now) throw displayUnavailable();
  return result;
}

/** Current private connection only. A MessagePort has no origin/source field;
 * its identity is established by the checked opaque-window ready handshake. */
export function inspectWorkbenchFrameMessage(value: unknown, mount: AiWorkbenchMountBindingDraft,
  lastSequence: number, material: WorkbenchDisplayMaterial): AiWorkbenchSandboxMessageDraft {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > AI_WORKBENCH_DISPLAY_LIMITS.messageBytes) throw displayUnavailable();
  const v = value as AiWorkbenchSandboxMessageDraft;
  if (!object(v) || v.draftVersion !== AI_WORKBENCH_DISPLAY_DRAFT_VERSION || !displaySame(v.binding, mount)
    || !revision(v.sequence) || v.sequence !== lastSequence + 1) throw displayUnavailable();
  const keys = Object.keys(v).sort().join(',');
  if (v.kind === 'ready' || v.kind === 'rendered') {
    if (keys !== 'binding,draftVersion,kind,sequence') throw displayUnavailable();
  } else if (v.kind === 'render_failed') {
    if (keys !== 'binding,draftVersion,kind,reason,sequence' || !['invalid_code', 'resource_limit', 'unsupported'].includes(v.reason)) throw displayUnavailable();
  } else if (v.kind === 'candidate_input') {
    if (keys !== 'answers,binding,draftVersion,fieldRevision,kind,sequence' || !material.fieldMaterial
      || v.fieldRevision !== material.fieldMaterial.fieldRevision || !displayPartialAnswers(material.fieldMaterial, v.answers)) throw displayUnavailable();
  } else if (v.kind === 'request_source') {
    if (keys !== 'binding,draftVersion,kind,sequence,sourceId' || !material.sourceIds.includes(v.sourceId)) throw displayUnavailable();
  } else if (v.kind === 'request_confirmation') {
    if (keys !== 'binding,draftVersion,kind,proposal,sequence' || !material.proposals.some(p => displaySame(p, v.proposal))) throw displayUnavailable();
  } else throw displayUnavailable();
  return structuredClone(v);
}
