/** Short original-order policies for an explicit decision, continuation or
 * reprepare. Reads never sign. The original wait, proposal, quote, approval,
 * runner and Core retain their deadlines, transactions and execution checks. */
import { hasEffectivePermission } from '../../common/permission-match';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION,
  AI_QUOTE_SELECTION_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION,
  type AiProposalPayloadDraft, type AiApprovalReprepareCommandDraft } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiTaskRepository, aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { fingerprintAiProposalDraft } from './proposal-binding-draft';
import { originalIdentityHash } from './task-request/original-request.authority';
import { originalRequestReferenceSchema } from './task-request/original-request.validation';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from './task-request/prisma-quote-selection.repository';
import { parseQuoteSelectionProof } from './task-request/quote-selection.validation';
import { PrismaApprovedOrderSnapshotSource } from './approval-execution/prisma-approved-order-snapshot.source';
import { AiApprovedOrderRouteAuthority } from './approval-execution/approved-order-route.authority';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { PrismaTaskApplication, waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { PrismaTaskConfirmationHistoryReader } from './runner/prisma-task-confirmation-history.reader';
import { waitingPayloadSchema } from './runner/prisma-task-confirmation-checkpoint.source';
import { taskExecutionPhaseStore } from './runner/task-execution-phase.store';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import type { AiTaskRunnerClock } from './runner/ai-task-runner.ports';
import { TaskApprovalAdmissionAuthority } from './task-approval-admission.authority';
import type { AiTaskActionPolicyOperation, AiTaskActionPolicyMutationResult } from './prisma-task-action-policy.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), shortId = id.max(36);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), revision = z.number().int().min(1).max(4294967294);
const time = z.string().datetime({ offset: true }), intent = z.enum(['explicit_decide', 'explicit_continue', 'explicit_reprepare']);
const decision = z.enum(['approve', 'reject']);
const reason = z.enum(['rejected', 'expired', 'change_plan']) satisfies z.ZodType<AiApprovalReprepareCommandDraft['reason']>;
const proposal = z.object({ contractVersion: z.literal(AI_PROPOSAL_DRAFT_VERSION), proposalId: shortId,
  proposalRevision: revision, reviewedPayloadHash: hash }).strict();
const selection = z.object({ draftVersion: z.literal(AI_QUOTE_SELECTION_DRAFT_VERSION), originalInputRef: shortId,
  selectionId: shortId, taskId: shortId, runId: shortId, inputHash: hash }).strict();
const targetQuery = z.object({ taskId: shortId, runId: shortId, stepId: shortId.optional(), proposal: proposal.optional() }).strict();
const boundTarget = z.object({ taskId: shortId, runId: shortId, stepId: shortId, scopeId: shortId, ownerId: id,
  sceneCode: z.literal('quote_clarification'), sceneVersion: id.max(64), inputRevision: revision, inputHash: hash,
  state: z.enum(['waiting_confirmation', 'recorded_rejection']),
  original: originalRequestReferenceSchema, selection, proposal, actionId: id, inputRef: shortId,
  fingerprint: hash, planHash: hash, inputPolicyRevision: revision, checkpointRef: shortId, expiresAt: time }).strict();
const decideOperations = ['read_metadata', 'read_step_terminal', 'decide_approval'] as const;
const continueOperations = ['read_metadata', 'read_step_terminal', 'claim_recovery_run', 'release_run', 'transition_task'] as const;
const reprepareOperations = ['read_metadata', 'reprepare_approval'] as const;
const rejectedReprepareOperations = ['read_metadata', 'read_step_terminal', 'read_events', 'reprepare_approval'] as const;
const allOperations = [...new Set([...decideOperations, ...continueOperations, ...rejectedReprepareOperations])] as AiTaskActionPolicyOperation[];
const operation = z.custom<AiTaskActionPolicyOperation>(value => typeof value === 'string' && allOperations.includes(value as AiTaskActionPolicyOperation));
const permissions = z.array(id).min(1).max(64).refine(value => new Set(value).size === value.length);
const action = z.object({ operation, mode: z.enum(['retain', 'configure']), expectedRevision: revision.nullable(),
  requiredPermissions: permissions, expiresAt: time }).strict();
const referenceSchema = z.object({ version: z.literal('task-approval-admission-1'), intent, target: boundTarget,
  decision: decision.optional(), reason: reason.optional(), operationKey: id.max(128).optional(), replacement: boundTarget.optional(),
  stageHash: hash, replacementStageHash: hash.optional(), publicationHash: hash, replacementPublicationHash: hash.optional(),
  actions: z.array(action).min(1).max(5), intentHash: hash }).strict();
export type TaskApprovalAdmissionReference = z.infer<typeof referenceSchema>;
export type TaskApprovalAdmissionIntent = z.infer<typeof intent>;
export interface TaskApprovalAdmissionDependencies extends HumanQuoteSelectionDependencies {
  /** Original factory's actual current order-scene switch; no default grant. */
  currentRuntimeEnabled(sceneCode: 'quote_clarification', sceneVersion: string): Promise<boolean>;
  runnerClock?: AiTaskRunnerClock;
  maximumAdmissionMs?: number;
}
export interface TaskApprovalAdmissionReceipt {
  phase: 'original_approval_policy_receipts'; reference: TaskApprovalAdmissionReference;
  entries: { operation: AiTaskActionPolicyOperation; state: 'recorded' | 'not_observed' | 'retained_policy';
    policy: AiTaskActionPolicyMutationResult | null; matchesPreparedContent: boolean }[];
  completeRecorded: boolean; admission: 'not_granted_by_receipt'; execution: 'not_started';
  businessApproval: 'not_granted'; automaticRetry: false; waitingBinding: 'not_attested_by_legacy_policy_receipt';
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const operationsFor = (value: TaskApprovalAdmissionIntent, state: z.infer<typeof boundTarget>['state']): readonly AiTaskActionPolicyOperation[] => value === 'explicit_decide'
  ? decideOperations : value === 'explicit_continue' ? continueOperations : state === 'recorded_rejection' ? rejectedReprepareOperations : reprepareOperations;
const snapshotHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value,
  (_key, entry) => typeof entry === 'bigint' ? { nativeBigInt: entry.toString() } : entry)));
