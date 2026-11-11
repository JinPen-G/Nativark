/** Different human conditions -> linked original request -> original Core quote
 * selection. The request marker is stored with reissue in one transaction.
 * Receipt reads never recreate a task, quote, selection, plan or approval. */
import { hasEffectivePermission } from '../../../common/permission-match';
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_QUOTE_SELECTION_DRAFT_VERSION,
  type AiSceneRequestReadDraft, type AiExecutionContext, type AiQuoteRequestReissueReferenceDraft,
  type AiQuoteRequestReissuePreparationInputDraft, type AiQuoteRequestReissueCreateDraft,
  type AiQuoteRequestReissueSelectDraft } from '@rental-os/shared';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import type { composeHumanQuoteOrder, HumanQuoteOrderDependencies } from './human-quote-order.composition';
import { AiOriginalSceneFactsService } from './original-scene-facts.service';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import { PrismaQuoteSelectionRepository } from '../task-request/prisma-quote-selection.repository';
import { parseQuoteSelection, validateQuoteSelectionHttpRequest, validateQuoteSelectionResponse } from '../task-request/quote-selection.validation';
import { approvedOrderReviewMaterial } from '../approval-execution/approved-order-review-material';
import { checkedAiAvailabilityResult } from '../availability-read-facts.service';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

export interface QuoteRequestReissueConfiguration {
  /** Existing current-owner CAS participant. Construction and reads do not
   * issue policies; the original selected-task host still authorizes its start. */
  admission?(request: { headers: { authorization?: unknown } }, original: AiSceneRequestReadDraft, signal?: AbortSignal): Promise<void>;
}
type Source = Awaited<ReturnType<ReturnType<typeof composeHumanQuoteOrder>['readRequestReissueSource']>>;
type Dependencies = AiOriginalSceneDependencies & HumanQuoteOrderDependencies & {
  source(value: AiQuoteRequestReissuePreparationInputDraft, requireEligible: boolean): Promise<Source>;
};
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const marker = z.object({ kind: z.literal('quote-linked-request-1'), reference: z.unknown(), commandHash: z.string().regex(/^[a-f0-9]{64}$/u),
  originalHash: z.string().regex(/^[a-f0-9]{64}$/u), candidateHash: z.string().regex(/^[a-f0-9]{64}$/u), inputRef: z.string().uuid() }).strict();
const requiredPolicies = ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run', 'claim_recovery_run',
  'release_run', 'transition_task', 'takeover_run', 'decide_approval'];

