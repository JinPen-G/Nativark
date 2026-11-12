/** Original quote preparation projected into the workbench's field protocol.
 * The injected original reader owns current authorization and resource rules.
 * No question, default, human receipt, quotation or historical witness is minted. */
import { isDeepStrictEqual } from 'node:util';
import { AI_WORKBENCH_CONTEXT_DRAFT_VERSION,
  type AiExecutionContext, type AiFactReference, type AiSceneQuoteCandidate,
  type AiTaskInputContractDraft, type AiTaskInputAnswerDraft,
  type AiWorkbenchFieldMaterialDraft, type AiWorkbenchMaterialBindingDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import { originalQuoteAnswerContract } from './scenes/original-quote-input';
import { aiQuoteCandidateInputSchema } from './tools/quote-candidate-preparation.service';
import { originalIdentityHash } from './task-request/original-request.authority';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { inspectAiWorkbenchFieldMaterial } from './workbench-display.contract';

export interface WorkbenchQuoteFieldInput {
  context: AiExecutionContext;
  binding: AiWorkbenchMaterialBindingDraft;
  candidate: AiSceneQuoteCandidate;
  fieldRevision: number;
  /** Original authorized configuration references, never model-selected IDs. */
  sources: readonly AiFactReference[];
  retention: { expiresAt: string; aclRevision: string; policyVersion: string };
}
interface OriginalQuotePreparationSource {
  prepare(candidate: unknown, expectedContext?: AiExecutionContext): Promise<unknown>;
  prepareWorkbenchFields?(candidate: unknown, expectedContext?: AiExecutionContext): Promise<{
    preparation: unknown; editableContract: AiTaskInputContractDraft | null; defaults: AiTaskInputAnswerDraft[] }>;
}
const editable = new Set(['quantity', 'starts_at', 'ends_at', 'pickup_location', 'return_location']);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const businessBasis = (material: AiWorkbenchFieldMaterialDraft) => {
  const sources = material.sources.map(source => {
    const { observedAt: _observation, ...reference } = source.reference;
    return { originalId: source.sourceId, sourceId: requestFingerprint(reference), reference };
  });
  return { ...material, fields: material.fields.map(field => {
    const source = sources.find(source => source.originalId === field.sourceId);
    if (!source) throw denied();
    return { ...field, sourceId: source.sourceId };
  }), sources: sources.map(({ originalId: _id, ...source }) => source) };
};

export class AiWorkbenchFieldMaterialService {
  constructor(private readonly source: OriginalQuotePreparationSource, private readonly clock: () => Date = () => new Date()) {
    if (typeof source?.prepare !== 'function' || typeof clock !== 'function') throw unavailable();
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
    return now;
  }
  async prepare(value: WorkbenchQuoteFieldInput, originalQuestionProjection = false): Promise<AiWorkbenchFieldMaterialDraft | null> {
    // Keep the same enclosing principal and candidate through the original
    // asynchronous reads; caller mutation cannot supply a different closing basis.
    const input = structuredClone(value), { context, binding, retention } = input, now = this.now();
    if (context?.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || !('access' in context) || binding?.capabilityCode !== 'quote_clarification'
      || !Number.isSafeInteger(input.fieldRevision) || input.fieldRevision < 1 || input.fieldRevision > 4294967294
      || !hash(binding.inputFingerprint) || !hash(binding.materialHash)
      || retention?.aclRevision !== originalIdentityHash(context)
      || !Number.isFinite(Date.parse(retention.expiresAt)) || Date.parse(retention.expiresAt) <= now.getTime()
      || !Array.isArray(input.sources) || input.sources.length > 50) throw denied();
    const parsed = aiQuoteCandidateInputSchema.safeParse(input.candidate);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const projection = !originalQuestionProjection && this.source.prepareWorkbenchFields
      ? await this.source.prepareWorkbenchFields(structuredClone(parsed.data), structuredClone(context)) : null;
    const prepared = projection ? projection.preparation : await this.source.prepare(structuredClone(parsed.data), structuredClone(context));
    if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) throw unavailable();
    const result = prepared as { status?: unknown; selectionRevision?: unknown };
    if (result.status === 'unavailable') return null;
    if (!['missing_input', 'ambiguous', 'needs_confirmation'].includes(String(result.status))) throw unavailable();
    // Without the original selection revision there is no independently
    // reproducible field basis. A syntactically valid candidate is insufficient.
    if (!hash(result.selectionRevision)) return null;
    const original = projection?.editableContract ?? originalQuoteAnswerContract(parsed.data, prepared, '请在原输入控件核对其余条件。');
    if (projection?.editableContract && (original.code !== 'original_quote_editable_parameters'
      || original.version !== result.selectionRevision)) throw denied();
    const fields = original.fields.filter(field => editable.has(field.fieldId));
    if (!fields.length) return null;
    const references = input.sources.filter(source => source?.resourceType === 'configuration'
      && isDeepStrictEqual(source.scope, context.scope) && source.basis
      && ['current', 'snapshot'].includes(source.basis.kind)
      && Number.isFinite(Date.parse(source.observedAt)) && Date.parse(source.observedAt) <= this.now().getTime());
    if (!references.length) return null;
    const reference = references[0], sourceId = requestFingerprint(reference);
    const material: AiWorkbenchFieldMaterialDraft = {
      draftVersion: AI_WORKBENCH_CONTEXT_DRAFT_VERSION, binding, fieldRevision: input.fieldRevision,
      // Missing-input fields retain their complete original question. Complete
      // editable fields belong to linked reprepare and mint no input receipt.
      contract: { ...original, fields },
      fields: fields.map(field => {
        const current = projection?.defaults.find(value => value.fieldId === field.fieldId);
        return { fieldId: field.fieldId, editable: true, sourceId,
          defaultValue: current ? { status: 'provided' as const, value: current.value } : { status: 'unavailable' as const } };
      }),
      sources: [{ sourceId, reference }], retention,
      authority: 'original_business_rules_not_model_rules',
    };
    return inspectAiWorkbenchFieldMaterial(material, material, this.now().toISOString());
  }
  async revalidate(input: WorkbenchQuoteFieldInput, expected: AiWorkbenchFieldMaterialDraft): Promise<AiWorkbenchFieldMaterialDraft> {
    const original = structuredClone(expected);
    inspectAiWorkbenchFieldMaterial(original, original, this.now().toISOString());
    if (!isDeepStrictEqual(input.binding, original.binding) || input.fieldRevision !== original.fieldRevision) throw denied();
    // Call the real original preparation again. Returning the stored field
    // packet by itself would turn historical material into current authority.
    // Retained question witnesses keep their original narrow projection when
    // the server gains a separate complete-condition editing projection.
    const current = await this.prepare(input, original.contract?.code !== 'original_quote_editable_parameters');
    if (!current) throw unavailable();
    // A fresh read has its own observation time. It must prove the same
    // configuration, rules and retention without relabeling the old witness
    // as a newly observed artifact or rotating its original source locator.
    if (!isDeepStrictEqual(businessBasis(original), businessBasis(current))) throw denied();
    return inspectAiWorkbenchFieldMaterial(original, original, this.now().toISOString());
  }
}
