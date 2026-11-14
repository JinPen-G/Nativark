/** Explicit notification-only re-preparation after the original task has a
 * proved cancellation/no-submission terminal. Uses the original immutable Core
 * change key, current Auth/Guard and CAS; never creates Task/approval/lease or
 * retries unknown work, resets resources, or expands to non-notification settings. */
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_APPROVED_SETTINGS_TOOL_CODE, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { settingsNotificationsSchema, settingsChangeReferenceSchema } from '../../rental-core/approved-settings-change.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composeApprovedSettingsApplication } from '../approval-execution/approved-settings-application.composition';
import { ApprovedSettingsTaskAuthority, settingsConflict, settingsDenied, settingsUnavailable,
  type ApprovedSettingsApplicationDependencies } from '../approval-execution/approved-settings-task.authority';
import { aiStepActionId } from '../ai-step-registration.repository';
import { aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { readSettingsRejectedClosure } from './settings-rejected-closure.reader';

const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const settingsReconfirmationOriginalSchema = z.object({ creationKey: key, changeKey: key }).strict();
const readSchema = z.object({ original: settingsReconfirmationOriginalSchema }).strict();
const reviewSchema = readSchema.extend({ notifications: settingsNotificationsSchema,
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const prepareSchema = reviewSchema.extend({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
type Original = z.infer<typeof settingsReconfirmationOriginalSchema>;
type App = ReturnType<typeof composeApprovedSettingsApplication>;
type Change = Extract<Awaited<ReturnType<App['readChangeReceipt']>>, { state: 'prepared_not_approved' }>['change'];
export type SettingsReconfirmationOriginalResolver = (reference: Original) => Promise<{
  reference: Original; task: { taskId: string; runId: string }; change: Change;
  before: Awaited<ReturnType<ApprovedSettingsTaskAuthority['resolve']>>; verify(): Promise<void>;
}>;

export function composeSettingsReconfirmation(d: ApprovedSettingsApplicationDependencies,
  resolve: SettingsReconfirmationOriginalResolver) {
  const app = composeApprovedSettingsApplication(d), clock = d.clock ?? (() => new Date());
  const fixedKey = (change: Change) => `settings-reconfirm-${change.changeId}`;
  const review = async (value: unknown) => {
    const command = reviewSchema.parse(structuredClone(value));
    const found = await resolve(command.original), current = await app.readCurrent();
    if (!Number.isSafeInteger(current.settingsRevision) || current.settingsRevision < 1
      || current.settingsRevision > 4294967294) throw settingsUnavailable();
    if (requestFingerprint(await app.readCurrent()) !== requestFingerprint(current)) throw settingsConflict();
    await found.verify();
    const reviewHash = requestFingerprint({ version: 'settings-reconfirmation-1', original: found.reference,
      task: found.task, change: { changeId: found.change.changeId, changeHash: found.change.changeHash },
      current, requested: { notifications: command.notifications, expiresAt: command.expiresAt } });
    return { command, found, current, reviewHash };
  };
  const closed = async (found: Awaited<ReturnType<SettingsReconfirmationOriginalResolver>>) => {
    await found.verify();
    const { scopeId, actor, access } = found.before, { taskId, runId } = found.task;
    const result = await d.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${scopeId} AND id = ${taskId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${scopeId} AND taskId = ${taskId} AND id = ${runId} FOR UPDATE`);
      const task = await tx.aiTask.findFirst({ where: { scopeId, id: taskId, ownerKind: 'USER', ownerId: actor.actorId } });
      const tasksForChange = await tx.aiTask.findMany({ where: { scopeId, inputRef: found.change.changeId }, take: 2 });
      const runs = await tx.aiRun.findMany({ where: { scopeId, taskId }, take: 2 }), run = runs[0];
      // Settings creation keys are caller choices. A second task for the same
      // immutable change may still execute; one cancelled task cannot close it.
      if (tasksForChange.length !== 1 || tasksForChange[0].id !== taskId) throw settingsUnavailable();
      // The published notification input hashes its strict reference envelope;
      // its Step and approval/Core actions instead bind the full change hash.
      // Preserve both contracts rather than deriving one from the other.
      const inputFingerprint = requestFingerprint({ changeId: found.change.changeId, changeHash: found.change.changeHash });
      const inputsForChange = await tx.aiTaskActionInput.findMany({ where: { scopeId,
        fingerprint: inputFingerprint, toolCode: AI_APPROVED_SETTINGS_TOOL_CODE }, take: 2 });
      if (inputsForChange.length > 1 || inputsForChange.some(row => row.taskId !== taskId || row.runId !== runId)) throw settingsUnavailable();
      if (task?.status === 'FAILED' && task.cancelRequestedAt === null && runs.length === 1 && run?.status === 'FAILED') {
        return readSettingsRejectedClosure(d, found, tx, task, run);
      }
      if (!task || task.id !== taskId || task.scopeId !== scopeId || task.status !== 'CANCELLED' || !task.cancelRequestedAt || task.archivedAt !== null
        || runs.length !== 1 || !run || run.id !== runId || run.scopeId !== scopeId || run.taskId !== taskId
        || run.actorKind !== 'USER' || run.actorId !== actor.actorId || run.status !== 'CANCELLED'
        || run.leaseOwnerId !== null || run.leaseExpiresAt !== null) throw settingsUnavailable();
      const event = await tx.aiTaskEvent.findFirst({ where: { scopeId, taskId,
        cursor: task.eventCursor, taskRevision: task.revision, type: 'task.transition' } });
      const payload = z.object({ data: z.object({ to: z.literal('cancelled'), reason: z.literal('cancel_settled') }).passthrough() }).passthrough().safeParse(event?.payload);
      if (!event || event.scopeId !== scopeId || event.taskId !== taskId || event.taskRevision !== task.revision || !payload.success) throw settingsUnavailable();
      const taskKey = { scopeId, taskId };
      if (await tx.aiApprovalConsumption.findFirst({ where: taskKey })
        || await tx.rentalApprovedSettingsOperation.findFirst({ where: { tenantId: actor.tenantId,
          workspaceId: actor.workspaceId, changeId: found.change.changeId } })) throw settingsUnavailable();
      const steps = await tx.aiStep.findMany({ where: taskKey, take: 2 });
      if (steps.length > 1) throw settingsUnavailable();
      if (steps.length) {
        const step = steps[0];
        if (!step.inputRef) throw settingsUnavailable();
        const input = await tx.aiTaskActionInput.findFirst({ where: { ...taskKey, runId,
          id: step.inputRef, toolCode: AI_APPROVED_SETTINGS_TOOL_CODE, toolVersion: AI_TOOL_DRAFT_VERSION } });
        const reference = settingsChangeReferenceSchema.safeParse(input?.payload);
        const stored = await tx.aiTaskRunPlan.findFirst({ where: { ...taskKey, runId } });
        const plan = aiTaskRunPlanSchema.safeParse(stored?.payload);
        if (!input || input.scopeId !== scopeId || input.taskId !== taskId || input.runId !== runId
          || !reference.success || reference.data.changeId !== found.change.changeId || reference.data.changeHash !== found.change.changeHash
          || !stored || stored.scopeId !== scopeId || stored.taskId !== taskId || stored.runId !== runId
          || !plan.success || requestFingerprint(plan.data) !== stored.planHash
          || plan.data.taskId !== taskId || plan.data.runId !== runId || plan.data.steps.length !== 1
          || plan.data.steps[0].registrationRef !== input.registrationRef
          || plan.data.steps[0].toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE || plan.data.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
          || plan.data.steps[0].operation !== 'idempotent'
          || input.id !== found.change.changeId || input.fingerprint !== inputFingerprint || step.scopeId !== scopeId || step.taskId !== taskId || step.runId !== runId
          || step.status !== 'FAILED' || step.effect !== 'NONE' || step.inputRef !== input.id
          || step.requestFingerprint !== found.change.changeHash || step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE
          || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.actionId !== aiStepActionId(access.scope, taskId, input.registrationRef)) throw settingsUnavailable();
        const approvals = await tx.aiApproval.findMany({ where: taskKey, take: 2 });
        if (approvals.length > 1 || approvals.some(row => row.decision !== 'REJECTED')) throw settingsUnavailable();
      } else {
        const traces = await Promise.all([tx.aiTaskRunPlan.findFirst({ where: taskKey }),
          tx.aiTaskActionInput.findFirst({ where: taskKey }), tx.aiTaskResultArtifact.findFirst({ where: taskKey }),
          tx.aiProposal.findFirst({ where: taskKey }), tx.aiApproval.findFirst({ where: taskKey }),
          tx.aiTaskExecutionBudget.findFirst({ where: taskKey }), tx.aiTaskExecutionCharge.findFirst({ where: taskKey }),
          tx.aiTaskRunPreparation.findFirst({ where: { ...taskKey, runId } }), tx.aiGatewayInvocation.findFirst({ where: taskKey }),
          tx.aiBudgetReservation.findFirst({ where: { scopeId, runId } })]);
        if (traces.some(Boolean)) throw settingsUnavailable();
      }
      return { taskId, runId, taskRevision: task.revision, state: 'closed_no_business_submission' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    // Release Task locks before Core takes its workspace/category locks. The
    // terminal observation is not a permanent preparation or execution grant.
    await found.verify(); return result;
  };
  return Object.freeze({
    async readUpdatedDifference(value: unknown) {
      const inspected = await review(value);
      return { original: inspected.found.reference, previous: inspected.found.change, current: inspected.current,
        fields: [{ field: 'notifications' as const, before: inspected.current.notifications, after: inspected.command.notifications }],
        originalBaseMatches: inspected.current.settingsRevision === inspected.found.change.baseRevision,
        reviewHash: inspected.reviewHash, expiresAt: inspected.command.expiresAt,
        persistence: 'not_attempted' as const, approval: 'not_granted' as const, automaticRetry: false as const };
    },
    async prepareReconfirmedChange(value: unknown) {
      const command = prepareSchema.parse(structuredClone(value));
      const inspected = await review({ original: command.original, notifications: command.notifications, expiresAt: command.expiresAt });
      if (inspected.reviewHash !== command.reviewHash || Date.parse(command.expiresAt) <= clock().getTime()
        || requestFingerprint(command.notifications) === requestFingerprint(inspected.current.notifications)) throw settingsConflict();
      const closure = await closed(inspected.found), changeKey = fixedKey(inspected.found.change);
      let change;
      try { change = await app.prepareChange({ changeKey, baseRevision: inspected.current.settingsRevision,
        notifications: command.notifications, expiresAt: command.expiresAt }); }
      catch (error) {
        if (error instanceof HttpException && error.getStatus() < 500) throw error;
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      }
      try { await closed(inspected.found); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return { original: inspected.found.reference, closure, change,
        reference: { creationKey: changeKey, changeKey },
        task: 'not_created_by_preparation' as const, approval: 'fresh_proposal_and_approval_required' as const,
        oldResources: 'not_reset_or_reallocated' as const, automaticRetry: false as const };
    },
    async readReconfirmedChange(value: unknown) {
      const command = readSchema.parse(structuredClone(value)), found = await resolve(command.original);
      const changeKey = fixedKey(found.change), receipt = await app.readChangeReceipt({ changeKey });
      await found.verify();
      if (receipt.state === 'prepared_not_approved') await closed(found);
      return { original: found.reference, receipt, reference: { creationKey: changeKey, changeKey },
        execution: 'read_only_no_preparation_or_dispatch' as const, automaticRetry: false as const };
    }
  });
}
