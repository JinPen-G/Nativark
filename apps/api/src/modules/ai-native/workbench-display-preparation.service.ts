/** Reconstruct the retained display packet from its original measured Artifact.
 * Current registered versions, context and field basis must be independently
 * revalidated by the trusted producer. No witness is minted here, and HTML is
 * untrusted data: this service does not render, dispatch or submit anything. */
import { createHash } from 'node:crypto';
import { AI_WORKBENCH_DISPLAY_DRAFT_VERSION, AI_WORKBENCH_DISPLAY_LIMITS,
  type AiConversationModelResultReadDraft, type AiWorkbenchDisplayBindingDraft,
  type AiWorkbenchPresentationDraft, type AiApprovalApplicationReferenceDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiWorkbenchDisplayOriginalReader, type AiWorkbenchDisplayOriginalMaterial } from './workbench-display-original.reader';
import { parseTaskModelDisplayWitness, type TaskModelDisplayWitness } from './model-input/task-model-display-witness';
import { inspectAiWorkbenchContext, inspectAiWorkbenchFieldMaterial, inspectAiWorkbenchPresentation } from './workbench-display.contract';
import { isGatewayResult } from './gateway-contract-validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { buildWorkbenchAuthoritativeSummary } from './workbench-authoritative-summary';

export interface AiWorkbenchDisplayCurrentAuthority {
  /** Same current-authorized producer used before original publication. It
   * must read the registered prompt/API/isolation policy and original field
   * rules now; returning the stored argument alone is not reauthorization. */
  revalidateOriginal(material: AiWorkbenchDisplayOriginalMaterial, witness: TaskModelDisplayWitness): Promise<TaskModelDisplayWitness>;
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);

export class AiWorkbenchDisplayPreparationService {
  constructor(private readonly originals: Pick<AiWorkbenchDisplayOriginalReader, 'read' | 'revalidate'>,
    private readonly authority: AiWorkbenchDisplayCurrentAuthority,
    private readonly clock: () => Date = () => new Date(),
    private readonly confirmations?: (original: AiWorkbenchDisplayOriginalMaterial) => Promise<AiApprovalApplicationReferenceDraft[]>) {
    if (typeof originals?.read !== 'function' || typeof originals.revalidate !== 'function'
      || typeof authority?.revalidateOriginal !== 'function') throw unavailable();
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
    return now.toISOString();
  }
  private async current(material: AiWorkbenchDisplayOriginalMaterial) {
    const witness = parseTaskModelDisplayWitness(material.witness);
    if (!witness) throw unavailable();
    const current = parseTaskModelDisplayWitness(await this.authority.revalidateOriginal(material, witness));
    if (!current || !same(witness, current)) throw denied();
    const now = this.now();
    if (Date.parse(witness.sourceExpiresAt) <= Date.parse(now)) throw unavailable();
    const context = inspectAiWorkbenchContext(witness.context, current.context, now);
    const fieldMaterial = witness.fieldMaterial === null ? null
      : inspectAiWorkbenchFieldMaterial(witness.fieldMaterial, current.fieldMaterial!, now);
    if (context.purpose !== 'display' || !same(context.binding, witness.binding)
      || !same(context.scope, material.context.scope)
      || fieldMaterial && !same(fieldMaterial.binding, witness.binding)) throw denied();
    return { witness, context, fieldMaterial, now };
  }
  async read(value: unknown) {
    const original = await this.originals.read(value), checked = await this.current(original);
    const { witness, context, fieldMaterial, now } = checked;
    const gateway = original.model.result.payload;
    if (!isGatewayResult(gateway) || gateway.status !== 'completed' || gateway.usage.kind !== 'reported'
      || gateway.requestId !== original.model.input.intent.requestId || gateway.toolRequests.length
      || Buffer.byteLength(gateway.text, 'utf8') > AI_WORKBENCH_DISPLAY_LIMITS.codeBytes) throw unavailable();
    if (witness.presentationRevision !== original.generationRevision) throw denied();
    const binding: AiWorkbenchDisplayBindingDraft = { ...witness.binding, presentationRevision: witness.presentationRevision };
    const business = buildWorkbenchAuthoritativeSummary(original);
    const authoritativeSummary = { version: 'ain-workbench-facts-1' as const, binding,
      runId: original.model.step.runId, resultId: original.model.result.id, observedAt: business.observedAt,
      source: 'current_original_business_facts' as const, text: business.text };
    const expiresAt = new Date(Math.min(Date.parse(witness.sourceExpiresAt), Date.parse(context.history.expiresAt),
      fieldMaterial ? Date.parse(fieldMaterial.retention.expiresAt) : Infinity)).toISOString();
    const presentation: AiWorkbenchPresentationDraft = {
      draftVersion: AI_WORKBENCH_DISPLAY_DRAFT_VERSION, binding,
      code: { language: 'html', complete: true, source: gateway.text,
        sha256: createHash('sha256').update(gateway.text, 'utf8').digest('hex') },
      generation: { runId: original.model.step.runId, stepId: original.model.step.id,
        resultId: original.model.result.id, resultHash: original.model.result.contentHash,
        promptVersion: witness.prompt.version, displayApiVersion: witness.displayApiVersion, isolationVersion: witness.isolationVersion },
      retention: { expiresAt, sourceExpiresAt: witness.sourceExpiresAt, aclRevision: witness.aclRevision, policyVersion: witness.policyVersion },
      trust: 'untrusted_display_code', execution: 'not_admitted'
    };
    inspectAiWorkbenchPresentation(presentation, binding, { now, sourceExpiresAt: witness.sourceExpiresAt,
      aclRevision: witness.aclRevision, policyVersion: witness.policyVersion });
    // IDs select original supplied references only. The source reader must
    // separately authorize and resolve each selected reference before delivery.
    const sourceIds = [...new Set([...(fieldMaterial?.sources.map(source => source.sourceId) ?? []),
      ...original.observation.sources.map(source => requestFingerprint(source)),
      ...(original.observation.knowledge?.material.sources.map(source => source.sourceId) ?? [])])];
    if (sourceIds.length > AI_WORKBENCH_DISPLAY_LIMITS.sourceReferences) throw unavailable();
    const proposals = this.confirmations ? await this.confirmations(original) : [];
    const after = await this.originals.revalidate(original.command, original.bindingHash);
    const closing = await this.current(after);
    if (!same(checked.witness, closing.witness) || Date.parse(expiresAt) <= Date.parse(closing.now)) throw denied();
    if (!same(business, buildWorkbenchAuthoritativeSummary(after))) throw denied();
    if (this.confirmations && !same(proposals, await this.confirmations(after))) throw denied();
    if (Date.parse(expiresAt) <= Date.parse(this.now())) throw unavailable();
    // Only independently read, currently waiting original proposals may be
    // requested by the frame. The host opens its separate fixed review.
    return freezeOriginalInput({ context, presentation, fieldMaterial, sourceIds, proposals, authoritativeSummary });
  }
  async revalidate(value: AiConversationModelResultReadDraft, expected: AiWorkbenchDisplayBindingDraft) {
    const current = await this.read(value);
    if (!same(expected, current.presentation.binding)) throw denied();
    return current;
  }
}
export type AiWorkbenchDisplayPreparedMaterial = Awaited<ReturnType<AiWorkbenchDisplayPreparationService['read']>>;
