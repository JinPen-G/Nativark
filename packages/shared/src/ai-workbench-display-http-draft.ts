/** Read-only delivery of an original, source-revalidated display artifact.
 * Task IDs and hashes locate original records; none grant model or business
 * execution, extend retention or attest sandbox input as a human choice. */
import type { AiWorkbenchContextDraft, AiWorkbenchFieldMaterialDraft, AiWorkbenchPresentationDraft,
  AiWorkbenchDisplayBindingDraft } from './ai-workbench-display-draft';
import type { AiApprovalApplicationReferenceDraft } from './ai-approval-application-draft';
import { leafClosed as object, leafId as id, leafInt as integer, leafList as list,
  leafRef as ref, leafTime as time, leafText as text, leafEnum as choice, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export interface AiWorkbenchDisplayReadDraft { taskId: string }
export interface AiWorkbenchAuthoritativeSummaryDraft {
  version: 'ain-workbench-facts-1'; binding: AiWorkbenchDisplayBindingDraft;
  runId: string; resultId: string; observedAt: string;
  source: 'current_original_business_facts'; text: string;
}
export interface AiWorkbenchDisplayMaterialDraft {
  context: AiWorkbenchContextDraft; presentation: AiWorkbenchPresentationDraft;
  fieldMaterial: AiWorkbenchFieldMaterialDraft | null; sourceIds: string[]; proposals: AiApprovalApplicationReferenceDraft[];
  /** Older packets may lack the summary; hosts must then decline dynamic
   * rendering. The current producer always binds it outside generated HTML. */
  authoritativeSummary?: AiWorkbenchAuthoritativeSummaryDraft;
}
export interface AiWorkbenchDisplayRevalidateDraft extends AiWorkbenchDisplayReadDraft {
  inputFingerprint: string; materialHash: string; materialRevision: number; presentationRevision: number;
  runId: string; resultId: string; fieldRevision: number | null; aclRevision: string; policyVersion: string; expiresAt: string;
}
export interface AiWorkbenchDisplaySourceReadDraft extends AiWorkbenchDisplayReadDraft {
  sourceId: string; inputFingerprint: string; materialHash: string; presentationRevision: number; runId: string; resultId: string;
}
export interface AiWorkbenchDisplaySourceDraft { text: string; trust: 'source_data_not_instructions'; truncated: boolean }

const hash: AiLeafSchemaDraft = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const revision = integer(1, 4294967294);
export const AI_WORKBENCH_DISPLAY_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiWorkbenchAuthoritativeSummaryDraft: object({ version: choice('ain-workbench-facts-1'), binding: ref('AiWorkbenchDisplayBindingDraft'),
    runId: id(), resultId: id(), observedAt: time, source: choice('current_original_business_facts'), text: text(32768) }),
  AiWorkbenchDisplayReadDraft: object({ taskId: id() }),
  AiWorkbenchDisplayRevalidateDraft: object({ taskId: id(), inputFingerprint: hash, materialHash: hash,
    materialRevision: revision, presentationRevision: revision, runId: id(), resultId: id(),
    fieldRevision: { oneOf: [revision, { type: 'null' }] }, aclRevision: id(), policyVersion: id(), expiresAt: time }),
  AiWorkbenchDisplaySourceReadDraft: object({ taskId: id(), sourceId: id(), inputFingerprint: hash, materialHash: hash,
    presentationRevision: revision, runId: id(), resultId: id() }),
  AiWorkbenchDisplayMaterialDraft: object({ context: ref('AiWorkbenchContextDraft'), presentation: ref('AiWorkbenchPresentationDraft'),
    fieldMaterial: { oneOf: [ref('AiWorkbenchFieldMaterialDraft'), { type: 'null' }] },
    sourceIds: { ...list(id(), 50), uniqueItems: true }, proposals: list(ref('AiApprovalApplicationReferenceDraft'), 20),
    authoritativeSummary: ref('AiWorkbenchAuthoritativeSummaryDraft') }, ['context', 'presentation', 'fieldMaterial', 'sourceIds', 'proposals']),
  AiWorkbenchDisplaySourceDraft: object({ text: text(8192), trust: choice('source_data_not_instructions'), truncated: { type: 'boolean' } }),
};
