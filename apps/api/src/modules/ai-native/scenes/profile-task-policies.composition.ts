/** Explicit manager admission for one original ordinary-name Task. Reuses the
 * existing policy authority/CAS/operation receipts. No policy on Task creation,
 * approval, profile write, model, new runtime or renewal of unknown execution.
 * The first admission is atomic; original receipts are observations only. */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { composeTaskActionPolicyManagement } from '../task-action-policy-management.composition';
import { composeProfileTaskCreation } from '../approval-execution/profile-task-creation.composition';
import { profileTransactionDb, profileConflict, profileDenied, profileUnavailable,
  type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import { profileChangeInputSchema } from '../runner/prisma-task-plan-input.source';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import type { AiTaskActionPolicyOperation } from '../prisma-task-action-policy.repository';

const operations = ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run', 'claim_recovery_run',
  'release_run', 'transition_task', 'decide_approval'] as const satisfies readonly AiTaskActionPolicyOperation[];
const readers = new Set<AiTaskActionPolicyOperation>(operations.slice(0, 3));
const permissions = (operation: AiTaskActionPolicyOperation) =>
  [readers.has(operation) ? 'rental-os:member:view' : 'rental-os:member:manage'];
const configureSchema = profileChangeInputSchema.extend({ decision: z.literal('allow_original_member_name_task') }).strict();
const same = (a: unknown, b: unknown) => requestFingerprint(JSON.parse(JSON.stringify(a))) === requestFingerprint(JSON.parse(JSON.stringify(b)));

export function composeProfileTaskActionPolicies(d: ApprovedProfileApplicationDependencies,
  options: { executionEnabled: boolean; ttlMs: number }) {
  options = Object.freeze(z.object({ executionEnabled: z.boolean(), ttlMs: z.number().int().min(1).max(120000) })
    .strict().parse(structuredClone(options)));
  const clock = d.clock ?? (() => new Date());
  const target = async (dependencies: ApprovedProfileApplicationDependencies, value: unknown) => {
    const parsed = profileChangeInputSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw profileConflict();
    const original = freezeOriginalInput(parsed.data), creation = composeProfileTaskCreation(dependencies);
    const receipt = await creation.read(original);
    if (!('state' in receipt.receipt) || receipt.receipt.state !== 'observed'
      || !('task' in receipt.receipt) || !receipt.receipt.task) throw profileUnavailable();
    const taskId = receipt.receipt.task.taskId, runId = receipt.receipt.task.runId;
    const task = await dependencies.db.aiTask.findFirst({ where: { id: taskId } });
    if (!task || task.id !== taskId || task.inputRef !== original.changeId || task.inputHash !== original.changeHash
      || task.sceneCode !== dependencies.scene.code || task.sceneVersion !== dependencies.scene.version
      || task.ownerKind !== 'USER' || task.audience !== 'OPERATOR' || task.archivedAt !== null) throw profileDenied();
    const manager = composeTaskActionPolicyManagement(dependencies);
    // The original manager checks current system-rules permission, owner,
    // tenant/workspace and the selected member permission. No Task policy is
    // required to configure that same Task's first metadata policy.
    const read = async () => {
      const items = [];
      for (const operation of operations) {
        const current = await manager.read(taskId, operation);
        const mutation = await manager.readMutation(taskId, operation, null);
        if (mutation.state === 'recorded' && (mutation.policy.revision !== 1
          || mutation.policy.taskId !== taskId || mutation.policy.operation !== operation
          || !same(mutation.policy.requiredPermissions, permissions(operation)))) throw profileConflict();
        items.push({ operation, current, mutation });
      }
      return items;
    };
    const verify = async () => {
      const current = await creation.read(original), latest = await dependencies.db.aiTask.findFirst({ where: { id: taskId } });
      if (!('state' in current.receipt) || current.receipt.state !== 'observed' || !('task' in current.receipt)
        || !current.receipt.task || current.receipt.task.taskId !== taskId
        || current.receipt.task.runId !== runId || !same(current.original, original) || !latest
        || latest.ownerId !== task.ownerId || latest.scopeId !== task.scopeId || latest.inputRef !== task.inputRef
        || latest.inputHash !== task.inputHash || latest.sceneCode !== task.sceneCode || latest.sceneVersion !== task.sceneVersion
        || latest.archivedAt !== null) throw profileDenied();
    };
    await verify(); return { original, task, taskId, runId, manager, read, verify };
  };
  const observed = (found: Awaited<ReturnType<typeof target>>, items: Awaited<ReturnType<Awaited<ReturnType<typeof target>>['read']>>) => {
    const recorded = items.filter(item => item.mutation.state === 'recorded');
    if (recorded.length !== 0 && recorded.length !== operations.length) throw profileConflict();
    return freezeOriginalInput({ original: found.original, taskId: found.taskId, runId: found.runId,
      state: recorded.length === operations.length ? 'recorded' as const : 'not_observed' as const,
      items, retryable: false as const, authorization: 'current_original_manager_required' as const,
      approval: 'not_granted_by_policy_configuration' as const,
      execution: 'not_invoked_by_policy_configuration' as const, profileUpdate: 'not_attempted_by_policy_configuration' as const });
  };
  return Object.freeze({
    async read(value: unknown) {
      const found = await target(d, value), items = await found.read(); await found.verify(); return observed(found, items);
    },
    async configure(value: unknown) {
      const parsed = configureSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw profileConflict();
      const { decision: _decision, ...original } = parsed.data;
      const before = await target(d, original), first = await before.read(); await before.verify();
      if (first.every(item => item.mutation.state === 'recorded')) return { ...observed(before, first), replayed: true as const };
      if (!options.executionEnabled) throw profileUnavailable();
      if (first.some(item => item.current.state !== 'not_observed' || item.mutation.state !== 'not_observed')) throw profileConflict();
      if (before.task.status !== 'QUEUED' || before.task.cancelRequestedAt !== null) throw profileDenied();
      const change = await d.db.customerApprovedProfileChange.findUnique({ where: { id: original.changeId } });
      if (!change || change.changeHash !== original.changeHash || change.customerId !== original.customerId
        || change.actorId !== before.task.ownerId || !(change.expiresAt instanceof Date)) throw profileDenied();
      const at = clock();
      if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw profileUnavailable();
      const expiresAt = new Date(Math.min(change.expiresAt.getTime(), at.getTime() + options.ttlMs));
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= at) throw profileConflict();
      let entered = false;
      try {
        await d.db.$transaction(async tx => {
          // Each put keeps its own real manager/CAS/receipt checks, composed on
          // the SAME transaction. A lost COMMIT does not leave a usable partial
          // admission and is never retried with new revisions or TTL.
          const found = await target({ ...d, db: profileTransactionDb(d.db, tx) }, original);
          const current = await found.read();
          if (!same(current, first) || found.task.status !== 'QUEUED' || found.task.cancelRequestedAt !== null) throw profileConflict();
          for (const operation of operations) {
            entered = true;
            await found.manager.put({ taskId: found.taskId, operation, requiredPermissions: permissions(operation), expiresAt }, null, true);
          }
          await found.verify();
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
        const found = await target(d, original), items = await found.read(); await found.verify();
        if (items.some(item => item.mutation.state !== 'recorded' || item.mutation.policy.expiresAt !== expiresAt.toISOString()))
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return { ...observed(found, items), replayed: false as const };
      } catch (error) {
        if (entered) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw error;
      }
    }
  });
}
