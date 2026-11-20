/** Bind existing human quote commands to the original approval-policy CAS.
 * Locators come from the existing selection, checkpoint and replacement
 * contracts. This prepares no proposal, grants no approval and executes no Run. */
import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import type { AiHumanQuoteOrderDecisionRequestDraft, AiHumanQuoteOrderReprepareRequestDraft,
  AiSelectedQuoteTaskContinueRequestDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from './ai-task.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from './runner/ai-task-runner.service';
import { composeTaskApprovalAdmission, type TaskApprovalAdmissionIntent, type TaskApprovalAdmissionReference } from './task-approval-admission.application';
import type { HumanQuoteSelectionDependencies } from './task-request/prisma-quote-selection.repository';
import { validateQuoteSelectionHttpRequest } from './task-request/quote-selection.validation';
import { taskCenterDecisionSchema } from './task-center-approval.composition';
import { taskCenterContinueSchema } from './task-center-continuation.composition';

export interface OriginalQuoteApprovalAdmissionConfiguration {
  db: PrismaClient;
  currentRuntimeEnabled(sceneCode: 'quote_clarification', sceneVersion: string): Promise<boolean>;
}

export type TaskCenterQuoteApprovalIntent = 'explicit_decide' | 'explicit_continue';

async function admit(dependencies: HumanQuoteSelectionDependencies, query: unknown, intent: TaskApprovalAdmissionIntent,
  configuration: OriginalQuoteApprovalAdmissionConfiguration,
  verify: (reference: TaskApprovalAdmissionReference) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!Object.is(dependencies.db, configuration.db) || typeof configuration.currentRuntimeEnabled !== 'function'
    || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  let issuanceAttempted = false;
  try {
    await callAiTaskRunnerDependency(async () => {
      const admission = composeTaskApprovalAdmission({ ...dependencies,
        currentRuntimeEnabled: configuration.currentRuntimeEnabled });
      const prepared = await admission.prepare(query, signal);
      await verify(prepared.reference);
      if (prepared.admission !== 'existing_policies_available') {
        issuanceAttempted = true;
        const issued = await admission.issue({ reference: prepared.reference, intent }, signal);
        if (issued.phase !== 'approval_policy_admission_recorded'
          || issued.admission !== 'current_wait_publication_and_role_revalidated') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      if (signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    }, 15000, 'original_quote_approval_admission', signal);
  } catch (error) {
    if (issuanceAttempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN'))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    throw error;
  }
}

export async function prepareOriginalQuoteApprovalAdmission(dependencies: HumanQuoteSelectionDependencies,
  value: unknown, intent: TaskApprovalAdmissionIntent, configuration: OriginalQuoteApprovalAdmissionConfiguration,
  signal?: AbortSignal): Promise<void> {
  if (!Object.is(dependencies.db, configuration.db) || typeof configuration.currentRuntimeEnabled !== 'function'
    || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const decision = intent === 'explicit_decide'
    ? validateQuoteSelectionHttpRequest('AiHumanQuoteOrderDecisionRequestDraft', value) as AiHumanQuoteOrderDecisionRequestDraft : undefined;
  const continuation = intent === 'explicit_continue'
    ? validateQuoteSelectionHttpRequest('AiSelectedQuoteTaskContinueRequestDraft', value) as AiSelectedQuoteTaskContinueRequestDraft : undefined;
  const reprepare = intent === 'explicit_reprepare'
    ? validateQuoteSelectionHttpRequest('AiHumanQuoteOrderReprepareRequestDraft', value) as AiHumanQuoteOrderReprepareRequestDraft : undefined;
  const selection = (decision ?? continuation ?? reprepare)?.selection;
  if (!selection) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  if (reprepare && reprepare.command.originalTaskId !== selection.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const expectedProposal = decision ? { contractVersion: decision.proposal.contractVersion,
    proposalId: decision.proposal.proposalId, proposalRevision: decision.proposal.proposalRevision,
    reviewedPayloadHash: decision.proposal.reviewedPayloadHash } : reprepare?.command.original;
  const query = { intent, taskId: selection.taskId, runId: selection.runId,
    ...(expectedProposal ? { proposal: expectedProposal } : {}),
    ...(decision ? { decision: decision.proposal.decision } : {}),
    ...(reprepare ? { operationKey: reprepare.command.operationKey, reason: reprepare.command.reason,
      replacement: { taskId: reprepare.command.replacement.taskId, runId: reprepare.command.replacement.runId,
        stepId: reprepare.command.replacement.stepId } } : {}) };
  await admit(dependencies, query, intent, configuration, reference => {
    const target = reference.target;
    if (!isDeepStrictEqual(target.selection, selection)
      || expectedProposal && !isDeepStrictEqual(target.proposal, expectedProposal)
      || continuation && target.checkpointRef !== continuation.checkpointRef) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    if (reprepare) {
      const replacement = reference.replacement;
      if (reference.reason !== reprepare.command.reason || reference.operationKey !== reprepare.command.operationKey
        || !replacement || !isDeepStrictEqual(reprepare.command.replacement, {
        taskId: replacement.taskId, runId: replacement.runId, stepId: replacement.stepId,
        actionId: replacement.actionId, inputRef: replacement.inputRef, fingerprint: replacement.fingerprint,
        originalInputRef: replacement.original.inputRef, quoteSelectionRef: replacement.selection.selectionId,
        planHash: replacement.planHash })) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
  }, signal);
}

/** An explicit task-center command may arrive after its short read policies
 * expire. Select the existing owned domain using current identity, then let
 * the full original-wait authority prove every reference before policy CAS.
 * Other domains and old published plans keep their own existing authority. */
export async function prepareTaskCenterQuoteApprovalAdmission(dependencies: HumanQuoteSelectionDependencies,
  value: unknown, intent: TaskCenterQuoteApprovalIntent, configuration: OriginalQuoteApprovalAdmissionConfiguration,
  signal?: AbortSignal): Promise<void> {
  if (!['explicit_decide', 'explicit_continue'].includes(intent) || !Object.is(dependencies.db, configuration.db))
    throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const decision = intent === 'explicit_decide' ? taskCenterDecisionSchema.parse(structuredClone(value)) : undefined;
  const continuation = intent === 'explicit_continue' ? taskCenterContinueSchema.parse(structuredClone(value)) : undefined;
  const command = decision ?? continuation!;
  const clock = dependencies.clock ?? (() => new Date());
  const context = await new AiTaskCurrentIdentityAuthority(dependencies.auth, dependencies.credentials, clock).resolve();
  if (context.actor.kind !== 'user' || context.audience !== 'operator' || context.scope.kind !== 'workspace')
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const access = aiTaskAccessFromContext(context, command.taskId, clock());
  const readTask = () => dependencies.db.aiTask.findFirst({ where: access.where,
    select: { id: true, scopeId: true, inputRef: true, sceneCode: true, revision: true } });
  const task = await readTask();
  if (!task || task.id !== command.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const step = await dependencies.db.aiStep.findFirst({ where: { scopeId: task.scopeId,
    taskId: command.taskId, runId: command.runId, id: command.stepId } });
  if (!step || step.id !== command.stepId || step.taskId !== task.id || step.scopeId !== task.scopeId
    || step.runId !== command.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  if (step.toolCode !== 'rental.order.commit' || task.inputRef === null) return;
  if (task.sceneCode !== 'quote_clarification') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (continuation && task.revision !== continuation.expectedTaskRevision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  const expectedProposal = { contractVersion: command.proposal.contractVersion, proposalId: command.proposal.proposalId,
    proposalRevision: command.proposal.proposalRevision, reviewedPayloadHash: command.proposal.reviewedPayloadHash };
  await admit(dependencies, { intent, taskId: command.taskId, runId: command.runId, stepId: command.stepId,
    proposal: expectedProposal, ...(decision ? { decision: decision.proposal.decision } : {}) }, intent, configuration, async reference => {
    if (reference.target.taskId !== command.taskId || reference.target.runId !== command.runId
      || reference.target.stepId !== command.stepId || reference.target.original.inputRef !== task.inputRef
      || !isDeepStrictEqual(reference.target.proposal, expectedProposal)
      || continuation && reference.target.checkpointRef !== continuation.checkpointRef)
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const latest = await readTask();
    if (!latest || !isDeepStrictEqual(latest, task)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }, signal);
}
