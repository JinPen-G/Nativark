/** Rental's private original-result ports. They neither register MCP tools nor
 * release fields. Native Task observations use the caller's existing custody. */
import type { Prisma } from '@prisma/client';
import { AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS, AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS,
  type AiHumanQuoteOrderReviewRequestDraft, type AiQuoteSelectionReadDraft, type AiSelectedQuoteTaskRequestDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../../task-errors';
import { AiScopeRepository } from '../ai-scope.repository';
import { aiTaskAccessFromContext } from '../task-owner-access';
import { AiTaskActionChecks } from '../task-action-checks';
import { PrismaTaskActionPolicySource } from '../prisma-task-action-policy.source';
import { createOriginalTaskRecoveryRead } from '../original-task-recovery-read';
import type { AiOriginalResultReadLease } from '../original-result-reads';
import { originalIdentityHash, type AiOriginalRequestNativeAuthority } from '../task-request/original-request.authority';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { parseQuoteSelectionRead, validateQuoteSelectionResponse, validateQuoteSelectionHttpRequest } from '../task-request/quote-selection.validation';
import { validateAiSceneQuoteResponse } from '../scenes/original-scenes.controller';
import type { AiOriginalSceneFactsService } from '../scenes/original-scene-facts.service';
import type { PrismaQuoteSelectionRepository } from '../task-request/prisma-quote-selection.repository';
import type { composeHumanQuoteOrder, composeSelectedQuoteTaskApplication } from '../scenes/human-quote-order.composition';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../contracts/ai-native-schemas';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** The original private order-tool components used by scene result validation. */
export function rentalOriginalResultComponents() {
  return structuredClone({ AiOrderExplainRequestDraft: AI_NATIVE_COMPONENT_SCHEMAS.AiOrderExplainRequestDraft,
    AiOrderExplainInput: AI_NATIVE_COMPONENT_SCHEMAS.AiOrderExplainInput });
}

/** Exact Task recovery inside an existing trusted Native callback. The existing
 * original resource authority and persisted Task read policy are both required. */
export function bindRentalOriginalTaskRecoveryReadIn(input: {
  native: Prisma.TransactionClient;
  authority: AiOriginalRequestNativeAuthority;
  originals: Pick<PrismaOriginalRequestRepository, 'bindHistoricalTaskReadsIn'>;
  signal: AbortSignal;
  clock?: () => Date;
}) {
  const { native, authority, originals, signal } = input, clock = input.clock ?? (() => new Date());
  if (!native || '$transaction' in native || typeof authority?.bindIn !== 'function' || signal.aborted) throw denied();
  const bound = authority.bindIn(native, signal);
  const live = () => { if (signal.aborted) throw denied(); bound.assertCurrent(); };
  const identities = { resolve: async () => { live(); const access = await bound.current(); live(); return access.context; } };
  const scopes = new AiScopeRepository(native, identities, clock);
  const actions = new AiTaskActionChecks(identities, new PrismaTaskActionPolicySource(native, scopes, clock), clock);
  const original = originals.bindHistoricalTaskReadsIn(native, authority, signal, async taskId => {
    const context = await actions.resolve(taskId, 'read_metadata'), current = await bound.current();
    live();
    if (originalIdentityHash(context) !== originalIdentityHash(current.context)) throw denied();
    return current;
  });
  const read = createOriginalTaskRecoveryRead(native, { ...original, async resolveMetadataAccess(taskId) {
    live();
    const context = await actions.resolve(taskId, 'read_metadata');
    live();
    return aiTaskAccessFromContext(context, taskId, clock());
  } }, clock);
  return (value: unknown, stop: AbortSignal) => read(value, AbortSignal.any([signal, stop]));
}

/** Bind request-local original business readers, never a credential supplied by
 * MCP. These legacy readers still own their current Guard and original evidence.
 * Only an original read authority may supply them; this does not adapt a Web
 * credential to MCP or promise the reader shares a caller-owned transaction. */
export function bindRentalOriginalSaleReads(input: AiOriginalResultReadLease & {
  quote: Pick<AiOriginalSceneFactsService, 'readQuoteReceipt'>;
  selection: Pick<PrismaQuoteSelectionRepository, 'read'>;
  approval: Pick<ReturnType<typeof composeHumanQuoteOrder>, 'readSelectedProposal'>;
  task: Pick<ReturnType<typeof composeSelectedQuoteTaskApplication>, 'readResult'>;
}) {
  const current = input.assertCurrent.bind(input), quote = input.quote.readQuoteReceipt.bind(input.quote);
  const selection = input.selection.read.bind(input.selection), proposal = input.approval.readSelectedProposal.bind(input.approval);
  const order = input.task.readResult.bind(input.task);
  const read = async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
    const live = async () => { if (signal.aborted) throw denied(); await current(); if (signal.aborted) throw denied(); };
    await live();
    const result = await work();
    await live();
    return result;
  };
  return Object.freeze({
    quoteReceipt(value: unknown, signal: AbortSignal) {
      const command = structuredClone(value);
      return read(signal, async () => validateAiSceneQuoteResponse('AiOriginalQuoteReceiptResponseDraft', await quote(command)));
    },
    quoteSelection(value: AiQuoteSelectionReadDraft, signal: AbortSignal) {
      const command = parseQuoteSelectionRead(value);
      return read(signal, async () => {
        const result = validateQuoteSelectionResponse('AiQuoteSelectionReceiptDraft', await selection(command));
        if (result.draftVersion !== command.draftVersion || result.selectionId !== command.selectionId
          || result.originalInputRef !== command.originalInputRef) throw denied();
        return result;
      });
    },
    selectedProposal(value: AiHumanQuoteOrderReviewRequestDraft, signal: AbortSignal) {
      const command = validateQuoteSelectionHttpRequest(AI_HUMAN_QUOTE_ORDER_HTTP_CONTRACTS.readSelectedProposal.request, value) as AiHumanQuoteOrderReviewRequestDraft;
      return read(signal, async () => {
        const result = validateQuoteSelectionResponse('AiApprovalApplicationReviewDraft', await proposal(command));
        if (result.proposal.payload.proposalId !== command.proposal.proposalId || result.proposal.payload.revision !== command.proposal.proposalRevision
          || result.proposal.payload.taskId !== command.selection.taskId || result.proposal.payloadHash !== command.proposal.reviewedPayloadHash) throw denied();
        return result;
      });
    },
    selectedOrderResult(value: AiSelectedQuoteTaskRequestDraft, signal: AbortSignal) {
      const command = validateQuoteSelectionHttpRequest(AI_SELECTED_QUOTE_TASK_HTTP_CONTRACTS.readResult.request, value);
      // This API intentionally selects only readResult. Reconcile can acquire
      // a recovery lease, so it cannot substitute for observing the old key.
      return read(signal, async () => {
        const result = validateQuoteSelectionResponse('AiSelectedQuoteTaskResultDraft', await order(command));
        if (result.status === 'committed' && result.source.resourceId !== result.order.id) throw denied();
        return result;
      });
    }
  });
}
