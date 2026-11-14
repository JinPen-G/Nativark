import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiAutomationInput } from '@prisma/client';
import { z } from 'zod';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { AutomationError, PrismaAutomationAuthority } from './prisma-automation.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const eventCommand = z.object({ eventId: z.string().uuid() }).strict();
const inputCommand = z.object({ inputRef: z.string().uuid() }).strict();
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AutomationError('invalid_input');
  return parsed.data;
};
const command = (row: AiAutomationInput) => ({ creationKey: row.creationKey, sceneCode: row.sceneCode, inputRef: row.id });
const originalInput = (row: AiAutomationInput) => requestFingerprint({ id: row.id, tenantId: row.tenantId,
  workspaceId: row.workspaceId, scopeId: row.scopeId, subjectId: row.subjectId, authorizationRevision: row.authorizationRevision,
  eventId: row.eventId, policyId: row.policyId, policyRevision: row.policyRevision, resourceRevision: row.resourceRevision,
  deduplicationKey: row.deduplicationKey, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
  creationKey: row.creationKey, inputRevision: row.inputRevision, inputHash: row.inputHash, authorityHash: row.authorityHash,
  payload: row.payload, expiresAt: row.expiresAt });
const semantics = { dispatchRequested: false as const, confirmationGranted: false as const, semantics: 'metadata_only_not_execution_permission' as const };

