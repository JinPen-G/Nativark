/** Human consumer of original order/settings approvals. Never prepares a
 * proposal, claims a lease, continues a runner or writes Rental Core. */
import { z } from 'zod';
import { AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION, AI_APPROVED_SETTINGS_DRAFT_VERSION,
  AI_PROPOSAL_DRAFT_VERSION, type AiTaskHumanReviewDraft, type AiTaskHumanDecisionReceiptDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { PrismaTaskApplication } from './runner/prisma-task-application';
import { composeApprovedOrderHumanApproval } from './approval-execution/approved-order-human.composition';
import type { ControlledApprovedOrderDependencies } from './approval-execution/controlled-approved-order.composition';
import { approvalApplicationContract } from './approval-execution/approval-application-contracts';
import { composeApprovedSettingsApplication } from './approval-execution/approved-settings-application.composition';
import type { ApprovedSettingsApplicationDependencies } from './approval-execution/approved-settings-task.authority';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { resolveTaskCenterBusinessTarget, readTaskCenterOrderSelection } from './task-center-business.reader';
import { validateQuoteSelectionResponse } from './task-request/quote-selection.validation';

const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const taskCenterReviewSchema = z.object({ taskId: id, runId: id, stepId: id }).strict();
export const taskCenterDecisionSchema = taskCenterReviewSchema.extend({ proposal: z.object({
  contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION), proposalId: id,
  proposalRevision: z.number().int().min(1).max(4294967294),
  reviewedPayloadHash: z.string().regex(/^[a-f0-9]{64}$/u), decision: z.enum(['approve', 'reject']),
  reviewVersion: z.literal(AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION).optional()
}).strict() }).strict();
export interface TaskCenterApprovalDependencies {
  order: Omit<ControlledApprovedOrderDependencies, 'credentials'>;
  settings: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>;
  decisions: { order: boolean; settings: boolean };
  /** The original selected-quote decision host owns its explicit admission.
   * The task center derives this selection from the owned native step. */
  selectedOrderDecision?: {
    decideSelectedProposal(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown>;
    prepareTaskCenterApproval?(request: { headers: { authorization?: unknown } }, value: unknown,
      intent: 'explicit_decide' | 'explicit_continue', signal?: AbortSignal): Promise<void>;
  };
  settingsAdmission?: {
    prepareTaskCenterApproval?(request: { headers: { authorization?: unknown } }, value: unknown,
      intent: 'explicit_decide' | 'explicit_continue', signal?: AbortSignal): Promise<void>;
  };
}
/** Only explicit decisions/continuations enter domain admission. Each original
 * host selects its own currently owned step before its full policy authority. */
export async function prepareTaskCenterApprovalPolicies(d: TaskCenterApprovalDependencies, credentials: AiTaskCredentialSource,
  value: unknown, intent: 'explicit_decide' | 'explicit_continue', signal?: AbortSignal): Promise<void> {
  const order = d.decisions.order ? d.selectedOrderDecision?.prepareTaskCenterApproval?.bind(d.selectedOrderDecision) : undefined;
  const settings = d.decisions.settings ? d.settingsAdmission?.prepareTaskCenterApproval?.bind(d.settingsAdmission) : undefined;
  if (!order && !settings) return;
  const current = await credentials.current(), request = { headers: { authorization: current.authorization } };
  if (order) await order(request, value, intent, signal);
  if (settings) await settings(request, value, intent, signal);
}
export function composeTaskCenterApproval(d: TaskCenterApprovalDependencies, credentials: AiTaskCredentialSource,
  tasks: Pick<AiTaskRepository, 'resolveAccess'>) {
  if (d.order.db !== d.settings.db) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const db = d.order.db;
  // Do not construct the other domain's dependencies for an unrelated step.
  const order = () => composeApprovedOrderHumanApproval({ ...d.order, credentials });
  const settings = () => composeApprovedSettingsApplication({ ...d.settings, credentials });
  const ownedStep = async (query: z.infer<typeof taskCenterReviewSchema>) => {
    const access = structuredClone(await tasks.resolveAccess(query.taskId, 'read_step_terminal'));
    const task = structuredClone(await db.aiTask.findFirst({ where: access.where, select: {
      id: true, scopeId: true, revision: true, status: true, cancelRequestedAt: true
    } }));
    if (!task) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const key = { scopeId: task.scopeId, taskId: query.taskId, runId: query.runId, id: query.stepId };
    const step = structuredClone(await db.aiStep.findFirst({ where: key, select: {
      id: true, scopeId: true, taskId: true, runId: true, actionId: true, toolCode: true,
      toolVersion: true, revision: true, status: true, inputRef: true, requestFingerprint: true, effect: true
    } }));
    const run = structuredClone(await db.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: query.taskId, id: query.runId },
      select: { id: true, taskId: true, scopeId: true, actorId: true, actorKind: true } }));
    if (!step || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v)
      || !run || run.scopeId !== task.scopeId || run.taskId !== query.taskId || run.id !== query.runId
      || run.actorId !== access.actorId || run.actorKind !== access.actorKind
      || !['rental.order.commit', 'tenant.notifications.commit'].includes(step.toolCode))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return { access, task, step, kind: step.toolCode === 'rental.order.commit' ? 'order' as const : 'settings' as const };
  };
  const recheck = async (query: z.infer<typeof taskCenterReviewSchema>, before: Awaited<ReturnType<typeof ownedStep>>) => {
    const after = await ownedStep(query);
    if (before.access.bindingKey !== after.access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (requestFingerprint({ task: before.task, step: before.step }) !== requestFingerprint({ task: after.task, step: after.step }))
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  };
  const checkpoint = (query: z.infer<typeof taskCenterReviewSchema>) =>
    PrismaTaskApplication.readConfirmation({ db, tasks, clock: d.order.runnerClock }, query);
  const settingsReference = (taskId: string, reference: z.infer<typeof taskCenterDecisionSchema>['proposal']) => ({
    draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId, proposalId: reference.proposalId,
    proposalRevision: reference.proposalRevision, reviewedPayloadHash: reference.reviewedPayloadHash
  });
  const decideOrder = async (query: z.infer<typeof taskCenterReviewSchema>, proposal: z.infer<typeof taskCenterDecisionSchema>['proposal']) => {
    if (!d.selectedOrderDecision) return order().decide(query.taskId, proposal);
    const target = await resolveTaskCenterBusinessTarget({ db }, tasks, query);
    // Older published action-input plans retain their existing authority. A
    // selected-quote failure cannot fall back to that different provenance.
    if (target.task.inputRef === null) return order().decide(query.taskId, proposal);
    const selected = await readTaskCenterOrderSelection(db, target);
    await selected.verify();
    const current = await credentials.current();
    const result = await d.selectedOrderDecision.decideSelectedProposal({ headers: { authorization: current.authorization } },
      { selection: selected.selection, proposal });
    const approval = validateQuoteSelectionResponse('AiHumanQuoteOrderDecisionResponseDraft', result, true).approval;
    if (approval.proposalId !== proposal.proposalId || approval.proposalRevision !== proposal.proposalRevision
      || approval.payloadHash !== proposal.reviewedPayloadHash || approval.decision !== (proposal.decision === 'approve' ? 'approved' : 'rejected'))
      throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
    return approval;
  };
  const read = async (value: unknown): Promise<AiTaskHumanReviewDraft> => {
    const query = taskCenterReviewSchema.parse(structuredClone(value)), before = await ownedStep(query);
    const wait = await checkpoint(query);
    if (before.kind === 'order') {
      const { proposal, deterministic, generatedText } = await order().readProposal(query.taskId, wait.proposal);
      const review = approvalApplicationContract('AiApprovalApplicationReviewDraft', {
        draftVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION, proposal, deterministic, generatedText
      }, true);
      await recheck(query, before);
      return { ...query, taskRevision: wait.taskRevision, checkpointRef: wait.checkpointRef,
        kind: 'order', review, businessExecution: 'not_attested' };
    }
    const review = await settings().readProposal(settingsReference(query.taskId, { ...wait.proposal, decision: 'approve' }));
    await recheck(query, before);
    return { ...query, taskRevision: wait.taskRevision, checkpointRef: wait.checkpointRef,
      kind: 'settings', review, businessExecution: 'not_attested' };
  };
  const act = async (value: unknown, write: boolean, signal?: AbortSignal): Promise<AiTaskHumanDecisionReceiptDraft> => {
    const command = taskCenterDecisionSchema.parse(structuredClone(value)), { proposal, ...query } = command;
    // The explicit decision owns admission. Pure review/receipt reads never
    // enter this bridge, and the normal policy checks remain after it.
    if (write) await prepareTaskCenterApprovalPolicies(d, credentials, command, 'explicit_decide', signal);
    const before = await ownedStep(query);
    const { decision, reviewVersion, ...reference } = proposal;
    if (write) {
      if (before.kind === 'order' && decision === 'approve' && reviewVersion !== AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION)
        throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (!d.decisions[before.kind]) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const wait = await checkpoint(query);
      if (requestFingerprint(wait.proposal) !== requestFingerprint(reference)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      if (before.kind === 'order') {
        const original = await order().readProposal(query.taskId, reference);
        // Match the existing selected-quote consumer: no independent enterprise
        // payer/qualification authority is available to this human host.
        if (original.facts.input.payload.bookingIdentity?.enterpriseContractAndPayer === true)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
    }
    // Receipt reads do not require the old wait, an unexpired decision or the
    // server's new-decision gate. They still bind this exact owned step/action.
    const version = structuredClone(await db.aiProposalVersion.findFirst({ where: {
      scopeId: before.task.scopeId, taskId: query.taskId, proposalId: reference.proposalId, revision: reference.proposalRevision
    } }));
    const payload = version?.payload;
    const action = z.object({ actions: z.tuple([z.object({ actionId: z.string(), toolCode: z.string() }).passthrough()]) }).passthrough().safeParse(payload);
    if (!version || version.scopeId !== before.task.scopeId || version.taskId !== query.taskId
      || version.proposalId !== reference.proposalId || version.revision !== reference.proposalRevision
      || version.payloadHash !== reference.reviewedPayloadHash || requestFingerprint(payload) !== reference.reviewedPayloadHash
      || !action.success || action.data.actions[0].actionId !== before.step.actionId
      || action.data.actions[0].toolCode !== before.step.toolCode) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    await recheck(query, before);
    const receipt = before.kind === 'order'
      ? write ? { kind: 'recorded' as const, record: await decideOrder(query, proposal) }
        : await order().readReceipt(query.taskId, proposal)
      : await (async () => {
        const ref = settingsReference(query.taskId, proposal);
        const result = write ? await settings().decide({ ...ref, decision }) : await settings().readDecisionReceipt(ref);
        if (result.state !== 'recorded') return { kind: 'unknown' as const, retryable: false as const, nextAction: 'read_decision_receipt' as const };
        if (result.approval.decision !== (decision === 'approve' ? 'approved' : 'rejected'))
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return { kind: 'recorded' as const, record: result.approval };
      })();
    try { await recheck(query, before); }
    catch (error) {
      if (!write || error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
      throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false, nextAction: 'read_decision_receipt' });
    }
    return { ...query, receipt: approvalApplicationContract('AiApprovalApplicationReceiptDraft', receipt, true), businessExecution: 'not_attested' };
  };
  return Object.freeze({ review: read, decision: (value: unknown, signal?: AbortSignal) => act(value, true, signal),
    decisionReceipt: (value: unknown) => act(value, false) });
}
