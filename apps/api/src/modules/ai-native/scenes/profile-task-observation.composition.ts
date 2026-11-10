/** Read-only original ordinary-name task center view and cursor reconnect.
 * Reuses durable task/event/resource projections and original Core receipts;
 * never claims a Run, initializes a budget or turns UI/approval into execution.
 * Separate sources are generation-checked, not claimed to be one transaction. */
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, type AiTaskRecoverySnapshot, type AiTaskSnapshotDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { AiTaskEventRepository } from '../ai-task-event.repository';
import { PrismaTaskRecoverySnapshotRepository } from '../runner/prisma-task-recovery-snapshot.repository';
import { profileChangeInputSchema } from '../runner/prisma-task-plan-input.source';
import { PROFILE_NAME_TOOL_CODE, profileConflict, profileDenied, type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import type { composeAiProfileBusinessConsumer } from './profile-business-consumer.composition';

type Reference = z.infer<typeof profileChangeInputSchema>;
type Business = Awaited<ReturnType<ReturnType<typeof composeAiProfileBusinessConsumer>['read']>>;
type Resolver = (value: unknown) => Promise<{ reference: Reference; task: { taskId: string; runId: string }; verify(): Promise<void> }>;
const readSchema = z.object({ original: profileChangeInputSchema }).strict();
const eventSchema = readSchema.extend({ after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u), limit: z.number().int().min(1).max(100) }).strict();

export function composeProfileTaskObservation(d: ApprovedProfileApplicationDependencies, resolve: Resolver,
  readBusiness: (reference: Reference, detail: AiTaskRecoverySnapshot) => Promise<Business | null>) {
  const authorization = composePersistedTaskAuthorization(d);
  const events = new AiTaskEventRepository(d.db, authorization.authority, d.clock);
  const recovery = new PrismaTaskRecoverySnapshotRepository(d.db, authorization.tasks);
  const bound = (detail: AiTaskRecoverySnapshot, found: Awaited<ReturnType<Resolver>>) => {
    if (detail.task.taskId !== found.task.taskId || detail.run.runId !== found.task.runId || detail.steps.length > 1
      || detail.steps.some(step => step.toolCode !== PROFILE_NAME_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
        || step.inputRef !== found.reference.changeId || step.fingerprint !== found.reference.changeHash)) throw profileDenied();
  };
  const aligned = (snapshot: AiTaskSnapshotDraft, detail: AiTaskRecoverySnapshot) => {
    if (snapshot.taskId !== detail.task.taskId || snapshot.revision !== detail.task.revision || snapshot.status !== detail.task.status
      || snapshot.cursor !== detail.task.eventCursor || snapshot.steps.length !== detail.steps.length
      || snapshot.steps.some(step => step.runId !== detail.run.runId || !detail.steps.some(row => row.stepId === step.stepId
        && row.sequence === step.sequence && row.revision === step.revision && row.status === step.status))) throw profileConflict();
  };
  const sameBusiness = (a: Business, b: Business) => {
    const { observedAt: _a, ...first } = a, { observedAt: _b, ...last } = b;
    return requestFingerprint(first) === requestFingerprint(last);
  };
  const businessBound = (business: Business, detail: AiTaskRecoverySnapshot) => {
    if (business.task.taskId !== detail.task.taskId || business.task.revision !== detail.task.revision
      || business.task.status !== detail.task.status || business.run.runId !== detail.run.runId
      || business.run.revision !== detail.run.revision || !detail.steps.some(step => step.stepId === business.step.stepId
        && step.revision === business.step.revision && step.status === business.step.status && step.effect === business.step.effect)) throw profileConflict();
  };
  const projectBusiness = (value: Business) => ({ observedAt: value.observedAt, current: value.current, change: value.change,
    preparation: value.preparation, decision: value.decision, operation: value.operation,
    confirmation: value.confirmation ? { checkpointRef: value.confirmation.checkpointRef,
      taskRevision: value.confirmation.taskRevision,
      proposal: value.confirmation.proposal, execution: value.confirmation.execution } : null,
    currentMatchesChangeBase: value.currentMatchesChangeBase, sharing: value.sharing,
    workflowStatus: value.workflowStatus, businessOutcome: value.businessOutcome, retryable: false as const });
  return Object.freeze({
    async readTaskObservation(value: unknown) {
      const command = readSchema.parse(structuredClone(value)), found = await resolve(command.original);
      const ids = { taskId: found.task.taskId, runId: found.task.runId };
      const detail = await recovery.read(ids); bound(detail, found);
      const snapshot = await events.readSnapshot({ taskId: ids.taskId }); aligned(snapshot, detail);
      // A missing original Step/ledger is unavailable, not a zero-cost success.
      const business = detail.steps.length === 1 ? await readBusiness(found.reference, detail) : null;
      if (business) businessBound(business, detail);
      const latest = await recovery.read(ids); bound(latest, found);
      const lastSnapshot = await events.readSnapshot({ taskId: ids.taskId }); aligned(lastSnapshot, latest);
      if (requestFingerprint(latest) !== requestFingerprint(detail) || requestFingerprint(lastSnapshot) !== requestFingerprint(snapshot)) throw profileConflict();
      const last = latest.steps.length === 1 ? await readBusiness(found.reference, latest) : null;
      if (Boolean(business) !== Boolean(last)) throw profileConflict();
      if (business && last) {
        businessBound(last, latest);
        if (!sameBusiness(business, last)) throw profileConflict();
      }
      await found.verify();
      // This existing public kind describes the registered tool's confirmation
      // node, not an approval or dispatch grant. No raw audit/tool bodies leave.
      const presented: AiTaskSnapshotDraft = { ...snapshot, steps: snapshot.steps.map(step => ({ ...step, kind: 'confirmation' as const })) };
      return { original: found.reference, snapshot: presented, detail,
        business: business ? { availability: 'available' as const, value: projectBusiness(business) }
          : { availability: 'unavailable' as const, reason: detail.steps.length === 0
            ? 'original_step_not_registered' as const : 'original_preparation_not_observed' as const },
        consistency: 'independent_authorized_reads_same_generation_checked' as const,
        execution: 'read_only_no_lease_no_dispatch_no_budget_write' as const, retryable: false as const };
    },
    async readTaskEvents(value: unknown) {
      const command = eventSchema.parse(structuredClone(value)), found = await resolve(command.original);
      const page = await events.readPage({ taskId: found.task.taskId, after: command.after, limit: command.limit });
      if (page.taskId !== found.task.taskId) throw profileDenied();
      await found.verify();
      // Preserve the original reset_required response. Missing history is not
      // an empty success and reconnecting never continues or restarts work.
      return { original: found.reference, page, execution: 'read_only_no_reconnect_side_effect' as const };
    }
  });
}