export function composeQuoteRequestReissue(d: Dependencies, configuration: QuoteRequestReissueConfiguration = {}) {
  const scenes = composeAiOriginalScenes(d), facts = new AiOriginalSceneFactsService(d.originals, scenes.tools);
  const selections = new PrismaQuoteSelectionRepository(d), routes = new AiBusinessReadRouteAuthority(d.guard, d.credentials, d.clock);
  const now = () => { const value = (d.clock ?? (() => new Date()))(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const source = async (value: AiQuoteRequestReissuePreparationInputDraft, eligible: boolean) => {
    const result = await d.source(value, eligible);
    if (result.context.actor.kind !== 'user' || result.context.scope.kind !== 'workspace') throw denied();
    return result;
  };
  const reference = (value: unknown) => validateQuoteSelectionHttpRequest('AiQuoteRequestReissueReferenceDraft', value) as AiQuoteRequestReissueReferenceDraft;
  const common = (value: AiQuoteRequestReissueReferenceDraft | AiQuoteRequestReissuePreparationInputDraft) => ({
    selection: value.selection, original: value.original, intent: value.intent });
  const operationId = (context: AiExecutionContext, value: AiQuoteRequestReissueReferenceDraft) => {
    const digest = requestFingerprint({ kind: 'quote-linked-request-1', scope: context.scope, actor: context.actor,
      selectionId: value.selection.selectionId, operationKey: value.operationKey });
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
  };
  const sourceHash = (root: Source, candidate: AiQuoteRequestReissuePreparationInputDraft['candidate']) =>
    requestFingerprint({ kind: 'quote-linked-request-1', source: root.sourceHash, intent: root.intent, candidate });
  const currentPolicies = async (root: Source, taskId: string) => {
    const rows = await d.db.aiTaskActionPolicy.findMany({ where: { scopeId: root.scopeId, taskId, operation: { in: requiredPolicies } }, take: 20 });
    const permissions = 'access' in root.context ? root.context.access.permissions : [];
    return requiredPolicies.every(operation => rows.some(row => row.operation === operation && row.scopeId === root.scopeId && row.taskId === taskId
      && Number.isInteger(row.revision) && row.revision > 0 && row.expiresAt instanceof Date && row.expiresAt > now()
      && Array.isArray(row.requiredPermissions) && row.requiredPermissions.includes('rental-os:order:create')
      && row.requiredPermissions.every(permission => typeof permission === 'string' && hasEffectivePermission(permissions, permission))));
  };
  const load = async (value: AiQuoteRequestReissueReferenceDraft, root: Source) => {
    const row = await d.db.operationLog.findUnique({ where: { id: operationId(root.context, value) } });
    if (!row) return null;
    const context = root.context;
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || row.id !== operationId(context, value)
      || row.action !== 'ai-native.quote.request.reissue' || row.tenantId !== context.scope.tenantId
      || row.workspaceId !== context.scope.workspaceId || row.userId !== context.actor.userId) throw denied();
    const proof = marker.safeParse(row.detail); if (!proof.success) throw unavailable();
    const saved = reference(proof.data.reference);
    if (requestFingerprint(saved) !== requestFingerprint(value) || proof.data.originalHash !== root.originalHash) throw denied();
    const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: proof.data.inputRef };
    const linked = await d.originals.readHistorical(original), task = await d.originals.readTaskReceipt(original.inputRef);
    if (linked.receipt.state === 'revoked' || linked.receipt.inputRef !== original.inputRef
      || linked.receipt.previousInputRef !== root.originalInput.inputRef || linked.receipt.requestKey !== `quote-reissue:${value.operationKey}`
      || linked.request.sceneCode !== 'quote_clarification' || requestFingerprint(linked.request.input.candidate) !== proof.data.candidateHash) throw denied();
    assertAiReadContextBinding(linked.context, root.context);
    return { row, proof: proof.data, original, task };
  };
  const observe = async (value: AiQuoteRequestReissueReferenceDraft) => {
    const root = await source(common(value), false), saved = await load(value, root);
    const base = { reference: value, scope: root.context.scope, retryable: false as const,
      quotation: 'not_attempted_by_request' as const, approval: 'not_granted' as const, order: 'not_created_by_request' as const };
    await source(common(value), false);
    return validateQuoteSelectionResponse('AiQuoteRequestReissueOperationDraft', !saved ? { ...base, status: 'not_observed' }
      : { ...base, status: 'linked_request_recorded', original: saved.original, task: saved.task,
        admission: saved.task.state === 'observed' && await currentPolicies(root, saved.task.taskId) ? 'current_policies_available' : 'unavailable' });
  };
  const prepare = async (value: unknown) => {
    const input = validateQuoteSelectionHttpRequest('AiQuoteRequestReissuePreparationInputDraft', value) as AiQuoteRequestReissuePreparationInputDraft;
    const root = await source(input, true), candidate = freezeOriginalInput(structuredClone(input.candidate ?? root.candidate));
    const result = await scenes.tools.quote.businessPreparation.reviewParameters(candidate, root.context);
    const closing = await source(input, true);
    if (closing.sourceHash !== root.sourceHash) throw conflict();
    if (!['rejected', 'expired', 'change_requested'].includes(root.reason ?? '')) throw unavailable();
    return validateQuoteSelectionResponse('AiQuoteRequestReissuePreparationDraft', { ...common(input), candidate, scope: root.context.scope,
      reason: root.reason, preparation: result.preparation, sourceHash: sourceHash(root, candidate), requestPersistence: 'not_attempted',
      quotation: 'not_attempted', approval: 'not_granted', order: 'not_created' });
  };
  const selectionKey = (value: AiQuoteRequestReissueReferenceDraft) => `linked-quote:${value.operationKey}`;
  const selectionPreparation = async (value: AiQuoteRequestReissueReferenceDraft) => {
    const root = await source(common(value), true), saved = await load(value, root);
    if (!saved || saved.task.state !== 'observed') throw unavailable();
    const task = saved.task, original = await facts.readQuoteReceipt(saved.original), publicQuote = original.result.quote;
    if (!publicQuote || original.result.status !== 'quoted' || original.result.quotePersistence !== 'saved') throw unavailable();
    const readCore = () => routes.withRead('quote_context', {}, async context => {
      assertAiReadContextBinding(context, root.context);
      if (context.scope.kind !== 'workspace') throw denied();
      const quote = await d.quoteFacts.findQuote(context.scope.tenantId, publicQuote.id);
      if (!quote || quote.id !== publicQuote.id || quote.tenantId !== context.scope.tenantId || quote.consumedAt || quote.consumedOrderId
        || Date.parse(quote.expiresAt) <= now().getTime() || quote.request.startAt !== publicQuote.period.startAt
        || quote.request.endAt !== publicQuote.period.endAt || quote.ruleVersion !== publicQuote.ruleVersion
        || quote.payableAmount !== publicQuote.payableAmount || quote.receivableAmount !== publicQuote.receivableAmount
        || quote.currency !== publicQuote.currency) throw unavailable();
      return freezeOriginalInput(structuredClone(quote));
    });
    const quote = await readCore(), body = quote.request;
    const customerName = quote.membershipSnapshot?.personalCustomerName;
    if (body.customerType !== 'personal' || !body.customerId || !customerName || body.deliveryAddressDraft
      || body.bookingIdentity?.enterpriseContractAndPayer === true || quote.membershipSnapshot?.personalCustomerId !== body.customerId) throw unavailable();
    const selected = parseQuoteSelection({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: saved.original.inputRef,
      taskId: task.taskId, runId: task.runId, selectionKey: selectionKey(value), expectedSelectionRevision: 0,
      order: { quoteId: quote.id, customerType: body.customerType, customerId: body.customerId, customerName,
        ...(body.bookingIdentity ? { bookingIdentity: body.bookingIdentity } : {}), fulfillmentMode: body.fulfillmentMode,
        fulfillmentLocationId: body.fulfillmentLocationId, ...(body.returnLocationId ? { returnLocationId: body.returnLocationId } : {}),
        startAt: body.startAt, endAt: body.endAt, lines: body.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity,
          ...(line.pricingGroupId ? { pricingGroupId: line.pricingGroupId } : {}), ...(line.note ? { note: line.note } : {}) })) } });
    const stockInput = { locationId: body.fulfillmentLocationId, startAt: body.startAt, endAt: body.endAt,
      lines: body.lines.map(line => { if (!line.itemGroupId) throw unavailable(); return { itemGroupId: line.itemGroupId, quantity: line.quantity }; }) };
    await routes.withRead('availability', stockInput, async context => {
      assertAiReadContextBinding(context, root.context);
      if (context.scope.kind !== 'workspace') throw denied();
      const stock = checkedAiAvailabilityResult(stockInput, await d.core.readAvailability(context.scope.tenantId, stockInput));
      if (!stock.available) throw conflict();
    });
    if (requestFingerprint(quote) !== requestFingerprint(await readCore()) || (await source(common(value), true)).sourceHash !== root.sourceHash) throw conflict();
    const reviewHash = requestFingerprint({ reference: value, original: saved.original, selection: selected, quote });
    return validateQuoteSelectionResponse('AiQuoteRequestReissueSelectionPreparationDraft', { reference: value, original: saved.original,
      scope: root.context.scope, selection: selected, material: approvedOrderReviewMaterial(selected.order, quote), reviewHash,
      quotation: 'original_saved_quote', selectionState: 'not_saved', approval: 'not_granted', order: 'not_created' });
  };
  return Object.freeze({
    readReissuePreparation: prepare,
    async reissueSelectedRequest(value: unknown, signal?: AbortSignal) {
      const input = validateQuoteSelectionHttpRequest('AiQuoteRequestReissueCreateDraft', value) as AiQuoteRequestReissueCreateDraft;
      const ref = reference({ ...common(input), operationKey: input.operationKey }), root = await source(common(input), true);
      const prior = await load(ref, root);
      if (prior) { if (prior.proof.commandHash !== requestFingerprint(input)) throw conflict(); return observe(ref); }
      const preview = await prepare({ ...common(input), candidate: input.candidate });
      if (preview.preparation.status !== 'ready' || preview.sourceHash !== input.sourceHash) throw conflict();
      if (signal?.aborted) throw denied();
      const context = root.context; if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw denied();
      const tenantId = context.scope.tenantId, workspaceId = context.scope.workspaceId, userId = context.actor.userId;
      const receipt = await scenes.requests.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: `quote-reissue:${input.operationKey}`,
        previousInputRef: root.originalInput.inputRef, sceneCode: 'quote_clarification', input: { candidate: input.candidate } }, true,
      async (tx, saved) => { await tx.operationLog.create({ data: { id: operationId(context, ref), tenantId,
        workspaceId, userId, action: 'ai-native.quote.request.reissue',
        detail: { kind: 'quote-linked-request-1', reference: JSON.parse(JSON.stringify(ref)), commandHash: requestFingerprint(input),
          originalHash: root.originalHash, candidateHash: requestFingerprint(input.candidate), inputRef: saved.inputRef } } }); });
      if (receipt.replayed) return observe(ref);
      const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: receipt.inputRef };
      try {
        await source(common(input), true); if (signal?.aborted) throw denied(); await scenes.requests.createTask(original);
        if (configuration.admission) {
          const credential = await d.credentials.current();
          await configuration.admission({ headers: { authorization: credential.authorization } }, original, signal);
        }
        return await observe(ref);
      } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
    },
    readReissueOperation: (value: unknown) => observe(reference(value)),
    readReissuedSelectionPreparation: (value: unknown) => selectionPreparation(reference(value)),
    async selectReissuedQuote(value: unknown, signal?: AbortSignal) {
      const input = validateQuoteSelectionHttpRequest('AiQuoteRequestReissueSelectDraft', value) as AiQuoteRequestReissueSelectDraft;
      const ref = reference({ ...common(input), operationKey: input.operationKey }), prepared = await selectionPreparation(ref);
      if (prepared.reviewHash !== input.reviewHash) throw conflict(); if (signal?.aborted) throw denied();
      const selected = await selections.select(prepared.selection);
      try { await source(common(ref), false); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return validateQuoteSelectionResponse('AiQuoteRequestReissueSelectionOperationDraft', { reference: ref, original: prepared.original,
        scope: prepared.scope, selection: { state: 'observed', receipt: selected.receipt, retryable: false }, approval: 'not_granted', order: 'not_created_by_selection' }, true);
    },
    async readReissuedSelectionOperation(value: unknown) {
      const ref = reference(value), root = await source(common(ref), false), saved = await load(ref, root);
      if (!saved || saved.task.state !== 'observed') throw unavailable();
      const task = saved.task, row = await d.db.aiTaskQuoteSelection.findFirst({ where: { scopeId: root.scopeId, taskId: task.taskId,
        runId: task.runId, originalRequestId: saved.original.inputRef, selectionKey: selectionKey(ref) }, select: { quoteId: true } });
      const result = row ? await selections.readOperationLocator({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: saved.original.inputRef,
        taskId: task.taskId, runId: task.runId, selectionKey: selectionKey(ref), expectedSelectionRevision: 0, quoteId: row.quoteId })
        : { state: 'not_observed' as const, retryable: false as const };
      await source(common(ref), false);
      return validateQuoteSelectionResponse('AiQuoteRequestReissueSelectionOperationDraft', { reference: ref, original: saved.original,
        scope: root.context.scope, selection: result, approval: 'not_granted', order: 'not_created_by_selection' });
    }
  });
}
