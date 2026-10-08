import { z } from 'zod';
import type { composeAiAuthorizedBusinessTools } from '../tools/business-tools.composition';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const fields = ['itemLabel', 'itemGroupLabel', 'assetLabel', 'fulfillmentLabel', 'pickupLabel', 'returnLabel'] as const;
const citationSchema = originalRequestReferenceSchema.extend({ version: z.string().min(1).max(191),
  field: z.enum(['order', 'amounts', 'saved_basis', 'payment_records', 'rental_period']) }).strict();
const sectionsSchema = originalRequestReferenceSchema.extend({ sections: z.array(z.object({ key: z.string().min(1).max(191),
  expectedVersion: z.string().min(1).max(191), changes: z.array(z.object({ field: z.enum(fields), value: z.string().trim().min(1).max(80) }).strict()).min(1).max(6)
}).strict()).min(1).max(6).refine(rows => new Set(rows.map(row => row.key)).size === rows.length) }).strict();

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
    if (originalIdentityHash(original.context) !== originalIdentityHash(after.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
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
    await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const result = await this.tools.openingSectionDifferences({ sections: command.sections });
    await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    return freezeOriginalInput({ original: original.receipt, sections: result, publication: 'not_attempted' as const,
      proposalPersistence: 'unavailable_no_formal_section_proposal_port' as const });
  }
  async reviewQuote(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const ref = freezeOriginalInput(parsed.data), original = await this.requests.read(ref);
    if (original.request.sceneCode !== 'quote_clarification') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    const facts = await this.tools.quote.businessPreparation.prepareUnified(original.request.input.candidate);
    const sources = await this.tools.quote.businessPreparation.inputSources(original.request.input.candidate);
    if ('selectionRevision' in facts && 'selectionRevision' in sources && facts.selectionRevision !== sources.selectionRevision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    await this.requests.resolve(original.request.sceneCode, ref.inputRef);
    return freezeOriginalInput({ original: original.receipt, facts, sources, materialHash: requestFingerprint({ facts, sources }),
      humanSelection: 'not_attested' as const, quotePersistence: 'not_attempted' as const, orderApproval: 'not_granted' as const,
      execution: 'not_attempted' as const });
  }
}
