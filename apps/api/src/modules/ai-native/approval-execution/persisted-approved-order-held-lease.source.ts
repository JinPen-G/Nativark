import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AiApprovalReprepareCommandDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistedOrderTaskInput } from '../order-task-input.composition';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import type { ApprovedOrderReprepareServices } from './approved-order-reprepare.ports';

const holderSchema = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

type HeldLeasePort = ApprovedOrderReprepareServices['lease'];
export class PersistedApprovedOrderHeldLeaseSource implements HeldLeasePort {
  private readonly formal: ReturnType<typeof composePersistedOrderTaskInput>;
  private readonly holderId: string;
  private readonly clock: () => Date;
  constructor(private readonly d: ControlledApprovedOrderDependencies, holderId: string) {
    const holder = holderSchema.safeParse(holderId);
    if (!holder.success) throw unavailable();
    this.holderId = holder.data;
    this.formal = composePersistedOrderTaskInput(d);
    this.clock = d.clock ?? (() => new Date());
  }

  async current(reference: AiApprovalReprepareCommandDraft['replacement'], tx: Prisma.TransactionClient) {
    const first = await this.formal.tasks.resolveAccess(reference.taskId, 'read_metadata');
    const read = async () => {
      const access = await this.formal.tasks.resolveAccess(reference.taskId, 'read_metadata');
      if (access.bindingKey !== first.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const task = await tx.aiTask.findFirst({ where: access.where });
      if (!task || task.id !== reference.taskId || task.status !== 'RUNNING' || task.cancelRequestedAt !== null) throw unavailable();
      const run = await tx.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: reference.runId } });
      const now = this.clock();
      if (!run || run.scopeId !== task.scopeId || run.taskId !== task.id || run.id !== reference.runId || run.status !== 'RUNNING'
        || run.actorKind !== access.actorKind || run.actorId !== access.actorId || run.leaseOwnerId !== this.holderId
        || !Number.isSafeInteger(run.revision) || run.revision < 1 || run.revision > 4294967294
        || !(run.leaseExpiresAt instanceof Date) || !Number.isFinite(run.leaseExpiresAt.getTime())
        || !Number.isFinite(now.getTime()) || run.leaseExpiresAt <= now) return null;
      const fencingToken = run.fencingToken.toFixed(0);
      if (!/^[1-9][0-9]{0,19}$/u.test(fencingToken)) return null;
      return { taskId: task.id, runId: run.id, holderId: this.holderId, revision: run.revision,
        fencingToken, expiresAt: run.leaseExpiresAt.toISOString() };
    };
    const lease = await read();
    if (!lease) return null;
    await this.formal.plans.assertExecutable(lease);
    await this.formal.source.readForExecution({ taskId: reference.taskId, runId: reference.runId, stepId: reference.stepId,
      actionId: reference.actionId, inputRef: reference.inputRef, fingerprint: reference.fingerprint, lease });
    const latest = await read();
    if (!latest || requestFingerprint(latest) !== requestFingerprint(lease)) return null;
    const { taskId: _task, expiresAt: _expiry, ...held } = lease;
    return held;
  }
}
