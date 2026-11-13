/** Bounded prior-turn references for the original model envelope. Reopens
 * current conversation/source/Task authority; reads no free model prose and
 * projects no customer names, addresses, answers or business payloads. This
 * reader neither persists a memory nor grants selection, approval or retry. */
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { AI_QUOTE_SELECTION_DRAFT_VERSION, type AiExecutionContext, type AiSceneRequestBody } from '@rental-os/shared';
import { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepository } from './ai-task.repository';
import type { AiConversationRepository } from './conversation.repository';
import type { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import type { PrismaQuoteSelectionRepository } from './task-request/prisma-quote-selection.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { originalRequestReferenceSchema, freezeOriginalInput } from './task-request/original-request.validation';
import { PrismaTaskInputRepository } from './task-input/prisma-task-input.repository';
import { PrismaTaskConfirmationHistoryReader } from './runner/prisma-task-confirmation-history.reader';
import { aiTaskHasUnresolvedEffects } from './task-unresolved-effects';
import { AI_RETENTION_POLICY, retentionDeadline } from './privacy/retention-policy';
import { requestFingerprint as hash } from '../rental-core/rental-idempotency.repository';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u), shortId = id.max(36);
const revision = z.number().int().min(1).max(4294967294), digest = z.string().regex(/^[a-f0-9]{64}$/u);
const time = z.string().max(40).datetime({ offset: true });
const scene = z.enum(['order_explanation', 'opening_diagnosis', 'quote_clarification']);
const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
const status = z.enum(['succeeded', 'partially_succeeded', 'failed', 'cancelled']);
const inputReference = z.object({ requestId: shortId, receiptId: shortId, runId: shortId,
  questionRevision: revision, contractCode: id, contractVersion: id, inputHash: digest, answerHash: digest,
  meaning: z.literal('recorded_answer_not_selection_or_approval') }).strict();
const selectionReference = z.object({ selectionId: shortId, runId: shortId, revision, quoteId: id,
  quoteHash: digest, inputHash: digest, expiresAt: time, state: z.enum(['recorded', 'superseded']),
  meaning: z.literal('historical_selection_not_new_approval') }).strict();
const confirmationReference = z.object({ stepId: shortId, runId: shortId, phaseId: shortId, receiptId: shortId,
  kind: z.enum(['confirmation', 'succeeded', 'failed']), contentHash: digest,
  proposalId: shortId.nullable(), proposalRevision: revision.nullable(), reviewedPayloadHash: digest.nullable(),
  decisionRef: shortId.nullable(), meaning: z.literal('original_phase_not_business_success_or_reusable_approval') }).strict();
const entrySchema = z.object({ turnId: shortId, admissionRevision: revision, capabilityCode: scene, capabilityVersion: id,
  original: originalRequestReferenceSchema, originalRevision: revision, originalHash: digest, createdAt: time,
  retainedUntil: time, description: z.string().min(1).max(600), trust: z.literal('untrusted_historical_context'),
  task: z.object({ taskId: shortId, originRunId: shortId, revision, status,
    outcome: z.literal('task_status_not_business_result'), unresolvedEffects: z.literal('none_observed'),
    pendingInputRequests: z.array(shortId).max(0), humanInputReceipts: z.array(inputReference).max(32),
    selections: z.array(selectionReference).max(8), confirmations: z.array(confirmationReference).max(16) }).strict().nullable(),
  creation: z.enum(['original_task', 'permanently_closed_without_task']) }).strict();
/** Optional addition to the existing envelope, not a new public endpoint. */
export const aiConversationHistoryContextSchema = z.object({ version: z.literal('ain-conversation-history-1'),
  conversationId: shortId, turnId: shortId, admissionRevision: revision, original: originalRequestReferenceSchema,
  capabilityCode: scene, capabilityVersion: id,
  scope: z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
  aclRevision: digest, policyVersion: z.literal(AI_RETENTION_POLICY.version), expiresAt: time,
  coverage: z.literal('all_preceding_turns_within_limit'), entries: z.array(entrySchema).max(8),
  trust: z.literal('untrusted_historical_context'), authority: z.literal('none_reauthorize_before_consumption'),
  contentHash: digest }).strict();
