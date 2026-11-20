/** Existing settings commands enter explicit admission before their expired
 * read policies can block original-host construction. This never prepares a
 * change, decides an approval, claims a Run or writes business settings. */
import { isDeepStrictEqual } from 'node:util';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE } from '@rental-os/shared';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '../runner/ai-task-runner.service';
import { taskCenterDecisionSchema } from '../task-center-approval.composition';
import { taskCenterContinueSchema } from '../task-center-continuation.composition';
import { settingsContract } from './approved-settings-contracts';
import type { ApprovedSettingsApplicationDependencies } from './approved-settings-task.authority';
import { composeSettingsApprovalAdmission, type SettingsApprovalAdmissionIntent,
  type SettingsApprovalAdmissionReference } from './settings-approval-admission.application';

export interface OriginalSettingsApprovalAdmissionConfiguration {
  db: ApprovedSettingsApplicationDependencies['db'];
  currentRuntimeEnabled(sceneCode: string, sceneVersion: string): Promise<boolean>;
}

async function admit(dependencies: ApprovedSettingsApplicationDependencies, query: unknown, intent: SettingsApprovalAdmissionIntent,
  configuration: OriginalSettingsApprovalAdmissionConfiguration,
  verify: (reference: SettingsApprovalAdmissionReference) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!Object.is(dependencies.db, configuration.db) || typeof configuration.currentRuntimeEnabled !== 'function'
    || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  let attempted = false;
  try {
    await callAiTaskRunnerDependency(async () => {
      const application = composeSettingsApprovalAdmission({ ...dependencies,
        currentRuntimeEnabled: configuration.currentRuntimeEnabled });
      const prepared = await application.prepare(query, signal);
      await verify(prepared.reference);
      if (prepared.admission !== 'existing_policies_available') {
        attempted = true;
        const issued = await application.issue({ reference: prepared.reference, intent }, signal);
        if (issued.phase !== 'settings_policy_admission_recorded'
          || issued.admission !== 'current_wait_settings_category_publication_and_role_revalidated')
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      if (signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    }, 15000, 'original_settings_approval_admission', signal);
  } catch (error) {
    if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    if (error instanceof AiTaskRunnerError && ['AI_RUN_LIMIT', 'AI_RESULT_UNKNOWN'].includes(error.code))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    throw error;
  }
}

export async function prepareOriginalSettingsApprovalAdmission(dependencies: ApprovedSettingsApplicationDependencies,
  value: unknown, intent: SettingsApprovalAdmissionIntent, configuration: OriginalSettingsApprovalAdmissionConfiguration,
  signal?: AbortSignal): Promise<void> {
  if (intent === 'explicit_decide') {
    const { decision, ...proposal } = settingsContract('AiApprovedSettingsDecisionDraft', value);
    await admit(dependencies, { intent, taskId: proposal.taskId, proposal, decision }, intent, configuration, reference => {
      if (!isDeepStrictEqual(reference.target.proposal, proposal) || reference.decision !== decision)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }, signal);
    return;
  }
  if (intent !== 'explicit_continue') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const command = settingsContract('AiApprovedSettingsTaskContinueDraft', value);
  await admit(dependencies, { intent, taskId: command.taskId, runId: command.runId }, intent, configuration, reference => {
    if (reference.target.taskId !== command.taskId || reference.target.runId !== command.runId
      || reference.target.checkpointRef !== command.checkpointRef) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }, signal);
}

/** Only the explicit task-center write path calls this selector. Current
 * identity selects an owned native step; the original settings authority then
 * proves its change, category, wait and permissions before any policy write. */
export async function prepareTaskCenterSettingsApprovalAdmission(dependencies: ApprovedSettingsApplicationDependencies,
  value: unknown, intent: SettingsApprovalAdmissionIntent, configuration: OriginalSettingsApprovalAdmissionConfiguration,
  signal?: AbortSignal): Promise<void> {
  if (!['explicit_decide', 'explicit_continue'].includes(intent) || !Object.is(dependencies.db, configuration.db))
    throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const decision = intent === 'explicit_decide' ? taskCenterDecisionSchema.parse(structuredClone(value)) : undefined;
  const continuation = intent === 'explicit_continue' ? taskCenterContinueSchema.parse(structuredClone(value)) : undefined;
  const command = decision ?? continuation!, clock = dependencies.clock ?? (() => new Date());
  const context = await new AiTaskCurrentIdentityAuthority(dependencies.auth, dependencies.credentials, clock).resolve();
  if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator')
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const access = aiTaskAccessFromContext(context, command.taskId, clock());
  const readTask = () => dependencies.db.aiTask.findFirst({ where: access.where,
    select: { id: true, scopeId: true, sceneCode: true, sceneVersion: true, revision: true } });
  const task = await readTask();
  if (!task || task.id !== command.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const step = await dependencies.db.aiStep.findFirst({ where: { scopeId: task.scopeId,
    taskId: task.id, runId: command.runId, id: command.stepId } });
  if (!step || step.id !== command.stepId || step.taskId !== task.id || step.scopeId !== task.scopeId
    || step.runId !== command.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  if (step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE) return;
  if (task.sceneCode !== dependencies.scene.code || task.sceneVersion !== dependencies.scene.version)
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (continuation && continuation.expectedTaskRevision !== task.revision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  const proposal = { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId: task.id,
    proposalId: command.proposal.proposalId, proposalRevision: command.proposal.proposalRevision,
    reviewedPayloadHash: command.proposal.reviewedPayloadHash };
  await admit(dependencies, { intent, taskId: task.id, runId: command.runId, stepId: command.stepId, proposal,
    ...(decision ? { decision: decision.proposal.decision } : {}) }, intent, configuration, async reference => {
    if (!isDeepStrictEqual(reference.target.proposal, proposal) || reference.target.runId !== command.runId
      || reference.target.stepId !== command.stepId || continuation && reference.target.checkpointRef !== continuation.checkpointRef)
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    if (!isDeepStrictEqual(await readTask(), task)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }, signal);
}
