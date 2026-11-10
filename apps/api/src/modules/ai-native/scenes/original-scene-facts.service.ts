import { z } from 'zod';
import type { composeAiAuthorizedBusinessTools } from '../tools/business-tools.composition';
import { AiQuotePreparedSourcesChanged } from '../tools/quote-business-preparation.service';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiCatalogReadInputSchema } from '../catalog-read-facts.service';
import { aiOrderExtensionPreviewInputSchema } from '../tools/order-extension-preview.service';
import { AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2 } from '@rental-os/shared';

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

/** Original-request business reads and R1 quote preparation. Sources retain the
 * freshly resolved server principal; independent final reads cannot bind earlier
 * material from another actor. No order approval or alternate Core path is added. */
export class AiOriginalSceneFactsService {
  constructor(private readonly requests: PrismaOriginalRequestRepository, private readonly tools: ReturnType<typeof composeAiAuthorizedBusinessTools>) {}
  /** Explicit human-requested preview for the original next-step question.
   * Current extend permission is independent of the original order read. */
  async previewOrderExtension(value: unknown) {
    const parsed = originalRequestReferenceSchema.merge(aiOrderExtensionPreviewInputSchema).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.read(ref);
    if (original.request.sceneCode !== 'order_explanation' || original.request.input.question !== 'next_steps') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const grant = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const result = await this.tools.orderExtensionPreview(original.request.input.orderId).read({
      expectedOrderVersion: command.expectedOrderVersion, extension: command.extension
    }, grant.context);
    const after = await this.requests.read(ref), current = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    if (originalIdentityHash(grant.context) !== originalIdentityHash(current.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: original.receipt, result, taskExecution: 'not_started' as const });
  }
  /** Current, bounded candidate source for an original quote question. Page
   * references are observations, never human selection or pricing authority. */
  async readQuoteCatalog(value: unknown) {
    const hash = z.string().regex(/^[a-f0-9]{64}$/u);
    const parsed = originalRequestReferenceSchema.extend({ query: aiCatalogReadInputSchema,
      expectedConfigurationVersion: hash.optional(), expectedPageFingerprint: hash.optional()
    }).strict().refine(row => (row.expectedConfigurationVersion === undefined) === (row.expectedPageFingerprint === undefined))
      .safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.read(ref);
    if (original.request.sceneCode !== 'quote_clarification') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const grant = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const read = () => this.tools.catalog.read(command.query, grant.context);
    const page = await read();
    const basis = (value: typeof page) => ({ scope: value.scope, audience: value.audience, query: command.query,
      items: value.items, configurationVersion: value.configurationVersion,
      truncated: value.truncated, nextCursor: value.nextCursor, source: value.source });
    const fingerprint = requestFingerprint(basis(page));
    if (requestFingerprint(basis(await read())) !== fingerprint) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const after = await this.requests.read(ref), current = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    if (originalIdentityHash(grant.context) !== originalIdentityHash(current.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const changed = (command.expectedConfigurationVersion !== undefined && command.expectedConfigurationVersion !== page.configurationVersion)
      || (command.expectedPageFingerprint !== undefined && command.expectedPageFingerprint !== fingerprint);
    return freezeOriginalInput({ original: original.receipt, page,
      reference: { ...ref, query: command.query, expectedConfigurationVersion: page.configurationVersion,
        expectedPageFingerprint: fingerprint },
      state: changed ? 'changed_reconfirmation_required' as const : 'observed' as const,
      selection: 'not_attested' as const, quotation: 'not_attempted' as const,
      inventoryReservation: 'not_attempted' as const, execution: 'not_attempted' as const });
  }
  /** Resolve one displayed candidate for the original next-steps question.
   * This is material for the human destination, never an allowed-actions grant. */
  async prepareOrderManualHandoff(value: unknown) {
    const parsed = originalRequestReferenceSchema.extend({
      expectedOrderVersion: z.string().min(1).max(191),
      code: z.enum(['rental.order.explain', 'rental.quote.preview', 'rental.change.preview', 'rental.order.commit'])
    }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.read(ref);
    if (original.request.sceneCode !== 'order_explanation' || original.request.input.question !== 'next_steps') {
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    }
    const grant = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const orderId = original.request.input.orderId, reader = this.tools.order(orderId);
    const before = await reader.read(grant.context);
    if (before.order.updatedAt !== command.expectedOrderVersion) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    // The current Guard must retain this original request's server binding
    // through the nested read, not merely match again after it has returned.
    const handoff = await this.tools.orderManualHandoff(orderId, { code: command.code }, grant.context);
    const latest = await reader.read(grant.context);
    if (requestFingerprint(before.order) !== requestFingerprint(latest.order)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const after = await this.requests.read(ref), current = await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    if (originalIdentityHash(grant.context) !== originalIdentityHash(current.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: original.receipt,
      source: { scope: grant.context.scope, resourceType: 'order' as const, resourceId: orderId,
        version: before.order.updatedAt, observedAt: latest.observedAt },
      handoff, approval: 'not_granted' as const, execution: 'not_attempted' as const });
  }
  async readOpeningSection(value: unknown) {
    const parsed = originalRequestReferenceSchema.extend({
      key: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
    }).strict().safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    // Reopen the original selected source under current read permissions;
    // expiry stops new execution, not observation of its original evidence.
    const original = await this.requests.readHistorical(ref);
    if (original.request.sceneCode !== 'opening_diagnosis') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (original.receipt.state === 'revoked' || !original.request.input.sections.includes(command.key)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const section = freezeOriginalInput(structuredClone(await this.tools.openingSection({ key: command.key }, original.context)));
    const after = await this.requests.readHistorical(ref);
    if (after.receipt.state === 'revoked' || originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    // A read may cross the original deadline. Publish the closing receipt,
    // without extending expiry or replacing historical read rights with execution.
    return freezeOriginalInput({ original: after.receipt, section, execution: 'not_attempted' as const,
      proposalPersistence: 'unavailable_no_formal_section_proposal_port' as const });
  }
  async reopenOrderCitation(value: unknown) {
    const parsed = citationSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.readHistorical(ref);
    if (original.request.sceneCode !== 'order_explanation' || original.context.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (original.receipt.state === 'revoked') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const result = await this.tools.orderExplanationPreparation(original.request.input.orderId).reopenCitation({
      question: original.request.input.question, resourceType: 'order', resourceId: original.request.input.orderId,
      scope: original.context.scope, version: command.version, field: command.field
    }, original.context);
    const after = await this.requests.readHistorical(ref);
    if (after.receipt.state === 'revoked' || originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: after.receipt, source: result, execution: 'not_attempted' as const });
  }
  /** New source version remains tied to the original owner/request. Parent
   * order, scope and question are reconstructed here, never client authority. */
  async reopenOrderCitationV2(value: unknown) {
    const parsed = originalRequestReferenceSchema.extend({
      materialVersion: z.literal(AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION),
      version: z.string().min(1).max(191), field: z.enum(AI_ORDER_EXPLANATION_SOURCE_FIELDS_V2)
    }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), ref = { draftVersion: command.draftVersion, inputRef: command.inputRef };
    const original = await this.requests.readHistorical(ref);
    if (original.request.sceneCode !== 'order_explanation' || original.context.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (original.receipt.state === 'revoked') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const result = await this.tools.orderExplanationPreparation(original.request.input.orderId).reopenCitationV2({
      materialVersion: command.materialVersion, question: original.request.input.question,
      resourceType: 'order', resourceId: original.request.input.orderId, scope: original.context.scope,
      version: command.version, field: command.field
    }, original.context);
    const after = await this.requests.readHistorical(ref);
    if (after.receipt.state === 'revoked' || originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return freezeOriginalInput({ original: after.receipt, source: result, execution: 'not_attempted' as const });
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
    const result = await this.tools.openingSectionDifferences({ sections: command.sections }, before.context);
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
    const { preparation: facts, sources } = await this.tools.quote.businessPreparation.reviewParameters(
      original.request.input.candidate, beforeGrant.context).catch(error => {
      // Preserve this original endpoint's observation-conflict response only.
      // Generic configuration/dependency and permission failures remain fatal;
      // elapsed-only blocked material is handled by the shared original pair.
      if (error instanceof AiQuotePreparedSourcesChanged) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      throw error;
    });
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

  /** Compare only two exact, currently authorized original Core operations.
   * The existing formatter cannot itself establish ownership or provenance. */
  async compareOriginalQuotes(value: unknown) {
    const parsed = z.object({ previous: originalRequestReferenceSchema, current: originalRequestReferenceSchema })
      .strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data);
    const previousOwner = await this.requests.readHistorical(command.previous);
    const currentOwner = await this.requests.readHistorical(command.current);
    const identity = originalIdentityHash(previousOwner.context);
    if (identity !== originalIdentityHash(currentOwner.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const previousBefore = await this.readQuoteReceipt(command.previous), currentBefore = await this.readQuoteReceipt(command.current);
    const stable = (value: typeof previousBefore) => requestFingerprint({
      // Stored/expired are derived from the trusted read clock, not revisions.
      // Keep the actual expiry fields, revocation and every saved quote field
      // binding; an unknown/failed operation must never become a saved quote.
      original: { ...value.original, state: value.original.state === 'stored' || value.original.state === 'expired'
        ? 'stored_or_expired' : value.original.state },
      scope: value.result.scope, status: value.result.quote && value.result.quotePersistence === 'saved'
        && (value.result.status === 'quoted' || value.result.status === 'expired') ? 'saved_quote' : value.result.status,
      quote: value.result.quote, quotePersistence: value.result.quotePersistence });
    let previous = await this.readQuoteReceipt(command.previous), current = await this.readQuoteReceipt(command.current);
    if (stable(previousBefore) !== stable(previous) || stable(currentBefore) !== stable(current))
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    // Return closing observations so expiry during the source waits is visible;
    // historical comparison does not renew the input/quote or old confirmation.
    for (const [reference, original] of [[command.previous, previousOwner], [command.current, currentOwner]] as const) {
      const latest = await this.requests.readHistorical(reference);
      if (originalIdentityHash(latest.context) !== identity || latest.receipt.contentHash !== original.receipt.contentHash) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      // The final owner checks may also cross expiry. Refresh only the checked
      // original receipt, not the earlier Core quote observation or its validity.
      // Same-reference comparisons use the last observation for both sides.
      if (reference.inputRef === command.previous.inputRef) previous = { ...previous, original: latest.receipt };
      if (reference.inputRef === command.current.inputRef) current = { ...current, original: latest.receipt };
    }
    // An older valid display may omit currency. Preserve its exact receipt,
    // but the closed comparison cannot label absent monetary evidence unchanged
    // or borrow today's settings. Use the existing unavailable response instead.
    const available = (result: typeof previous.result) => Boolean(result.quote)
      && (result.status === 'quoted' || result.status === 'expired') && result.quotePersistence === 'saved'
      && /^[A-Z]{3}$/u.test(result.quote?.currency ?? '');
    if (!available(previous.result) || !available(current.result)) return freezeOriginalInput({
      status: 'unavailable_original_quote' as const, previous, current, comparison: null,
      retryable: false as const, nextAction: 'read_original_quote_receipt' as const,
      quotation: 'not_attempted' as const, orderApproval: 'not_granted' as const });
    return freezeOriginalInput({ status: 'compared' as const, previous, current,
      comparison: this.tools.quote.businessPreparation.compareQuotes(previous.result.quote, current.result.quote),
      quotation: 'not_attempted' as const, inventoryReservation: 'not_attempted' as const,
      orderApproval: 'not_granted' as const, approvalReuse: 'forbidden_new_quote_requires_new_confirmation' as const });
  }

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
    // History may cross expiry during Core recovery; report the closing
    // receipt without renewing this input or its old quote confirmation.
    return freezeOriginalInput({ original: after.receipt, result, observation: 'original_operation_only' as const,
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
    const selected = await this.tools.quote.candidates.prepare(original.request.input.candidate, before.context);
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
