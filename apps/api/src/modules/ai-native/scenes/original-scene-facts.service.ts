import { z } from 'zod';
import type { composeAiAuthorizedBusinessTools } from '../tools/business-tools.composition';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const fields = ['itemLabel', 'itemGroupLabel', 'assetLabel', 'fulfillmentLabel', 'pickupLabel', 'returnLabel'] as const;
const citationSchema = originalRequestReferenceSchema.extend({ version: z.string().min(1).max(191),
  field: z.enum(['order', 'amounts', 'saved_basis', 'payment_records', 'rental_period', 'inspection_records']) }).strict();
const sectionsSchema = originalRequestReferenceSchema.extend({ sections: z.array(z.object({ key: z.string().min(1).max(191),
  expectedVersion: z.string().min(1).max(191), changes: z.array(z.object({ field: z.enum(fields), value: z.string().trim().min(1).max(80) }).strict()).min(1).max(6)
}).strict()).min(1).max(6).refine(rows => new Set(rows.map(row => row.key)).size === rows.length) }).strict();
const quoteConfirmation = originalRequestReferenceSchema.extend({
  selectionRevision: z.string().regex(/^[a-f0-9]{64}$/),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmQuote: z.literal(true)
}).strict();

export class AiOriginalSceneFactsService {
  constructor(private readonly requests: PrismaOriginalRequestRepository, private readonly tools: ReturnType<typeof composeAiAuthorizedBusinessTools>) {}
  async reopenOrderCitation(value: unknown) {
    const parsed = citationSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.readHistorical(ref);
    if (original.request.sceneCode !== 'order_explanation' || original.context.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const result = await this.tools.orderExplanationPreparation(original.request.input.orderId).reopenCitation({
      question: original.request.input.question, resourceType: 'order', resourceId: original.request.input.orderId,
      scope: original.context.scope, version: command.version, field: command.field
    });
    const after = await this.requests.readHistorical(ref);
    if (originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: original.receipt, source: result, execution: 'not_attempted' as const });
  }
  async prepareOpeningSections(value: unknown) {
    const parsed = sectionsSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.read(ref);
    if (original.request.sceneCode !== 'opening_diagnosis') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const selected = new Set(original.request.input.sections);
    if (command.sections.some(section => !selected.has(section.key))) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const before = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const result = await this.tools.openingSectionDifferences({ sections: command.sections });
    const snapshot = freezeOriginalInput(result);
    const after = await this.requests.read(ref);
    const grant = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    if (originalIdentityHash(before.context) !== originalIdentityHash(grant.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: original.receipt, sections: snapshot, publication: 'not_attempted' as const,
      proposalPersistence: 'unavailable_no_formal_section_proposal_port' as const });
  }
  async reviewQuote(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const ref = freezeOriginalInput(parsed.data), original = await this.requests.read(ref);
    if (original.request.sceneCode !== 'quote_clarification') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const beforeGrant = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const facts = await this.tools.quote.businessPreparation.prepareUnified(original.request.input.candidate);
    const sources = await this.tools.quote.businessPreparation.inputSources(original.request.input.candidate);
    // Preparation and provenance are sequential authorized reads. Never join
    // ready facts with a now-missing selection, or silently replace the request
    // with different parameters/configuration discovered by the second read.
    const factBasis = facts as unknown as Record<string, unknown>, sourceBasis = sources as unknown as Record<string, unknown>;
    if (factBasis.request !== undefined) {
      if (sourceBasis.status !== 'prepared_input_sources' || factBasis.selectionRevision !== sourceBasis.selectionRevision
        || requestFingerprint(factBasis.request) !== requestFingerprint(sourceBasis.request)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    } else {
      const basis = (row: Record<string, unknown>) => ({ status: row.status, selectionRevision: row.selectionRevision,
        missingFields: row.missingFields, ambiguousFields: row.ambiguousFields });
      if (requestFingerprint(basis(factBasis)) !== requestFingerprint(basis(sourceBasis))) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    const after = await this.requests.read(ref);
    const afterGrant = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    if (originalIdentityHash(beforeGrant.context) !== originalIdentityHash(afterGrant.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: original.receipt, facts, sources, materialHash: requestFingerprint({ facts, sources }),
      humanSelection: 'not_attested' as const, quotePersistence: 'not_attempted' as const, orderApproval: 'not_granted' as const,
      execution: 'not_attempted' as const });
  }

  /** Explicit authenticated host action after displaying the current prepared
   * parameters. This confirms only an R1 quote request, never order approval.
   * The caller cannot supply a price, actor, scope or Core operation key. */
  confirmQuote(value: unknown) { return this.originalQuote(value); }

  /** Exact original-operation observation only; a missing row stays unknown.
   * No create, latest-quote lookup or replacement operation is attempted. */
  async readQuoteReceipt(value: unknown) {
    const parsed = originalRequestReferenceSchema.extend({
      selectionRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional()
    }).strict().safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const ref = freezeOriginalInput({ draftVersion: parsed.data.draftVersion, inputRef: parsed.data.inputRef });
    const original = await this.requests.readHistorical(ref);
    if (original.request.sceneCode !== 'quote_clarification') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const result = await this.tools.quote.recoverOriginal(`${ref.inputRef}:${original.receipt.contentHash}`,
      originalIdentityHash(original.context));
    const after = await this.requests.readHistorical(ref);
    if (originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: original.receipt, result, observation: 'original_operation_only' as const,
      selection: 'historical_not_current_confirmation' as const,
      orderApproval: 'not_granted' as const, inventoryReservation: 'not_attempted' as const });
  }

  private async originalQuote(value: unknown) {
    const parsed = quoteConfirmation.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.read(ref);
    if (original.request.sceneCode !== 'quote_clarification') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const selected = await this.tools.quote.candidates.prepare(original.request.input.candidate);
    if (selected.status !== 'needs_confirmation') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (selected.selectionRevision !== command.selectionRevision
      || requestFingerprint(selected.request) !== command.inputFingerprint) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const again = await this.requests.read(ref);
    const grant = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    if (originalIdentityHash(before.context) !== originalIdentityHash(grant.context)
      || original.receipt.contentHash !== again.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const result = await this.tools.quote.preview.previewOriginal(selected.request, {
      reference: `${ref.inputRef}:${original.receipt.contentHash}`,
      expectedIdentityHash: originalIdentityHash(grant.context)
    }, selected.configurationFingerprint, false, selected.addressFingerprint);
    const final = await this.requests.read(ref);
    const after = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    if (originalIdentityHash(grant.context) !== originalIdentityHash(after.context)
      || final.receipt.contentHash !== original.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: original.receipt, result,
      observation: 'explicit_quote_request' as const,
      orderApproval: 'not_granted' as const, inventoryReservation: 'not_attempted' as const });
  }
}