export class AutomationFailureTaskService {
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiAutomationInput'>,
    private readonly authority: PrismaAutomationAuthority, private readonly tasks: AiTaskCreationRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly assertPreparationPolicy?: (tx: Prisma.TransactionClient) => Promise<void>) {}

  async prepare(value: unknown) {
    const { eventId } = parse(eventCommand, value);
    const before = await this.authority.snapshot(eventId), inputRef = randomUUID();
    let storedId: string, attemptedRef: string = inputRef;
    try {
      storedId = await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_policies WHERE id = ${before.policy.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_subjects WHERE id = ${before.subject.id} FOR UPDATE`);
        if (before.event.inspectionId) await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_inspection_records WHERE id = ${before.event.inspectionId} AND tenantId = ${before.key.tenantId} AND workspaceId = ${before.key.workspaceId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_business_failure_outbox WHERE id = ${eventId} FOR UPDATE`);
        if (before.event.notificationId) await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_notification_logs WHERE id = ${before.event.notificationId} FOR UPDATE`);
        if (before.event.refundId) await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_payment_refunds WHERE id = ${before.event.refundId} FOR UPDATE`);
        await this.assertPreparationPolicy?.(tx);
        const current = await this.authority.inspect(eventId, tx);
        if (current.materialHash !== before.materialHash) throw new AutomationError('unavailable');
        const existing = await tx.aiAutomationInput.findFirst({ where: {
          tenantId: before.key.tenantId, workspaceId: before.key.workspaceId, eventId: before.key.eventId } });
        // The locked original event owns a single preparation even if a second
        // request observed a different policy before the first committed. Never
        // mint a replacement input for an already attempted event operation.
        if (existing) { this.authority.verifyInput(existing, before); attemptedRef = existing.id; return existing.id; }
        if (before.event.inspectionId && before.event.exceptionId) {
          const sourceKey = { tenantId: before.key.tenantId, workspaceId: before.key.workspaceId,
            inspectionId: before.event.inspectionId, exceptionId: before.event.exceptionId };
          const consumed = await tx.aiAutomationInput.findFirst({ where: {
            tenantId: before.key.tenantId, workspaceId: before.key.workspaceId, event: sourceKey } });
          const closed = await tx.aiBusinessFailureOutbox.findFirst({ where: { ...sourceKey, status: 'closed' } });
          if (consumed || closed) throw new AutomationError('unavailable');
        }
        const policy = await tx.aiAutomationPolicy.findFirst({ where: { id: before.policy.id,
          tenantId: before.key.tenantId, workspaceId: before.key.workspaceId } });
        const now = this.clock(), day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        if (!policy || !Number.isSafeInteger(policy.preparedCount) || policy.preparedCount < 0
          || policy.counterDay && policy.counterDay > day || policy.lastPreparedAt && policy.lastPreparedAt > now) throw new AutomationError('unavailable');
        const count = policy.counterDay?.getTime() === day.getTime() ? policy.preparedCount : 0;
        if (count >= before.policy.maxTasksPerDay || policy.lastPreparedAt && now.getTime() - policy.lastPreparedAt.getTime() < before.policy.cooldownSeconds * 1000) {
          throw new AutomationError('limit_reached');
        }
        const reservation = await tx.aiAutomationPolicy.updateMany({ where: { id: before.policy.id,
          tenantId: before.key.tenantId, workspaceId: before.key.workspaceId, revision: before.policy.revision, mode: before.policy.mode },
          data: { counterDay: day, preparedCount: count + 1, lastPreparedAt: now } });
        if (reservation.count !== 1) throw new AutomationError('unavailable');
        await tx.aiAutomationInput.create({ data: { id: inputRef, ...before.key, inputRevision: 1, scopeId: before.scopeId,
          subjectId: before.subject.id, authorizationRevision: before.subject.authorizationRevision,
          resourceRevision: before.event.resourceRevision, deduplicationKey: before.event.deduplicationKey,
          sceneCode: before.policy.sceneCode, sceneVersion: before.policy.sceneVersion, creationKey: before.creationKey,
          payload: JSON.parse(JSON.stringify(before.payload)) as Prisma.InputJsonValue,
          inputHash: before.inputHash, authorityHash: before.authorityHash,
          expiresAt: before.expiresAt, status: 'prepared', taskId: null, runId: null } });
        if ((await this.authority.inspect(eventId, tx)).materialHash !== before.materialHash) throw new AutomationError('unavailable');
        await this.assertPreparationPolicy?.(tx);
        return inputRef;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AutomationError) throw error;
      return { state: 'unknown' as const, inputRef: attemptedRef, creationKey: before.creationKey, retryable: false as const,
        nextAction: 'read_original_input' as const, ...semantics };
    }
    const { row } = await this.authority.input(storedId);
    return { state: 'prepared' as const, inputRef: row.id, creationKey: row.creationKey, ...semantics };
  }

  async read(value: unknown) {
    const { inputRef } = parse(inputCommand, value);
    const { row, snapshot } = await this.authority.input(inputRef);
    return { inputRef: row.id, status: row.status, mode: snapshot.policy.mode, eventId: row.eventId,
      sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, creationKey: row.creationKey,
      inputHash: row.inputHash, expiresAt: row.expiresAt.toISOString(), ...semantics };
  }

  async create(value: unknown) {
    const { inputRef } = parse(inputCommand, value);
    const { row } = await this.authority.input(inputRef);
    if (row.status !== 'prepared') return this.reconcile({ inputRef });
    try {
      const claim = await this.db.aiAutomationInput.updateMany({ where: { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId,
        policyId: row.policyId, policyRevision: row.policyRevision, authorityHash: row.authorityHash, inputHash: row.inputHash,
        status: 'prepared', reviewStatus: 'open', expiresAt: { gt: this.clock() }, taskId: null, runId: null }, data: { status: 'creation_unknown' } });
      if (claim.count !== 1) return this.reconcile({ inputRef });
    } catch { return this.reconcile({ inputRef }); }
    try {
      const task = await this.tasks.create(command(row));
      await this.authority.input(inputRef);
      const linked = await this.db.aiAutomationInput.updateMany({ where: { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId,
        scopeId: row.scopeId, policyId: row.policyId, policyRevision: row.policyRevision, inputHash: row.inputHash,
        status: 'creation_unknown', taskId: null, runId: null }, data: { status: 'linked', taskId: task.taskId, runId: task.runId } });
      if (linked.count !== 1) return this.reconcile({ inputRef });
    } catch { return this.reconcile({ inputRef }); }
    return this.reconcile({ inputRef });
  }

  async reconcile(value: unknown) {
    const { inputRef } = parse(inputCommand, value);
    const { row } = await this.authority.input(inputRef);
    const binding = originalInput(row);
    const receipt = await this.tasks.readCreation(command(row));
    const current = await this.authority.input(inputRef);
    if (originalInput(current.row) !== binding) throw new AutomationError('result_unknown');
    if (receipt.state === 'observed' && current.row.status === 'linked'
      && (current.row.taskId !== receipt.task.taskId || current.row.runId !== receipt.task.runId)) throw new AutomationError('result_unknown');
    return { ...receipt, inputRef: row.id, inputStatus: current.row.status, ...semantics };
  }
}
