/** Read/human hand-off of one original ordinary-name task. No write, approval,
 * policy configuration, run claim or redispatch. Every buffered result is bound
 * to current membership/task authority and the exact original change/Step. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composeApprovedProfileApplication } from '../approval-execution/approved-profile-application.composition';
import { ApprovedProfileTaskAuthority, PROFILE_NAME_TOOL_CODE, profileConflict, profileDenied, profileUnavailable,
  type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import type { composeTaskProfileHost } from '../runner/profile-task-host.composition';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const preparation = z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36), proposalId: id.max(36),
  proposalRevision: z.literal(1), customerId: id, changeId: z.string().uuid(), changeHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const command = z.object({ preparation, operationKey: id.optional() }).strict();
export type AiProfileBusinessDependencies = ApprovedProfileApplicationDependencies & { profileHost: ReturnType<typeof composeTaskProfileHost> };
export function composeAiProfileBusinessConsumer(d?: AiProfileBusinessDependencies) {
  const read = async (value: unknown) => {
    if (!d?.profileHost) throw profileUnavailable();
    const parsed = command.safeParse(structuredClone(value));
    if (!parsed.success) throw profileConflict();
    const input = parsed.data, { runId, ...ref } = input.preparation, app = composeApprovedProfileApplication(d), authority = new ApprovedProfileTaskAuthority(d);
    const before = await authority.resolve(ref.taskId, 'read');
    const snapshot = await d.profileHost.application.inspect({ taskId: ref.taskId, runId });
    if (snapshot.task.taskId !== ref.taskId || snapshot.run.runId !== runId) throw profileDenied();
    const step = snapshot.steps.find(row => row.stepId === ref.stepId);
    if (!step || step.toolCode !== PROFILE_NAME_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.inputRef !== ref.changeId || step.fingerprint !== ref.changeHash) throw profileDenied();
    const current = await app.readCurrent({ customerId: ref.customerId });
    const prepared = await app.readPreparationReceipt(ref);
    const review = prepared.state === 'prepared' ? await app.readProposal(prepared.reference) : null;
    const decision = prepared.state === 'prepared' ? await app.readDecisionReceipt(prepared.reference) : null;
    if (review && (review.change.customerId !== ref.customerId || review.change.changeId !== ref.changeId
      || review.change.changeHash !== ref.changeHash || review.proposal.payload.taskId !== ref.taskId
      || review.proposal.payload.proposalId !== ref.proposalId || review.proposal.payload.revision !== ref.proposalRevision)) throw profileDenied();
    const waiting = snapshot.task.status === 'waiting_confirmation' && prepared.state === 'prepared';
    const confirmation = waiting ? await d.profileHost.application.readConfirmation({ taskId: ref.taskId, runId, stepId: ref.stepId }) : null;
    if (confirmation && (confirmation.taskId !== ref.taskId || confirmation.runId !== runId || confirmation.stepId !== ref.stepId
      || confirmation.taskRevision !== snapshot.task.revision || confirmation.proposal.proposalId !== ref.proposalId
      || confirmation.proposal.proposalRevision !== ref.proposalRevision || prepared.state !== 'prepared'
      || confirmation.proposal.reviewedPayloadHash !== prepared.reference.payloadHash || confirmation.execution !== 'not_attested')) throw profileConflict();
    const original = prepared.state === 'prepared' ? await d.profileHost.profile.readCommittedChange({ taskId: ref.taskId,
      customerId: ref.customerId, changeId: ref.changeId, changeHash: ref.changeHash }) : null;
    const requested = input.operationKey ? await app.readOriginalOperation({ customerId: ref.customerId, operationKey: input.operationKey }) : null;
    if (requested?.state === 'committed' && (!original || requestFingerprint(requested.receipt) !== requestFingerprint(original))) throw profileDenied();
    if (original && (!review || original.customerId !== ref.customerId || original.changeId !== ref.changeId
      || original.changeHash !== ref.changeHash || original.baseRevision !== review.change.baseRevision
      || original.resultRevision !== original.baseRevision + 1 || decision?.state !== 'recorded' || decision.approval.decision !== 'approved')) throw profileDenied();
    const after = await authority.resolve(ref.taskId, 'read'), latest = await d.profileHost.application.inspect({ taskId: ref.taskId, runId });
    if (before.bindingHash !== after.bindingHash || requestFingerprint(snapshot) !== requestFingerprint(latest)
      || requestFingerprint(await app.readCurrent({ customerId: ref.customerId })) !== requestFingerprint(current)
      || prepared.state === 'prepared' && (requestFingerprint(await app.readProposal(prepared.reference)) !== requestFingerprint(review)
        || requestFingerprint(await app.readDecisionReceipt(prepared.reference)) !== requestFingerprint(decision)
        || requestFingerprint(await d.profileHost.profile.readCommittedChange({ taskId: ref.taskId, customerId: ref.customerId,
          changeId: ref.changeId, changeHash: ref.changeHash })) !== requestFingerprint(original))
      || confirmation && requestFingerprint(await d.profileHost.application.readConfirmation({ taskId: ref.taskId, runId, stepId: ref.stepId })) !== requestFingerprint(confirmation)) throw profileConflict();
    if ((await authority.resolve(ref.taskId, 'read')).bindingHash !== before.bindingHash) throw profileDenied();
    return structuredClone({ mode: 'read_only' as const, scope: before.context.scope, observedAt: authority.clock().toISOString(),
      task: snapshot.task, run: snapshot.run, step, current, change: review?.change ?? null, preparation: prepared, review, decision,
      confirmation, operation: original ? { state: 'committed' as const, receipt: original } : requested,
      currentMatchesChangeBase: review ? current.ordinaryRevision === review.change.baseRevision && current.name === review.change.fields[0].before : null,
      sharing: 'tenant_member_master_not_workspace_order_access' as const, sensitiveFields: 'use_original_verification_flow' as const,
      workflowStatus: snapshot.task.status, businessOutcome: original ? 'committed' as const
        : ['unknown', 'running'].includes(step.status) && step.effect === 'possible' && snapshot.task.status !== 'waiting_confirmation' ? 'unknown' as const : 'not_observed' as const,
      execution: 'not_attested' as const, retryable: false as const });
  };
  return Object.freeze({ availability: d?.profileHost ? 'available_for_original_profile_task' as const : 'unavailable' as const,
    read, async humanHandoff(value: unknown) {
      const result = await read(value);
      return { ...result, mode: 'human_handoff_only' as const, reference: result.preparation.state === 'prepared' ? result.preparation.reference : null,
        continuation: 'not_invoked_use_original_profile_host' as const,
        missing: result.preparation.state !== 'prepared' ? ['original_preparation_receipt'] : result.confirmation ? [] : ['current_server_wait_unavailable'] };
    } });
}
