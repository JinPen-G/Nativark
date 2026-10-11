import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { isAiStepExecutionContext } from './task-contract-validation';
import { AiTaskRepositoryError, type AiTaskRepositoryOperation } from './ai-task.repository';
import type { AiScopeRepository } from './ai-scope.repository';

const operations: readonly string[] = [
  'read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run',
  'transition_task', 'read_step_terminal', 'takeover_run', 'request_input', 'submit_input', 'resume_input'
];
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const permission = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const maxRevision = 4294967294;

export interface AiTaskActionPolicyMutationAuthority {
  /** The composition root must bind this to a real action-level authority. */
  resolve(taskId: string, operation: 'configure_action_policy'): Promise<AiExecutionContext>;
}

export interface AiTaskActionPolicyMutation {
  taskId: string;
  operation: AiTaskRepositoryOperation;
  requiredPermissions: readonly string[];
  expiresAt: Date;
}

export interface AiTaskActionPolicyMutationResult {
  taskId: string;
  operation: AiTaskRepositoryOperation;
  revision: number;
  requiredPermissions: readonly string[];
  expiresAt: string;
}

type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiTaskActionPolicy'>;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const error = (code: ConstructorParameters<typeof AiTaskRepositoryError>[0]) => new AiTaskRepositoryError(code);

export class AiTaskActionPolicyResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

/**
 * Server-side writer for the persisted task action policy.
 *
 * It intentionally has no default policy and no Nest registration. The caller
 * must provide an action-level authority and the canonical current scope. CAS
 * is performed inside the same transaction as the task/scope check; a caller
 * supplied scope or revision can never select another tenant's policy.
 */
export class PrismaTaskActionPolicyRepository {
  constructor(
    private readonly db: Db,
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly authority: AiTaskActionPolicyMutationAuthority,
    private readonly clock: () => Date = () => new Date()
  ) {
    if (typeof db?.$transaction !== 'function' || typeof db?.aiTask?.findFirst !== 'function'
      || typeof db?.aiTaskActionPolicy?.findUnique !== 'function'
      || typeof scopes?.resolveCurrent !== 'function' || typeof authority?.resolve !== 'function') throw error('AI_RESOURCE_UNAVAILABLE');
  }

  private async access(taskId: string) {
    if (!id.test(taskId)) throw error('AI_INVALID_INPUT');
    let granted: AiExecutionContext;
    try { granted = structuredClone(await this.authority.resolve(taskId, 'configure_action_policy')); }
    catch { throw error('AI_ACCESS_DENIED'); }
    const current = structuredClone(await this.scopes.resolveCurrent());
    if (!isAiStepExecutionContext(granted) || !isAiStepExecutionContext(current.context)) throw error('AI_ACCESS_DENIED');
    const strip = (value: AiExecutionContext) => { const { requestId: _, authorizedAt: __, ...identity } = value; return identity; };
    if (requestFingerprint(strip(granted)) !== requestFingerprint(strip(current.context))) throw error('AI_ACCESS_DENIED');
    if (current.scope.kind !== 'WORKSPACE' && current.scope.kind !== 'TENANT' && current.scope.kind !== 'PLATFORM') throw error('AI_ACCESS_DENIED');
    return { context: current.context, scopeId: current.scope.id,
      bindingKey: requestFingerprint({ scopeId: current.scope.id, identity: strip(current.context) }) };
  }

  private async recheck(taskId: string, bindingKey: string) {
    // Sequential authorization recheck, not an atomic lock on the Auth service.
    // A failure here rolls back the staged policy write with the transaction.
    if ((await this.access(taskId)).bindingKey !== bindingKey) throw error('AI_ACCESS_DENIED');
  }

  private validate(value: AiTaskActionPolicyMutation) {
    if (!value || !id.test(value.taskId) || !operations.includes(value.operation)) throw error('AI_INVALID_INPUT');
    if (!Array.isArray(value.requiredPermissions) || value.requiredPermissions.length < 1 || value.requiredPermissions.length > 64
      || value.requiredPermissions.some(item => typeof item !== 'string' || !permission.test(item))
      || new Set(value.requiredPermissions).size !== value.requiredPermissions.length) throw error('AI_INVALID_INPUT');
    if (!(value.expiresAt instanceof Date) || !Number.isFinite(value.expiresAt.getTime()) || value.expiresAt.getTime() <= this.clock().getTime()) throw error('AI_INVALID_INPUT');
    return { ...structuredClone(value), requiredPermissions: [...value.requiredPermissions] };
  }