export type AiConversationHistoryContext = z.infer<typeof aiConversationHistoryContextSchema>;
export type AiConversationHistoryPurpose = 'generation' | 'observation';
export interface AiConversationContextDependencies {
  db: PrismaClient;
  conversations: Pick<AiConversationRepository, 'readContextHistory'>;
  originals: Pick<PrismaOriginalRequestRepository, 'readHistorical'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  /** Required only when an original quote-selection row actually exists. */
  selections?: Pick<PrismaQuoteSelectionRepository, 'read'>;
}
type Window = NonNullable<Awaited<ReturnType<AiConversationRepository['readContextHistory']>>>;
const unavailable = (reason = 'history_source_unavailable') => Object.assign(new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'), {
  reason, nextAction: 'narrow_goal_or_new_conversation' });
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const same = (left: unknown, right: unknown) => hash(left) === hash(right);
const referenceShape = (value: unknown) => originalRequestReferenceSchema.parse(structuredClone(value));
const sectionNames: Record<string, string> = { workspace_profile: '经营空间资料', accounts_roles: '账号与角色',
  fulfillment_network: '履约网络', business_rule: '营业规则', business_calendar: '营业日历', item_groups: '商品',
  pricing_groups_rates: '定价分组', price_version: '价格版本', membership_base: '会员方案' };
function description(request: AiSceneRequestBody) {
  if (request.sceneCode === 'order_explanation') return `此前核对原订单${{
    status: '状态', fees: '费用依据', payments: '支付记录', next_steps: '后续人工入口'
  }[request.input.question]}；历史说明不代表当前订单状态或操作资格。`;
  if (request.sceneCode === 'opening_diagnosis') {
    if (request.input.sections.some(key => !Object.hasOwn(sectionNames, key))) throw unavailable();
    return `此前核对开业分区：${request.input.sections.map(key => sectionNames[key]).join('、')}；原检查不代表已保存、发布或采用。`;
  }
  return '此前请求准备租赁报价；客户、商品、时间和地点仍须按原人类选择与当前 Core 依据核对，不能从历史摘要自动带入。';
}

