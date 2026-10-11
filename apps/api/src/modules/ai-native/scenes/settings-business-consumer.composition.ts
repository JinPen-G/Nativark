import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE } from '../../../../../../packages/shared/src/ai-approved-settings-draft';
import { composeApprovedSettingsApplication } from '../approval-execution/approved-settings-application.composition';
import { ApprovedSettingsTaskAuthority, type ApprovedSettingsApplicationDependencies } from '../approval-execution/approved-settings-task.authority';
import { settingsContract, ApprovedSettingsApplicationUnknownError } from '../approval-execution/approved-settings-contracts';
import type { composeTaskSettingsHost } from '../runner/settings-task-host.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ApprovedSettingsResultUnknownError } from '../../rental-core/approved-settings-change.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const commandSchema = z.object({ preparation: z.unknown(), operationKey: id.optional() }).strict();
export type AiSettingsBusinessDependencies = ApprovedSettingsApplicationDependencies & {
  /** Original server-selected settings host. No order continuation or new lease. */
  settingsHost: ReturnType<typeof composeTaskSettingsHost>;
};

/** Read/hand-off consumer of the original notification change and runner.
 * It never publishes inputs, seeds policies, approves or calls Core writes. */
export function composeAiSettingsBusinessConsumer(dependencies?: AiSettingsBusinessDependencies) {
  const app = dependencies ? composeApprovedSettingsApplication(dependencies) : null;
  const authority = dependencies ? new ApprovedSettingsTaskAuthority(dependencies) : null;
  const read = async (value: unknown) => {
    if (!dependencies?.settingsHost?.application || !app || !authority) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const parsed = commandSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = settingsContract('AiApprovedSettingsPrepareDraft', parsed.data.preparation);
    const before = await authority.resolve(command.taskId, 'read');
    const snapshot = await dependencies.settingsHost.application.inspect({ taskId: command.taskId, runId: command.runId });
    if (snapshot.task.taskId !== command.taskId || snapshot.run.runId !== command.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const step = snapshot.steps.find(row => row.stepId === command.stepId);
    if (!step || step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.inputRef !== command.changeId || step.fingerprint !== command.changeHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const current = await app.readCurrent();
    const preparation = await app.readPreparationReceipt(command);
    const review = preparation.state === 'prepared' ? await app.readProposal(preparation.reference) : null;
    if (review && (review.change.changeId !== command.changeId || review.change.changeHash !== command.changeHash
      || review.proposal.payload.taskId !== command.taskId || review.proposal.payload.proposalId !== command.proposalId
      || review.proposal.payload.revision !== command.proposalRevision)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const decision = preparation.state === 'prepared' ? await app.readDecisionReceipt(preparation.reference) : null;
    // Discover the durable wait through the original server reader, never a
    // caller checkpoint or step.resultRef. This reference attests no execution.
    const waiting = snapshot.task.status === 'waiting_confirmation' && preparation.state === 'prepared';
    const checkpointReader = dependencies.settingsHost.application.readConfirmation;
    const confirmation = waiting && typeof checkpointReader === 'function'
      ? await checkpointReader({ taskId: command.taskId, runId: command.runId, stepId: command.stepId }) : null;
    if (confirmation && (confirmation.taskId !== command.taskId || confirmation.runId !== command.runId
      || confirmation.stepId !== command.stepId || confirmation.taskRevision !== snapshot.task.revision
      || confirmation.proposal.proposalId !== command.proposalId || confirmation.proposal.proposalRevision !== command.proposalRevision
      || preparation.state !== 'prepared' || confirmation.proposal.reviewedPayloadHash !== preparation.reference.reviewedPayloadHash
      || confirmation.execution !== 'not_attested')) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    // Reconnection need not know an execution key. Resolve it only from the
    // original persisted task/step binding, never from latest workspace changes.
    const original = preparation.state === 'prepared'
      ? await dependencies.settingsHost.settings.readCommittedChange({ taskId: command.taskId,
        changeId: command.changeId, changeHash: command.changeHash }) : null;
    const operation = parsed.data.operationKey ? await app.readOperation({ draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION,
      operationKey: parsed.data.operationKey }) : original
      ? { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, state: 'committed' as const, receipt: original } : null;
    if (operation?.state === 'committed' && (operation.receipt.changeId !== command.changeId || operation.receipt.changeHash !== command.changeHash
      || (parsed.data.operationKey && operation.receipt.operationKey !== parsed.data.operationKey) || !review || operation.receipt.baseRevision !== review.change.baseRevision
      || decision?.state !== 'recorded' || decision.approval.decision !== 'approved')) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (operation?.state === 'committed') {
      // Let the original executor resolve the operation from THIS persisted
      // task/step binding. A same-change receipt from another task is not proof.
      if (!original || requestFingerprint(original) !== requestFingerprint(operation.receipt)) {
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
    }
    // Neither a permission code nor the first successful read is a reusable grant.
    const after = await authority.resolve(command.taskId, 'read');
    const latest = await dependencies.settingsHost.application.inspect({ taskId: command.taskId, runId: command.runId });
    if (after.bindingHash !== before.bindingHash || requestFingerprint(latest) !== requestFingerprint(snapshot)
      || requestFingerprint(await app.readCurrent()) !== requestFingerprint(current)
      || (preparation.state === 'prepared' && requestFingerprint(await app.readProposal(preparation.reference)) !== requestFingerprint(review))
      || (confirmation && requestFingerprint(await checkpointReader({ taskId: command.taskId, runId: command.runId,
        stepId: command.stepId })) !== requestFingerprint(confirmation))) {
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    if ((await authority.resolve(command.taskId, 'read')).bindingHash !== before.bindingHash) {
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    return structuredClone({ mode: 'read_only' as const, observedAt: (dependencies.clock ?? (() => new Date()))().toISOString(),
      scope: before.context.scope, task: snapshot.task, run: snapshot.run,
      step: { stepId: step.stepId, revision: step.revision, status: step.status, effect: step.effect,
        inputRef: step.inputRef, fingerprint: step.fingerprint, resultRef: step.resultRef },
      current, change: review?.change ?? null,
      currentMatchesChangeBase: review ? current.settingsRevision === review.change.baseRevision : null,
      preparation, review, decision, operation, confirmation,
      businessOutcome: operation?.state === 'committed' ? 'committed' as const : step.status === 'unknown' ? 'unknown' as const : 'not_observed' as const,
      retryable: false as const, originalOperation: parsed.data.operationKey ? 'original_key_read' as const
        : original ? 'persisted_original_binding_read' as const : 'original_result_not_observed' as const });
  };
  return Object.freeze({ availability: dependencies?.settingsHost ? 'available_for_original_settings_task' as const : 'unavailable' as const,
    async read(value: unknown) {
      try { return await read(value); }
      catch (error) {
        if (error instanceof ApprovedSettingsResultUnknownError) {
          return { mode: 'read_only' as const, businessOutcome: 'unknown' as const, retryable: false as const, nextAction: 'read_operation' as const };
        }
        if (!(error instanceof ApprovedSettingsApplicationUnknownError)) throw error;
        return { mode: 'read_only' as const, businessOutcome: 'unknown' as const, retryable: false as const, nextAction: error.nextAction };
      }
    },
    async humanHandoff(value: unknown) {
      const result = await read(value);
      return { mode: 'human_handoff_only' as const, task: result.task, run: result.run, step: result.step,
        reference: result.preparation.state === 'prepared' ? result.preparation.reference : null, decision: result.decision,
        confirmation: result.confirmation,
        continuation: 'not_invoked_use_original_settings_host' as const,
        missing: result.preparation.state !== 'prepared' ? ['original_preparation_receipt']
          : result.confirmation ? [] : ['current_server_wait_unavailable'],
        execution: 'not_attested' as const,
        operation: result.operation, businessOutcome: result.businessOutcome, retryable: false as const };
    }
  });
}
