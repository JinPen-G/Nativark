import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepositoryOperation } from './ai-task.repository';
import { AiTaskCurrentActionAuthority, type AiTaskActionPolicySource, type AiTaskCredentialSource } from './task-current-action.authority';
import type { AiScopeRepository } from './ai-scope.repository';
import { isAiStepExecutionContext } from './task-contract-validation';

const policySelect = {
  taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true
} satisfies Prisma.AiTaskActionPolicySelect;

const operations: readonly AiTaskRepositoryOperation[] = [
  'read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run',
  'transition_task', 'read_step_terminal', 'takeover_run'
];

type PolicyRow = Prisma.AiTaskActionPolicyGetPayload<{ select: typeof policySelect }>;

/** Reads a server-owned task action policy. Missing/expired/malformed rows fail closed. */
export class PrismaTaskActionPolicySource implements AiTaskActionPolicySource {
  constructor(
    private readonly db: Pick<PrismaClient, 'aiTaskActionPolicy'>,
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly clock: () => Date = () => new Date()
  ) {
    if (typeof db?.aiTaskActionPolicy?.findUnique !== 'function' || typeof scopes?.resolveCurrent !== 'function') {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
  }

  async resolve(taskId: string, operation: AiTaskRepositoryOperation, context: AiExecutionContext) {
    if (!operations.includes(operation) || typeof taskId !== 'string' || !context) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    const current = structuredClone(await this.scopes.resolveCurrent());
    if (!isAiStepExecutionContext(context) || !isAiStepExecutionContext(current.context)) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    const { requestId: _currentRequest, authorizedAt: _currentTime, ...currentIdentity } = current.context;
    const { requestId: _request, authorizedAt: _time, ...requestedIdentity } = structuredClone(context);
    if (requestFingerprint(currentIdentity) !== requestFingerprint(requestedIdentity)) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    let row: PolicyRow | null;
    try {
      row = await this.db.aiTaskActionPolicy.findUnique({
        where: { scopeId_taskId_operation: { scopeId: current.scope.id, taskId, operation } },
        select: policySelect
      });
    } catch {
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    if (!row || row.taskId !== taskId || row.operation !== operation
      || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())
      || row.expiresAt.getTime() <= this.clock().getTime()) return null;
    if (!Array.isArray(row.requiredPermissions) || row.requiredPermissions.length < 1 || row.requiredPermissions.length > 64
      || row.requiredPermissions.some(value => typeof value !== 'string' || value.length < 1 || value.length > 191)
      || new Set(row.requiredPermissions).size !== row.requiredPermissions.length) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    return {
      taskId: row.taskId, operation: row.operation, revision: row.revision,
      expiresAt: row.expiresAt.toISOString(), requiredPermissions: [...row.requiredPermissions] as string[]
    };
  }
}

/** Explicit composition helper. It creates no Nest provider and does not widen
 * the authority boundary; the caller must supply the real AuthService,
 * credential source and current scope repository. */
export function composePrismaTaskCurrentActionAuthority(input: {
  auth: ConstructorParameters<typeof AiTaskCurrentActionAuthority>[0];
  credentials: AiTaskCredentialSource;
  db: Pick<PrismaClient, 'aiTaskActionPolicy'>;
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  const policies = new PrismaTaskActionPolicySource(input.db, input.scopes, clock);
  return new AiTaskCurrentActionAuthority(input.auth, input.credentials, policies, clock);
}