export class AiConversationContextReader {
  private readonly inputs: ReturnType<typeof PrismaTaskInputRepository.receiptReader>;
  private readonly confirmations: PrismaTaskConfirmationHistoryReader;
  constructor(private readonly d: AiConversationContextDependencies, private readonly clock: () => Date = () => new Date()) {
    this.inputs = PrismaTaskInputRepository.receiptReader(d.db, d.tasks, clock);
    this.confirmations = new PrismaTaskConfirmationHistoryReader(d.db, d.tasks);
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
    return now;
  }
  private identity(context: AiExecutionContext, expected: AiExecutionContext) {
    if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || originalIdentityHash(context) !== originalIdentityHash(expected)) throw denied();
  }
  private retained(createdAt: string) {
    const deadline = retentionDeadline(new Date(time.parse(createdAt)), AI_RETENTION_POLICY.conversationDays);
    if (new Date(createdAt) > this.now() || deadline <= this.now()) throw unavailable('history_retention_expired');
    return deadline.toISOString();
  }
  private async task(window: Window, prior: Window['earlier'][number], expected: AiExecutionContext) {
    const original = prior.observation.original, locator = prior.observation.task;
    if (!locator) throw unavailable();
    const access = await this.d.tasks.resolveAccess(locator.taskId, 'read_step_terminal');
    if (access.bindingKey !== aiTaskAccessFromContext(expected, locator.taskId, this.now()).bindingKey
      || access.actorId !== window.session.ownerId || access.scope.workspaceId !== window.session.workspaceId
      || access.scope.tenantId !== window.session.tenantId) throw denied();
    const snapshot = () => this.d.db.$transaction(async tx => {
      const row = await tx.aiTask.findFirst({ where: access.where, select: { id: true, scopeId: true, status: true, revision: true,
        ownerId: true, ownerKind: true, audience: true, inputRef: true, sceneCode: true, sceneVersion: true } });
      if (!row || row.scopeId !== window.session.scopeId || row.id !== locator.taskId || row.ownerId !== window.session.ownerId
        || row.ownerKind !== 'USER' || row.audience !== 'OPERATOR' || row.inputRef !== original.inputRef
        || row.sceneCode !== prior.capabilityCode || row.sceneVersion !== prior.capabilityVersion
        || !terminal.some(value => value === row.status)) throw unavailable('history_task_not_terminal');
      if (await aiTaskHasUnresolvedEffects(tx, row.scopeId, row.id, window.session)) throw unavailable('history_has_unresolved_effects');
      const key = { scopeId: row.scopeId, taskId: row.id };
      const [questions, selections, steps] = await Promise.all([
        tx.aiTaskInputRequest.findMany({ where: key, select: { id: true, status: true, revision: true, runId: true,
          contractCode: true, contractVersion: true, inputHash: true, createdAt: true }, orderBy: { id: 'asc' }, take: 33 }),
        tx.aiTaskQuoteSelection.findMany({ where: { ...key, originalRequestId: original.inputRef },
          select: { id: true, createdAt: true }, orderBy: { id: 'asc' }, take: 9 }),
        tx.aiStep.findMany({ where: { ...key, toolCode: { in: ['rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit'] } },
          select: { id: true, runId: true }, orderBy: { id: 'asc' }, take: 9 })
      ]);
      if (questions.length > 32 || selections.length > 8 || steps.length > 8) throw unavailable('history_limit_exceeded');
      if (questions.some(question => question.status !== 'CONSUMED')) throw unavailable('history_has_pending_input');
      return { row, questions, selections, steps };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    const observed = await snapshot(), key = { scopeId: observed.row.scopeId, taskId: observed.row.id };
    const humanInputReceipts: z.infer<typeof inputReference>[] = [], selections: z.infer<typeof selectionReference>[] = [];
    const confirmations: z.infer<typeof confirmationReference>[] = [];
    let retainedUntil = Infinity;
    for (const question of observed.questions) {
      retainedUntil = Math.min(retainedUntil, Date.parse(this.retained(question.createdAt.toISOString())));
      const row = await this.d.db.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_requestId: { ...key, requestId: question.id } },
        select: { id: true, submissionKey: true, answerHash: true, createdAt: true } });
      if (!row) throw unavailable();
      const receipt = await this.inputs.readSubmissionReference({ taskId: key.taskId, requestId: question.id,
        expectedRevision: question.revision - 1, submissionKey: row.submissionKey });
      if (receipt.state !== 'observed' || receipt.taskId !== key.taskId || receipt.requestId !== question.id || receipt.receiptId !== row.id)
        throw unavailable();
      retainedUntil = Math.min(retainedUntil, Date.parse(this.retained(row.createdAt.toISOString())));
      humanInputReceipts.push(inputReference.parse({ requestId: question.id, receiptId: receipt.receiptId, runId: receipt.runId,
        questionRevision: question.revision - 1, contractCode: question.contractCode, contractVersion: question.contractVersion,
        inputHash: question.inputHash, answerHash: row.answerHash, meaning: 'recorded_answer_not_selection_or_approval' }));
    }
    for (const selected of observed.selections) {
      if (!this.d.selections) throw unavailable('history_selection_reader_unavailable');
      const receipt = await this.d.selections.read({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION,
        originalInputRef: original.inputRef, selectionId: selected.id });
      if (receipt.draftVersion !== AI_QUOTE_SELECTION_DRAFT_VERSION || receipt.originalInputRef !== original.inputRef
        || receipt.taskId !== key.taskId || receipt.selectionId !== selected.id
        || !['selected_not_approved', 'expired', 'superseded'].includes(receipt.state)
        || receipt.approval !== 'not_granted' || receipt.order !== 'not_created_by_selection') throw unavailable();
      retainedUntil = Math.min(retainedUntil, Date.parse(this.retained(selected.createdAt.toISOString())));
      selections.push(selectionReference.parse({ selectionId: receipt.selectionId, runId: receipt.runId, revision: receipt.revision,
        quoteId: receipt.quoteId, quoteHash: receipt.quoteHash, inputHash: receipt.inputHash, expiresAt: receipt.expiresAt,
        state: receipt.state === 'superseded' ? 'superseded' : 'recorded',
        meaning: 'historical_selection_not_new_approval' }));
    }
    for (const step of observed.steps) {
      const request = { taskId: key.taskId, runId: step.runId, stepId: step.id };
      const checked = await this.confirmations.read(request);
      if (!checked.phases.length) throw unavailable('history_confirmation_source_unavailable');
      if (checked.phases.some(phase => !phase.receiptId || phase.kind === null || phase.kind === 'unknown'))
        throw unavailable('history_has_unresolved_effects');
      const receipts = await this.d.db.aiTaskExecutionPhaseReceipt.findMany({ where: { ...key, runId: step.runId, stepId: step.id },
        select: { id: true, phaseId: true, kind: true, contentHash: true, proposalId: true, proposalRevision: true,
          reviewedPayloadHash: true, decisionRef: true, createdAt: true }, orderBy: { id: 'asc' }, take: 3 });
      if (receipts.length > 2 || receipts.length !== checked.phases.length) throw unavailable();
      for (const receipt of receipts) {
        if (!checked.phases.some(phase => phase.receiptId === receipt.id && phase.phaseId === receipt.phaseId && phase.kind === receipt.kind)) throw unavailable();
        retainedUntil = Math.min(retainedUntil, Date.parse(this.retained(receipt.createdAt.toISOString())));
        confirmations.push(confirmationReference.parse({ stepId: step.id, runId: step.runId, phaseId: receipt.phaseId,
          receiptId: receipt.id, kind: receipt.kind, contentHash: receipt.contentHash, proposalId: receipt.proposalId,
          proposalRevision: receipt.proposalRevision, reviewedPayloadHash: receipt.reviewedPayloadHash, decisionRef: receipt.decisionRef,
          meaning: 'original_phase_not_business_success_or_reusable_approval' }));
      }
      if (!same(checked, await this.confirmations.read(request))) throw unavailable('history_source_changed');
    }
    if (!isDeepStrictEqual(observed, await snapshot())) throw unavailable('history_source_changed');
    if ((await this.d.tasks.resolveAccess(locator.taskId, 'read_step_terminal')).bindingKey !== access.bindingKey) throw denied();
    const task = { taskId: observed.row.id, originRunId: locator.runId, revision: observed.row.revision,
      status: status.parse(observed.row.status.toLowerCase()), outcome: 'task_status_not_business_result' as const,
      unresolvedEffects: 'none_observed' as const, pendingInputRequests: [], humanInputReceipts, selections, confirmations };
    return { task, retainedUntil };
  }
  private async build(value: unknown, expected: AiExecutionContext, purpose: AiConversationHistoryPurpose) {
    const original = referenceShape(value), parent = await this.d.originals.readHistorical(original);
    this.identity(parent.context, expected);
    if (parent.receipt.state === 'revoked' || purpose === 'generation' && parent.receipt.state !== 'stored') throw denied();
    const window = await this.d.conversations.readContextHistory(original, 8);
    if (!window) return undefined;
    if (window.session.binding !== originalIdentityHash(expected) || window.target.capabilityCode !== parent.receipt.sceneCode
      || window.target.capabilityVersion !== parent.receipt.sceneVersion || window.target.observation.material !== 'retained'
      || purpose === 'generation' && (window.conversation.status !== 'active' || window.conversation.activeTurnId !== window.target.turnId)) throw denied();
    if (parent.context.scope.kind !== 'workspace') throw denied();
    let expires = Math.min(Date.parse(parent.receipt.expiresAt), Date.parse(this.retained(parent.receipt.createdAt)));
    const entries: AiConversationHistoryContext['entries'] = [];
    for (const prior of window.earlier) {
      if (prior.observation.material !== 'retained') throw unavailable('history_material_erased');
      const source = await this.d.originals.readHistorical(prior.original);
      this.identity(source.context, expected);
      if (source.receipt.state === 'revoked' || source.receipt.sceneCode !== parent.receipt.sceneCode
        || source.receipt.sceneVersion !== parent.receipt.sceneVersion || hash(source.request) !== prior.requestHash) throw denied();
      let retainedUntil = Date.parse(this.retained(source.receipt.createdAt));
      const closed = 'creation' in prior.observation && prior.observation.creation === 'permanently_closed';
      const observed = closed ? null : await this.task(window, prior, expected);
      if (closed && prior.observation.task !== null) throw unavailable();
      retainedUntil = Math.min(retainedUntil, observed?.retainedUntil ?? Infinity);
      expires = Math.min(expires, retainedUntil);
      entries.push(entrySchema.parse({ turnId: prior.turnId, admissionRevision: prior.admissionRevision,
        capabilityCode: prior.capabilityCode, capabilityVersion: prior.capabilityVersion, original: prior.original,
        originalRevision: source.receipt.revision, originalHash: source.receipt.contentHash, createdAt: source.receipt.createdAt,
        retainedUntil: new Date(retainedUntil).toISOString(), description: description(source.request), trust: 'untrusted_historical_context',
        task: observed?.task ?? null, creation: closed ? 'permanently_closed_without_task' : 'original_task' }));
    }
    const after = await this.d.conversations.readContextHistory(original, 8);
    if (!same(window, after)) throw unavailable('history_source_changed');
    // Later source reads may await another authority. Reopen the exact earlier
    // references before returning; a restored conversation alone cannot attest
    // unchanged original Tasks, answers, selections or unresolved-effect holds.
    for (const [index, prior] of window.earlier.entries()) {
      const entry = entries[index], source = await this.d.originals.readHistorical(prior.original);
      this.identity(source.context, expected);
      if (source.receipt.state === 'revoked' || source.receipt.contentHash !== entry.originalHash
        || source.receipt.revision !== entry.originalRevision || source.receipt.createdAt !== entry.createdAt
        || description(source.request) !== entry.description) throw unavailable('history_source_changed');
      if (entry.task && !same((await this.task(window, prior, expected)).task, entry.task)) throw unavailable('history_source_changed');
    }
    if (!same(window, await this.d.conversations.readContextHistory(original, 8))) throw unavailable('history_source_changed');
    const closing = await this.d.originals.readHistorical(original);
    this.identity(closing.context, expected);
    if (closing.receipt.state === 'revoked' || closing.receipt.contentHash !== parent.receipt.contentHash
      || closing.receipt.revision !== parent.receipt.revision || expires <= this.now().getTime()) throw unavailable('history_retention_expired');
    const packet = { version: 'ain-conversation-history-1' as const, conversationId: window.conversation.id,
      turnId: window.target.turnId, admissionRevision: window.target.admissionRevision, original,
      capabilityCode: parent.receipt.sceneCode, capabilityVersion: parent.receipt.sceneVersion, scope: parent.context.scope,
      aclRevision: originalIdentityHash(expected), policyVersion: AI_RETENTION_POLICY.version, expiresAt: new Date(expires).toISOString(),
      coverage: 'all_preceding_turns_within_limit' as const, entries, trust: 'untrusted_historical_context' as const,
      authority: 'none_reauthorize_before_consumption' as const };
    if (Buffer.byteLength(JSON.stringify(packet), 'utf8') > 16384) throw unavailable('history_limit_exceeded');
    return freezeOriginalInput(aiConversationHistoryContextSchema.parse({ ...packet, contentHash: hash(packet) }));
  }
  async collect(original: unknown, expected: AiExecutionContext) {
    const identity = structuredClone(expected), reference = referenceShape(original);
    const packet = await this.build(reference, identity, 'generation');
    if (!packet) return undefined;
    return this.revalidate(packet, reference, identity);
  }
  async revalidate(value: unknown, original: unknown, expected: AiExecutionContext,
    purpose: AiConversationHistoryPurpose = 'generation'): Promise<AiConversationHistoryContext> {
    if (!['generation', 'observation'].includes(purpose)) throw unavailable();
    const parsed = aiConversationHistoryContextSchema.safeParse(structuredClone(value));
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 16384) throw unavailable();
    const { contentHash, ...packet } = parsed.data;
    if (hash(packet) !== contentHash || !same(packet.original, referenceShape(original))) throw unavailable();
    const current = await this.build(original, structuredClone(expected), purpose);
    if (!current || !same(current, parsed.data)) throw unavailable('history_source_changed');
    return freezeOriginalInput(parsed.data);
  }
}