  private project(row: { taskId: string; operation: string; revision: number; requiredPermissions: unknown; expiresAt: Date }): AiTaskActionPolicyMutationResult {
    if (!operations.includes(row.operation as AiTaskRepositoryOperation) || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > maxRevision
      || !Array.isArray(row.requiredPermissions) || row.requiredPermissions.length < 1 || row.requiredPermissions.length > 64
      || row.requiredPermissions.some(value => typeof value !== 'string' || !permission.test(value))
      || new Set(row.requiredPermissions).size !== row.requiredPermissions.length
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw error('AI_STORAGE_UNAVAILABLE');
    return { taskId: row.taskId, operation: row.operation as AiTaskRepositoryOperation, revision: row.revision,
      requiredPermissions: [...row.requiredPermissions] as string[], expiresAt: row.expiresAt.toISOString() };
  }

  /** Original-key read for configuration/CAS recovery, including an expired
   * policy. Expired rows are not execution grants; the action consumer still
   * refuses them. A failed read never proves that a prior write did not commit. */
  async read(taskId: string, operation: AiTaskRepositoryOperation) {
    if (!operations.includes(operation)) throw error('AI_INVALID_INPUT');
    const access = await this.access(taskId);
    let row;
    try {
      const task = await this.db.aiTask.findFirst({ where: { scopeId: access.scopeId, id: taskId, archivedAt: null }, select: { id: true } });
      if (!task || task.id !== taskId) throw error('AI_RESOURCE_UNAVAILABLE');
      row = await this.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: { scopeId: access.scopeId, taskId, operation } },
        select: { taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true } });
    } catch (cause) {
      if (cause instanceof AiTaskRepositoryError) throw cause;
      throw error('AI_STORAGE_UNAVAILABLE');
    }
    await this.recheck(taskId, access.bindingKey);
    if (!row) return { state: 'not_observed' as const, retryable: false as const, nextAction: 'reconcile' as const };
    if (row.taskId !== taskId || row.operation !== operation) throw error('AI_STORAGE_UNAVAILABLE');
    return { state: 'observed' as const, policy: this.project(row), retryable: false as const, nextAction: 'read_original_policy' as const };
  }

  async put(value: AiTaskActionPolicyMutation, expectedRevision: number | null): Promise<AiTaskActionPolicyMutationResult> {
    const next = this.validate(value);
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > maxRevision)) throw error('AI_INVALID_INPUT');
    const access = await this.access(next.taskId);
    try {
      return await this.db.$transaction(async (tx: Tx) => {
        const task = await tx.aiTask.findFirst({ where: { scopeId: access.scopeId, id: next.taskId, archivedAt: null }, select: { id: true } });
        if (!task || task.id !== next.taskId) throw error('AI_RESOURCE_UNAVAILABLE');
        const where = { scopeId_taskId_operation: { scopeId: access.scopeId, taskId: next.taskId, operation: next.operation } };
        const current = await tx.aiTaskActionPolicy.findUnique({ where, select: { taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true } });
        if (expectedRevision === null ? current !== null : current?.revision !== expectedRevision) throw error('AI_REVISION_CONFLICT');
        if (current && (!Number.isSafeInteger(current.revision) || current.revision >= maxRevision)) throw error('AI_REVISION_CONFLICT');
        const revision = current ? current.revision + 1 : 1;
        let row;
        if (current) {
          const changed = await tx.aiTaskActionPolicy.updateMany({ where: { scopeId: access.scopeId, taskId: next.taskId, operation: next.operation, revision: expectedRevision! }, data: { revision, requiredPermissions: next.requiredPermissions, expiresAt: next.expiresAt } });
          if (changed.count !== 1) throw error('AI_REVISION_CONFLICT');
          row = await tx.aiTaskActionPolicy.findUnique({ where, select: { taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true } });
        } else {
          row = await tx.aiTaskActionPolicy.create({ data: { scopeId: access.scopeId, taskId: next.taskId, operation: next.operation, revision, requiredPermissions: next.requiredPermissions, expiresAt: next.expiresAt }, select: { taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true } });
        }
        if (!row) throw error('AI_STORAGE_UNAVAILABLE');
        const result = this.project(row);
        await this.recheck(next.taskId, access.bindingKey);
        this.validate(next);
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (cause) {
      if (cause instanceof AiTaskRepositoryError) throw cause;
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') throw error('AI_REVISION_CONFLICT');
      throw new AiTaskActionPolicyResultUnknownError();
    }
  }

  async clear(taskId: string, operation: AiTaskRepositoryOperation, expectedRevision: number): Promise<AiTaskActionPolicyMutationResult> {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw error('AI_INVALID_INPUT');
    if (!operations.includes(operation) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision >= maxRevision) throw error('AI_INVALID_INPUT');
    const access = await this.access(taskId);
    try {
      return await this.db.$transaction(async (tx: Tx) => {
        const task = await tx.aiTask.findFirst({ where: { scopeId: access.scopeId, id: taskId, archivedAt: null }, select: { id: true } });
        if (!task || task.id !== taskId) throw error('AI_RESOURCE_UNAVAILABLE');
        const changed = await tx.aiTaskActionPolicy.updateMany({ where: { scopeId: access.scopeId, taskId, operation, revision: expectedRevision }, data: { revision: expectedRevision + 1, expiresAt: now } });
        if (changed.count !== 1) throw error('AI_REVISION_CONFLICT');
        const row = await tx.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: { scopeId: access.scopeId, taskId, operation } }, select: { taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true } });
        if (!row) throw error('AI_STORAGE_UNAVAILABLE');
        const result = this.project(row);
        await this.recheck(taskId, access.bindingKey);
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (cause) {
      if (cause instanceof AiTaskRepositoryError) throw cause;
      throw new AiTaskActionPolicyResultUnknownError();
    }
  }
}