// Run the existing readers against the exact locked native rows. This forwards
// transactions/delegates, never substitutes policies, facts or authorization.
function transactionDb(db: PrismaClient, tx?: Prisma.TransactionClient): PrismaClient {
  if (!tx) return db;
  return new Proxy(db, { get(target, name) {
    if (name === '$transaction') return <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => work(tx);
    const owner = name in tx ? tx : target, value = Reflect.get(owner, name);
    return typeof value === 'function' ? value.bind(owner) : value;
  } });
}

export function composeTaskApprovalAdmission(d: TaskApprovalAdmissionDependencies) {
  if (typeof d.db?.$transaction !== 'function' || typeof d.auth?.resolveAccessContext !== 'function'
    || typeof d.guard?.canActivate !== 'function' || typeof d.credentials?.current !== 'function'
    || typeof d.originals?.readHistorical !== 'function' || typeof d.originals?.readTaskLocator !== 'function'
    || typeof d.currentRuntimeEnabled !== 'function') throw unavailable();
  const clock = d.clock ?? (() => new Date()), maximumMs = d.maximumAdmissionMs ?? 120000;
  if (!Number.isSafeInteger(maximumMs) || maximumMs < 1 || maximumMs > 120000) throw unavailable();
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const read = <T>(work: () => Promise<T>, signal?: AbortSignal) => waitForTaskApplicationDependency(work, false, signal);
  const parseReference = (value: unknown) => {
    const parsed = referenceSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = parsed.data, { intentHash, ...body } = reference, target = reference.target;
    if (requestFingerprint(body) !== intentHash || target.taskId !== target.selection.taskId || target.runId !== target.selection.runId
      || target.original.inputRef !== target.selection.originalInputRef || target.fingerprint !== target.selection.inputHash
      || !isDeepStrictEqual([...operationsFor(reference.intent, target.state)].sort(), reference.actions.map(row => row.operation).sort())
      || reference.intent === 'explicit_reprepare' && (!reference.replacement || !reference.operationKey
        || !reference.reason || !reference.replacementStageHash || !reference.replacementPublicationHash || reference.decision !== undefined)
      || reference.intent !== 'explicit_reprepare' && (reference.replacement !== undefined || reference.operationKey !== undefined
        || reference.reason !== undefined || reference.replacementStageHash !== undefined || reference.replacementPublicationHash !== undefined)
      || reference.intent !== 'explicit_reprepare' && reference.decision === undefined) throw denied();
    return reference;
  };
  const metadata = async (taskId: string, tx?: Prisma.TransactionClient, signal?: AbortSignal) => {
    const identities = new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, clock), scopes = new AiScopeRepository(d.db, identities, clock);
    const first = await read(() => scopes.resolveCurrent(), signal), identity = originalIdentityHash(first.context);
    if (first.context.actor.kind !== 'user' || first.context.scope.kind !== 'workspace' || first.context.audience !== 'operator'
      || first.scope.kind !== 'WORKSPACE' || !('access' in first.context)) throw denied();
    const authorize = async (selectedTx = tx) => {
      if (signal?.aborted) throw denied();
      const current = await scopes.resolveCurrent();
      if (current.scope.id !== first.scope.id || originalIdentityHash(current.context) !== identity) throw denied();
      const access = aiTaskAccessFromContext(current.context, taskId, now()), db = selectedTx ?? d.db;
      const task = await db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: first.scope.id }] } });
      if (!task || task.id !== taskId || task.scopeId !== first.scope.id || task.scopeKind !== 'WORKSPACE'
        || task.ownerKind !== 'USER' || task.ownerId !== access.actorId || task.audience !== 'OPERATOR' || task.archivedAt !== null
        || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.sceneCode !== 'quote_clarification'
        || !shortId.safeParse(task.inputRef).success || !hash.safeParse(task.inputHash).success
        || !revision.safeParse(task.inputRevision).success || !revision.safeParse(task.revision).success) throw denied();
      const original = originalRequestReferenceSchema.parse({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef });
      const locator = await d.originals.readTaskLocator(original, selectedTx);
      if (locator.receipt.state === 'revoked' || locator.task.state !== 'observed' || locator.task.taskId !== task.id
        || locator.receipt.sceneCode !== task.sceneCode || locator.receipt.sceneVersion !== task.sceneVersion
        || locator.receipt.contentHash !== task.inputHash || locator.receipt.revision !== task.inputRevision
        || originalIdentityHash(locator.context) !== identity) throw denied();
      await new AiBusinessReadRouteAuthority(d.guard, d.credentials, clock).withRead('quote_context', {}, async guarded => {
        if (originalIdentityHash(guarded) !== identity) throw denied();
      });
      const after = await scopes.resolveCurrent();
      if (after.scope.id !== first.scope.id || originalIdentityHash(after.context) !== identity || signal?.aborted) throw denied();
      return { task, context: after.context, access, original };
    };
    const initial = await read(() => authorize(), signal), db = transactionDb(d.db, tx);
    const tasks = new AiTaskRepository(db, { resolve: async (selected, requested) => {
      if (selected !== taskId || !['read_metadata', 'read_step_terminal', 'read_events'].includes(requested)) throw denied();
      return (await authorize()).context;
    } }, clock);
    return { ...initial, authorize, tasks, db };
  };
  const stage = async (query: z.infer<typeof targetQuery>, mode: 'decide' | 'continue' | 'original_reprepare' | 'replacement',
    tx?: Prisma.TransactionClient, signal?: AbortSignal, reprepareReason?: z.infer<typeof reason>) => {
    const source = await metadata(query.taskId, tx, signal), { task, access, context, db } = source;
    if (!('access' in context) || !hasEffectivePermission(context.access.permissions, 'rental-os:order:create')) throw denied();
    const key = { scopeId: task.scopeId, taskId: task.id, runId: query.runId };
    const run = await db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
    const step = await db.aiStep.findFirst({ where: { ...key, toolCode: 'rental.order.commit', ...(query.stepId ? { id: query.stepId } : {}) } });
    const planRow = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    if (!run || run.scopeId !== key.scopeId || run.taskId !== key.taskId || run.id !== key.runId
      || run.actorKind !== access.actorKind || run.actorId !== access.actorId || !step || !planRow
      || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.toolCode !== 'rental.order.commit' || !revision.safeParse(run.revision).success || !revision.safeParse(step.revision).success
      || !step.actionId || !step.inputRef || !step.requestFingerprint || planRow.scopeId !== key.scopeId
      || planRow.taskId !== key.taskId || planRow.runId !== key.runId) throw denied();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(planRow.payload));
    if (plan.taskId !== task.id || plan.runId !== run.id || requestFingerprint(plan) !== planRow.planHash
      || requestFingerprint(planRow.payload) !== planRow.planHash || plan.steps.length !== 1
      || plan.steps[0].toolCode !== step.toolCode || plan.steps[0].toolVersion !== step.toolVersion
      || plan.steps[0].operation !== 'idempotent') throw denied();
    const input = await db.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef } });
    if (!input || input.scopeId !== key.scopeId || input.taskId !== key.taskId || input.runId !== key.runId
      || input.id !== step.inputRef || input.registrationRef !== plan.steps[0].registrationRef
      || input.toolCode !== step.toolCode || input.toolVersion !== step.toolVersion || input.fingerprint !== step.requestFingerprint
      || requestFingerprint(input.payload) !== input.fingerprint || !revision.safeParse(input.policyRevision).success
      || !(input.expiresAt instanceof Date) || !input.registrationRef.startsWith('quote-selection:')) throw denied();
    const selectionId = shortId.parse(input.registrationRef.slice('quote-selection:'.length));
    const proof = parseQuoteSelectionProof({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: source.original.inputRef,
      selectionId, taskId: task.id, runId: run.id, inputHash: input.fingerprint });
    const selections = new PrismaQuoteSelectionRepository({ ...d, db });
    const selected = await read(() => selections.read({ draftVersion: proof.draftVersion,
      originalInputRef: proof.originalInputRef, selectionId: proof.selectionId }), signal);
    if (selected.taskId !== task.id || selected.runId !== run.id || selected.inputHash !== input.fingerprint) throw denied();
    const phaseKey = { ...key, stepId: step.id }, store = taskExecutionPhaseStore(db as unknown as Prisma.TransactionClient);
    const starts = await store.readStarts(phaseKey), receipts = await store.readReceipts(phaseKey);
    // A unique original confirmation is positive no-submission evidence.
    // Absence, expired leases and missing Core rows alone are never that proof.
    if (starts.length !== 1 || receipts.length !== 1 || starts[0].sequence !== 1 || receipts[0].kind !== 'confirmation') throw unavailable();
    const start = starts[0], receipt = receipts[0], waiting = waitingPayloadSchema.parse(receipt.payload);
    const reference = proposal.parse(waiting.proposal);
    if (query.proposal && !isDeepStrictEqual(query.proposal, reference)) throw conflict();
    const artifact = await db.aiTaskResultArtifact.findFirst({ where: { ...phaseKey, id: start.originalArtifactId } });
    const expectedBinding = { ...phaseKey, actionId: step.actionId, inputRef: input.id, fingerprint: input.fingerprint };
    if (Object.entries(phaseKey).some(([field, value]) => start[field as keyof typeof start] !== value || receipt[field as keyof typeof receipt] !== value)
      || start.actionId !== step.actionId || start.inputRef !== input.id || start.stepFingerprint !== input.fingerprint
      || start.planHash !== planRow.planHash || receipt.phaseId !== start.id || receipt.createdAt < start.createdAt || receipt.createdAt > now()
      || !isDeepStrictEqual(waiting.binding, expectedBinding) || waiting.presentedLease.taskId !== task.id
      || waiting.presentedLease.runId !== run.id || waiting.presentedLease.holderId !== start.leaseOwnerId
      || waiting.presentedLease.fencingToken !== start.fencingToken || waiting.presentedLease.revision !== start.runRevision
      || receipt.proposalId !== reference.proposalId || receipt.proposalRevision !== reference.proposalRevision
      || receipt.reviewedPayloadHash !== reference.reviewedPayloadHash || requestFingerprint(receipt.payload) !== receipt.contentHash
      || BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8')) !== receipt.outputBytes || !artifact
      || artifact.id !== start.originalArtifactId || Object.entries(phaseKey).some(([field, value]) => artifact[field as keyof typeof artifact] !== value)
      || artifact.actionId !== step.actionId || artifact.stepFingerprint !== input.fingerprint || artifact.leaseOwnerId !== start.leaseOwnerId
      || artifact.fencingToken.toFixed(0) !== start.fencingToken || artifact.outcome !== 'RUNNING' || artifact.completeMeasurement
      || artifact.activeMs !== 0n || artifact.outputBytes !== 0n || artifact.contentHash !== requestFingerprint({})
      || requestFingerprint(artifact.payload) !== artifact.contentHash) throw denied();
    const head = await db.aiProposal.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: reference.proposalId } });
    const versionKey = { scopeId: task.scopeId, taskId: task.id, proposalId: reference.proposalId, revision: reference.proposalRevision };
    const version = await db.aiProposalVersion.findFirst({ where: versionKey });
    if (!head || head.scopeId !== key.scopeId || head.taskId !== task.id || head.id !== reference.proposalId || !version
      || Object.entries(versionKey).some(([field, value]) => version[field as keyof typeof version] !== value)
      || version.payloadHash !== reference.reviewedPayloadHash || fingerprintAiProposalDraft(version.payload) !== version.payloadHash
      || await db.aiProposalVersion.findFirst({ where: { ...versionKey, revision: { gt: reference.proposalRevision } } })) throw conflict();
    const payload = structuredClone(version.payload) as unknown as AiProposalPayloadDraft;
    if (payload.taskId !== task.id || payload.proposalId !== reference.proposalId || payload.revision !== reference.proposalRevision
      || payload.audience !== context.audience || requestFingerprint(payload.scope) !== requestFingerprint(context.scope)
      || payload.atomicity !== 'single_action' || payload.actions.length !== 1 || payload.actions[0].actionId !== step.actionId
      || payload.actions[0].toolCode !== step.toolCode || payload.actions[0].toolVersion !== step.toolVersion
      || payload.actions[0].input.contentHash !== input.fingerprint || !(version.expiresAt instanceof Date)
      || version.expiresAt.getTime() !== Date.parse(payload.expiresAt)) throw denied();
    const proposalActionKey = { scopeId: task.scopeId, taskId: task.id, proposalId: reference.proposalId,
      proposalRevision: reference.proposalRevision, actionId: step.actionId, requestFingerprint: input.fingerprint };
    const proposalAction = await db.aiProposalAction.findFirst({ where: proposalActionKey, include: { step: true } });
    if (!proposalAction || Object.entries(proposalActionKey).some(([field, value]) => proposalAction[field as keyof typeof proposalAction] !== value)
      || !proposalAction.step || proposalAction.step.id !== step.id || proposalAction.step.runId !== run.id
      || proposalAction.step.requestFingerprint !== input.fingerprint) throw denied();
    const snapshots = new PrismaApprovedOrderSnapshotSource(db, { authorizeRead: async (taskId, selectedTx) => {
      if (taskId !== task.id) throw denied();
      const current = await source.authorize(selectedTx);
      return { context: current.context, scopeId: current.task.scopeId };
    } });
    const facts = await snapshots.read({ scopeId: task.scopeId, taskId: task.id, context, proposalId: reference.proposalId,
      proposalRevision: reference.proposalRevision, action: payload.actions[0] }, tx);
    if (requestFingerprint(facts.input.payload) !== input.fingerprint || payload.actions[0].target.resourceType !== 'quote'
      || payload.actions[0].target.resourceId !== selected.quoteId || facts.input.payload.quoteId !== selected.quoteId
      || payload.actions[0].target.version !== facts.preview.payload.pricingPlanVersion) throw denied();
    if (context.scope.kind !== 'workspace') throw denied();
    const quoteTenantId = context.scope.tenantId;
    const currentQuote = await new AiApprovedOrderRouteAuthority(d.guard, d.credentials, clock).withOrderReview(context,
      facts.input.payload, () => d.quoteFacts.findQuote(quoteTenantId, facts.input.payload.quoteId, tx));
    if (!currentQuote || currentQuote.id !== selected.quoteId || currentQuote.tenantId !== context.scope.tenantId
      || currentQuote.consumedAt || currentQuote.consumedOrderId) throw unavailable();
    const approvalKey = { scopeId: task.scopeId, taskId: task.id, proposalId: reference.proposalId,
      proposalRevision: reference.proposalRevision, actorKind: 'USER' as const, actorId: access.actorId };
    const approval = await db.aiApproval.findFirst({ where: approvalKey });
    if (approval && (Object.entries(approvalKey).some(([field, value]) => approval[field as keyof typeof approval] !== value)
      || approval.payloadHash !== reference.reviewedPayloadHash || approval.audience !== task.audience
      || !['APPROVED', 'REJECTED'].includes(approval.decision) || !(approval.issuedAt instanceof Date) || approval.issuedAt > now()
      || !(approval.expiresAt instanceof Date) || approval.issuedAt >= approval.expiresAt
      || approval.expiresAt.getTime() !== version.expiresAt.getTime())) throw conflict();
    if (approval ? ![approval.decision === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED', 'EXPIRED'].includes(head.status)
      : !['PENDING_CONFIRMATION', 'EXPIRED'].includes(head.status)) throw conflict();
    const consumption = await db.aiApprovalConsumption.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, actionId: step.actionId } });
    if (context.scope.kind !== 'workspace') throw denied();
    const business = await db.rentalOrderIdempotencyRecord.findUnique({ where: { workspaceId_action_idempotencyKey: {
      workspaceId: context.scope.workspaceId, action: 'rental.order.create',
      idempotencyKey: `ai-order:${requestFingerprint([task.scopeId, task.id, step.actionId])}` } } });
    if (consumption || business) throw unavailable();
    const expiry = Math.min(version.expiresAt.getTime(), Date.parse(facts.preview.payload.expiresAt),
      Date.parse(selected.expiresAt), input.expiresAt.getTime());
    if (!Number.isFinite(expiry)) throw unavailable();
    let history: Awaited<ReturnType<PrismaTaskConfirmationHistoryReader['read']>> | null = null;
    if (mode === 'original_reprepare') {
      const decisionExpired = version.expiresAt <= now() || Date.parse(currentQuote.expiresAt) <= now().getTime() || head.status === 'EXPIRED';
      // Match the original eligibility's precedence. An approved but uncommitted
      // action remains reconciliation-only even after expiry. change_plan is an
      // explicit original command and still requires fresh different material.
      if (head.status === 'SUPERSEDED' || approval?.decision === 'APPROVED'
        || (reprepareReason === 'rejected' ? approval?.decision !== 'REJECTED'
          : reprepareReason === 'expired' ? !!approval || !decisionExpired
            : reprepareReason === 'change_plan' ? !!approval || decisionExpired || head.status !== 'PENDING_CONFIRMATION'
              : true)) throw unavailable();
      if (task.status === 'WAITING_CONFIRMATION') {
        if (task.cancelRequestedAt !== null || run.status !== 'RUNNING' || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE'
          || step.resultRef !== null || step.revision !== start.stepRevision) throw unavailable();
      } else {
        if (!['PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status) || approval?.decision !== 'REJECTED'
          || step.status !== 'FAILED' || step.effect !== 'NONE' || step.resultRef !== receipt.id
          || step.revision !== start.stepRevision + 1 || !['PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)) throw unavailable();
        history = await new PrismaTaskConfirmationHistoryReader(db, source.tasks).read({ taskId: task.id, runId: run.id, stepId: step.id });
        if (history.phases.length !== 1 || history.phases[0].kind !== 'confirmation' || history.phases[0].receiptId !== receipt.id
          || history.transitions.length !== 2 || history.transitions[0].kind !== 'paused' || history.transitions[1].kind !== 'continued') throw unavailable();
      }
    } else {
      if (expiry <= now().getTime() || input.expiresAt <= now() || task.cancelRequestedAt !== null
        || task.status !== 'WAITING_CONFIRMATION' || run.status !== 'RUNNING' || step.status !== 'RUNNING'
        || step.effect !== 'POSSIBLE' || step.resultRef !== null || step.revision !== start.stepRevision) throw unavailable();
      if (mode === 'continue') {
        if (!approval || !['CONFIRMED', 'CANCELLED'].includes(head.status) || head.currentRevision !== reference.proposalRevision
          || head.status !== (approval.decision === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED')) throw unavailable();
      } else if (approval || head.status !== 'PENDING_CONFIRMATION' || head.currentRevision !== null) throw unavailable();
      const current = await selections.readAuthorized(proof, tx);
      if (current.scopeId !== task.scopeId || current.taskId !== task.id || current.runId !== run.id
        || requestFingerprint(current.body) !== input.fingerprint || current.quoteHash !== selected.quoteHash) throw denied();
      const waitingRead = await PrismaTaskApplication.readConfirmation({ db, tasks: source.tasks, clock: d.runnerClock }, { taskId: task.id, runId: run.id, stepId: step.id });
      if (waitingRead.taskRevision !== task.revision || waitingRead.checkpointRef !== receipt.id
        || !isDeepStrictEqual(waitingRead.proposal, reference)) throw conflict();
    }
    if (!['PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'EXPIRED'].includes(head.status)
      || head.status === 'PENDING_CONFIRMATION' && head.currentRevision !== null
      || ['CONFIRMED', 'CANCELLED'].includes(head.status) && head.currentRevision !== reference.proposalRevision
      || head.status === 'EXPIRED' && head.currentRevision !== null && head.currentRevision !== reference.proposalRevision) throw conflict();
    const bound = boundTarget.parse({ taskId: task.id, runId: run.id, stepId: step.id, scopeId: task.scopeId, ownerId: task.ownerId,
      sceneCode: task.sceneCode, sceneVersion: task.sceneVersion, inputRevision: task.inputRevision, inputHash: task.inputHash,
      state: task.status === 'WAITING_CONFIRMATION' ? 'waiting_confirmation' : 'recorded_rejection',
      original: source.original, selection: proof, proposal: reference, actionId: step.actionId, inputRef: input.id,
      fingerprint: input.fingerprint, planHash: planRow.planHash, inputPolicyRevision: input.policyRevision,
      checkpointRef: receipt.id, expiresAt: new Date(expiry).toISOString() });
    await source.authorize(tx);
    return { task, context, bound, decision: approval ? approval.decision === 'APPROVED' ? 'approve' as const : 'reject' as const : undefined,
      stageHash: snapshotHash({ task, run, step, planRow, input, selected, head, version, proposalAction, starts, receipts, artifact, approval, currentQuote, history }) };
  };
  const publication = async (target: z.infer<typeof boundTarget>, tx?: Prisma.TransactionClient) => {
    if (await d.currentRuntimeEnabled('quote_clarification', target.sceneVersion) !== true) throw unavailable();
    const key = { scopeId: target.scopeId, sceneCode: target.sceneCode, sceneVersion: target.sceneVersion };
    const row = await (tx ?? d.db).aiTaskPlanPolicy.findFirst({ where: key });
    if (!row || Object.entries(key).some(([field, value]) => row[field as keyof typeof row] !== value)
      || !revision.safeParse(row.revision).success || row.revision !== target.inputPolicyRevision
      || row.enabled !== true || !(row.expiresAt instanceof Date) || row.expiresAt <= now()) throw unavailable();
    const tools = aiPersistedPlanToolsSchema.parse(structuredClone(row.allowedTools)), limits = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
    if (!tools.some(tool => tool.code === 'rental.order.commit' && tool.version === AI_TOOL_DRAFT_VERSION)
      || tools.some(tool => !['ai.model.text', 'rental.catalog.search', 'rental.availability.check', 'membership.customer.resolve', 'rental.order.commit'].includes(tool.code))
      || limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    return { hash: snapshotHash({ ...row, allowedTools: tools, limits }), expiresAt: row.expiresAt.getTime() };
  };
  const policyRows = async (reference: TaskApprovalAdmissionReference, tx?: Prisma.TransactionClient) => {
    const rows = await (tx ?? d.db).aiTaskActionPolicy.findMany({ where: { scopeId: reference.target.scopeId,
      taskId: reference.target.taskId, operation: { in: reference.actions.map(row => row.operation) } }, take: reference.actions.length + 1 });
    if (rows.length > reference.actions.length || new Set(rows.map(row => row.operation)).size !== rows.length) throw unavailable();
    for (const row of rows) if (row.scopeId !== reference.target.scopeId || row.taskId !== reference.target.taskId
      || !revision.safeParse(row.revision).success || !permissions.safeParse(row.requiredPermissions).success
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw unavailable();
    return rows;
  };
  const verify = async (value: TaskApprovalAdmissionReference, purpose: 'issue' | 'observe', tx?: Prisma.TransactionClient) => {
    const reference = parseReference(value), source = await metadata(reference.target.taskId, tx), current = await source.authorize(tx);
    const target = reference.target;
    if (current.task.scopeId !== target.scopeId || current.task.ownerId !== target.ownerId || current.task.sceneVersion !== target.sceneVersion
      || current.task.inputHash !== target.inputHash || current.task.inputRevision !== target.inputRevision || current.original.inputRef !== target.original.inputRef) throw denied();
    if (purpose === 'observe') return current.context;
    const original = await stage({ taskId: target.taskId, runId: target.runId, stepId: target.stepId, proposal: target.proposal },
      reference.intent === 'explicit_decide' ? 'decide' : reference.intent === 'explicit_continue' ? 'continue' : 'original_reprepare', tx, undefined, reference.reason);
    if (!isDeepStrictEqual(original.bound, target) || original.stageHash !== reference.stageHash
      || reference.intent === 'explicit_continue' && original.decision !== reference.decision) throw conflict();
    const published = await publication(target, tx);
    if (published.hash !== reference.publicationHash) throw conflict();
    let cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt, Date.parse(target.expiresAt));
    if (reference.replacement) {
      const r = reference.replacement;
      if (r.taskId === target.taskId || r.scopeId !== target.scopeId || r.ownerId !== target.ownerId || r.original.inputRef === target.original.inputRef
        || r.fingerprint === target.fingerprint || r.selection.selectionId === target.selection.selectionId) throw denied();
      const replacement = await stage({ taskId: r.taskId, runId: r.runId, stepId: r.stepId, proposal: r.proposal }, 'replacement', tx);
      const replacementPublished = await publication(r, tx);
      if (!isDeepStrictEqual(replacement.bound, r) || replacement.stageHash !== reference.replacementStageHash
        || replacementPublished.hash !== reference.replacementPublicationHash) throw conflict();
      cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt, replacementPublished.expiresAt, Date.parse(r.expiresAt));
    }
    const held = 'access' in current.context ? current.context.access.permissions : [], rows = await policyRows(reference, tx);
    for (const action of reference.actions) {
      if (!action.requiredPermissions.includes('rental-os:order:create') || action.requiredPermissions.some(value => !hasEffectivePermission(held, value))
        || Date.parse(action.expiresAt) <= now().getTime() || action.mode === 'configure' && Date.parse(action.expiresAt) > cutoff) throw denied();
      const row = rows.find(value => value.operation === action.operation);
      if (action.mode === 'retain') {
        if (!row || row.revision !== action.expectedRevision || row.expiresAt.toISOString() !== action.expiresAt
          || !isDeepStrictEqual([...row.requiredPermissions as string[]].sort(), [...action.requiredPermissions].sort())) throw conflict();
      } else if ((row?.revision ?? null) === action.expectedRevision) {
        const required = [...new Set(['rental-os:order:create', ...(row ? row.requiredPermissions as string[] : [])])].sort();
        if (!isDeepStrictEqual(required, [...action.requiredPermissions].sort())) throw denied();
      } else if (!row || row.revision !== (action.expectedRevision ?? 0) + 1 || row.expiresAt.toISOString() !== action.expiresAt
        || !isDeepStrictEqual([...row.requiredPermissions as string[]].sort(), [...action.requiredPermissions].sort())) throw conflict();
    }
    return current.context;
  };
  const readReceipt = async (value: unknown, signal?: AbortSignal): Promise<TaskApprovalAdmissionReceipt> => {
    const query = z.object({ reference: referenceSchema }).strict().parse(structuredClone(value)), reference = parseReference(query.reference);
    const reader = new TaskApprovalAdmissionAuthority(d, reference, 'observe', verify).reader(), entries: TaskApprovalAdmissionReceipt['entries'] = [];
    for (const row of reference.actions) {
      if (row.mode === 'retain') {
        const observed = await read(() => reader.read(reference.target.taskId, row.operation), signal), policy = observed.state === 'observed' ? observed.policy : null;
        entries.push({ operation: row.operation, state: policy ? 'retained_policy' : 'not_observed', policy,
          matchesPreparedContent: !!policy && policy.revision === row.expectedRevision && policy.expiresAt === row.expiresAt
            && isDeepStrictEqual([...policy.requiredPermissions].sort(), [...row.requiredPermissions].sort()) });
      } else {
        const observed = await read(() => reader.readMutation(reference.target.taskId, row.operation, row.expectedRevision), signal);
        entries.push({ operation: row.operation, state: observed.state, policy: observed.policy,
          matchesPreparedContent: !!observed.policy && observed.policy.expiresAt === row.expiresAt
            && isDeepStrictEqual([...observed.policy.requiredPermissions].sort(), [...row.requiredPermissions].sort()) });
      }
    }
    return { phase: 'original_approval_policy_receipts', reference, entries,
      completeRecorded: entries.every(row => row.state !== 'not_observed' && row.matchesPreparedContent), admission: 'not_granted_by_receipt',
      execution: 'not_started', businessApproval: 'not_granted', automaticRetry: false, waitingBinding: 'not_attested_by_legacy_policy_receipt' };
  };
  return Object.freeze({
    async prepare(value: unknown, signal?: AbortSignal) {
      // Private Root input. Run/step/proposal/material locators come from the
      // existing selection/confirmation readers, never extra front-end fields.
      const query = targetQuery.extend({ intent, decision: decision.optional(), reason: reason.optional(), operationKey: id.max(128).optional(), replacement: targetQuery.optional() }).strict();
      const parsed = query.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data;
      if (command.intent === 'explicit_decide' && command.decision === undefined
        || command.intent !== 'explicit_decide' && command.decision !== undefined
        || command.intent === 'explicit_reprepare' && (!command.replacement || !command.operationKey || !command.reason)
        || command.intent !== 'explicit_reprepare' && (command.replacement !== undefined || command.operationKey !== undefined || command.reason !== undefined)) throw denied();
      const selected = await stage({ taskId: command.taskId, runId: command.runId, stepId: command.stepId, proposal: command.proposal },
        command.intent === 'explicit_decide' ? 'decide' : command.intent === 'explicit_continue' ? 'continue' : 'original_reprepare', undefined, signal, command.reason);
      const published = await read(() => publication(selected.bound), signal);
      const replacement = command.replacement ? await stage(command.replacement, 'replacement', undefined, signal) : undefined;
      const replacementPublished = replacement ? await read(() => publication(replacement.bound), signal) : undefined;
      if (replacement && (replacement.bound.scopeId !== selected.bound.scopeId || replacement.bound.ownerId !== selected.bound.ownerId
        || replacement.bound.taskId === selected.bound.taskId || replacement.bound.original.inputRef === selected.bound.original.inputRef
        || replacement.bound.fingerprint === selected.bound.fingerprint || replacement.bound.selection.selectionId === selected.bound.selection.selectionId)) throw denied();
      const cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt,
        replacement ? replacementPublished!.expiresAt : Infinity, Date.parse((replacement ?? selected).bound.expiresAt));
      if (cutoff <= now().getTime()) throw unavailable();
      const held = 'access' in selected.context ? selected.context.access.permissions : [], actions: TaskApprovalAdmissionReference['actions'] = [];
      for (const selectedOperation of operationsFor(command.intent, selected.bound.state)) {
        const row = await d.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: {
          scopeId: selected.bound.scopeId, taskId: selected.bound.taskId, operation: selectedOperation } } });
        if (row && (row.scopeId !== selected.bound.scopeId || row.taskId !== selected.bound.taskId || row.operation !== selectedOperation
          || !revision.safeParse(row.revision).success || !permissions.safeParse(row.requiredPermissions).success
          || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()))) throw unavailable();
        const requiredPermissions = [...new Set(['rental-os:order:create', ...(row ? row.requiredPermissions as string[] : [])])];
        if (requiredPermissions.some(value => !hasEffectivePermission(held, value))) throw denied();
        const retain = !!row && row.expiresAt > now() && requiredPermissions.every(value => (row.requiredPermissions as string[]).includes(value));
        actions.push(action.parse({ operation: selectedOperation, mode: retain ? 'retain' : 'configure', expectedRevision: row?.revision ?? null,
          requiredPermissions, expiresAt: retain ? row!.expiresAt.toISOString() : new Date(cutoff).toISOString() }));
      }
      const body = { version: 'task-approval-admission-1' as const, intent: command.intent, target: selected.bound,
        ...(command.intent === 'explicit_decide' ? { decision: command.decision! } : command.intent === 'explicit_continue' ? { decision: selected.decision! } : {}),
        ...(replacement ? { reason: command.reason!, operationKey: command.operationKey!, replacement: replacement.bound, replacementStageHash: replacement.stageHash,
          replacementPublicationHash: replacementPublished!.hash } : {}), stageHash: selected.stageHash, publicationHash: published.hash, actions };
      const reference = parseReference({ ...body, intentHash: requestFingerprint(body) });
      await read(() => verify(reference, 'issue'), signal);
      return { phase: 'prepared' as const, reference, admission: actions.every(row => row.mode === 'retain')
        ? 'existing_policies_available' as const : 'explicit_approval_policy_issuance_required' as const,
      execution: 'not_started' as const, businessApproval: 'not_granted' as const };
    },
    async issue(value: unknown, signal?: AbortSignal) {
      const parsed = z.object({ reference: referenceSchema, intent }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const reference = parseReference(parsed.data.reference);
      if (reference.intent !== parsed.data.intent) throw denied();
      const previous = await readReceipt({ reference }, signal);
      if (previous.entries.some(row => row.state === 'recorded')) return { phase: 'original_receipts' as const, reference,
        receipt: previous, admission: 'not_granted_by_replay' as const, execution: 'not_started' as const, businessApproval: 'not_granted' as const };
      await read(() => verify(reference, 'issue'), signal);
      let active = !signal?.aborted, attempted = false;
      const close = () => { active = false; };
      signal?.addEventListener('abort', close, { once: true });
      const verifier: typeof verify = async (...args) => {
        if (!active) throw denied();
        const context = await verify(...args);
        if (!active) throw denied();
        return context;
      };
      const authority = new TaskApprovalAdmissionAuthority(d, reference, 'issue', verifier);
      try {
        for (const row of reference.actions) {
          if (row.mode === 'retain') continue;
          attempted = true;
          await waitForTaskApplicationDependency(() => authority.writer(row).put({ taskId: reference.target.taskId, operation: row.operation,
            requiredPermissions: row.requiredPermissions, expiresAt: new Date(row.expiresAt) }, row.expectedRevision, true), true, signal);
        }
        await read(() => verify(reference, 'issue'), signal);
        const receipt = await readReceipt({ reference }, signal);
        if (!receipt.completeRecorded) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return { phase: 'approval_policy_admission_recorded' as const, reference, receipt,
          admission: 'current_wait_publication_and_role_revalidated' as const, execution: 'not_started' as const, businessApproval: 'not_granted' as const };
      } catch (error) {
        if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw error;
      } finally {
        active = false;
        signal?.removeEventListener('abort', close);
      }
    }, readReceipt
  });
}
