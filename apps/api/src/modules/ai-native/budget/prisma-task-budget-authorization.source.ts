import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { TenantModelConfigurationAuthority } from '../tenant-model-config.authority';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { BudgetError, type BudgetAction } from './budget.ports';
import type { BudgetAuthorizationSource } from './budget-dependency-adapters';

const identity = (context: AiExecutionContext) => {
  const { requestId: _id, authorizedAt: _at, ...value } = context;
  return requestFingerprint(value);
};
const actions = ['settings_read', 'settings_write', 'reserve', 'dispatch', 'read', 'settle', 'release', 'unknown', 'reconcile'];

/** Financial authorization from current Auth, the original task policy and
 * original invocation. An explicit original-task reader can authorize reads
 * only; mutations still require current task policy. No caller scope, dispatch
 * grant or second ledger. ServerBudgetAuthorityAdapter retains entitlement checks.
 */
export class PrismaTaskBudgetAuthorizationSource implements BudgetAuthorizationSource {
  private readonly authorization;
  private readonly management;
  private readonly bindings;
  private readonly clock: () => Date;
  readonly scopes;
  private readonly originalTaskId?: string;
  constructor(private readonly input: PersistedTaskAuthorizationDependencies & { guard: Pick<ApiAuthGuard, 'canActivate'>; taskId?: string },
    private readonly originalTaskRead?: (taskId: string) => Promise<AiExecutionContext>) {
    if (input.taskId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(input.taskId)) throw new BudgetError('FORBIDDEN');
    if (originalTaskRead !== undefined && (typeof originalTaskRead !== 'function' || input.taskId === undefined)) throw new BudgetError('FORBIDDEN');
    this.originalTaskId = input.taskId;
    this.clock = input.clock ?? (() => new Date());
    this.authorization = composePersistedTaskAuthorization(input);
    this.scopes = this.authorization.scopes;
    this.management = new TenantModelConfigurationAuthority(input.guard, input.credentials,
      new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, this.clock));
    this.bindings = new PrismaGatewayInvocationBindings(input.db, this.authorization.scopes, this.clock);
  }
  async resolveContext() { return (await this.authorization.scopes.resolveCurrent()).context; }
  async authorize(action: BudgetAction, value: Readonly<AiExecutionContext>, resourceValue: Readonly<Record<string, unknown>>) {
    if (!actions.includes(action)) throw new BudgetError('FORBIDDEN');
    const context = structuredClone(value), resource = structuredClone(resourceValue);
    const before = await this.authorization.scopes.resolveCurrent();
    if (identity(context) !== identity(before.context) || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || before.scope.kind !== 'WORKSPACE' || !['operator', 'staff'].includes(context.audience)) throw new BudgetError('FORBIDDEN');
    const gatewayContext = { actorId: context.actor.userId, tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId };
    let proof: unknown;
    if (action === 'settings_read' || action === 'settings_write') {
      const policy = resource.policy as { scopeKind?: unknown; scopeId?: unknown; sceneCode?: unknown } | undefined;
      if (!policy || typeof policy.scopeId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(policy.scopeId)
        || typeof policy.sceneCode !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(policy.sceneCode)
        || !['TENANT', 'WORKSPACE'].includes(policy.scopeKind as string)) throw new BudgetError('FORBIDDEN');
      const scope = await this.input.db.aiScope.findFirst({ where: { id: policy.scopeId as string,
        kind: policy.scopeKind as 'TENANT' | 'WORKSPACE', tenantId: context.scope.tenantId,
        workspaceId: policy.scopeKind === 'WORKSPACE' ? context.scope.workspaceId : null } });
      if (!scope || scope.id !== policy.scopeId || scope.kind !== policy.scopeKind || scope.tenantId !== context.scope.tenantId
        || (scope.kind === 'WORKSPACE' ? scope.workspaceId !== context.scope.workspaceId : scope.workspaceId !== null)) throw new BudgetError('FORBIDDEN');
      await this.management.authorize(gatewayContext, action === 'settings_write' ? 'manage' : 'read');
      proof = { policy, scopeId: scope.id };
    } else {
      const association = resource.association as Record<string, unknown> | undefined;
      if (!association || typeof association.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(association.requestId)
        || requestFingerprint(association.scope) !== requestFingerprint(context.scope)) throw new BudgetError('FORBIDDEN');
      const row = await this.input.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
        scopeId: before.scope.id, callId: association.requestId } } });
      if (!row || (this.originalTaskId !== undefined && row.taskId !== this.originalTaskId)
        || row.scopeId !== before.scope.id || row.actorId !== gatewayContext.actorId || !isGatewayConfig(row.configuration)) throw new BudgetError('FORBIDDEN');
      const dispatching = action === 'reserve' || action === 'dispatch';
      const binding = dispatching ? await this.bindings.resolveForReserve(gatewayContext, {
        callId: row.callId, model: row.configuration.model, maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash,
      }) : typeof resource.reservationId === 'string'
        ? await this.bindings.resolveForReservation(gatewayContext, resource.reservationId) : null;
      if (!binding || requestFingerprint(binding.association) !== requestFingerprint(association)
        || binding.actorId !== gatewayContext.actorId || binding.sceneCode !== row.sceneCode) throw new BudgetError('FORBIDDEN');
      if (action === 'read' && this.originalTaskRead) {
        const current = await this.originalTaskRead(row.taskId);
        if (identity(current) !== identity(context)) throw new BudgetError('FORBIDDEN');
        // This receipt reader is selected by server composition for one task.
        // It cannot settle/release a charge or renew an expired execution grant.
        proof = { invocationId: row.id, registrationHash: row.registrationHash, configurationHash: row.configurationHash,
          association: binding.association, reservationId: resource.reservationId ?? null, originalTaskRead: identity(current) };
      } else {
        const taskContext = dispatching ? await this.authorization.execution.authorize(row.taskId)
          : await this.authorization.authority.resolve(row.taskId, 'read_step_terminal');
        if (identity(taskContext) !== identity(context)) throw new BudgetError('FORBIDDEN');
        const operation = dispatching ? 'transition_task' : 'read_step_terminal';
        const policy = await this.input.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: {
          scopeId: before.scope.id, taskId: row.taskId, operation } } });
        if (!policy || policy.scopeId !== before.scope.id || policy.taskId !== row.taskId || policy.operation !== operation
          || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || !(policy.expiresAt instanceof Date)
          || !Number.isFinite(policy.expiresAt.getTime()) || policy.expiresAt <= this.clock()
          || !Array.isArray(policy.requiredPermissions) || policy.requiredPermissions.length === 0
          || !('access' in context) || policy.requiredPermissions.some(permission => typeof permission !== 'string'
            || !('access' in context) || !context.access.permissions.includes(permission))) throw new BudgetError('FORBIDDEN');
        const finalTaskContext = dispatching ? await this.authorization.execution.authorize(row.taskId)
          : await this.authorization.authority.resolve(row.taskId, 'read_step_terminal');
        if (identity(finalTaskContext) !== identity(context)) throw new BudgetError('FORBIDDEN');
        // Original financial facts already bind reservation/dispatch/usage.
        // This source authorizes the resource, not the caller's evidence strings.
        proof = { invocationId: row.id, registrationHash: row.registrationHash, configurationHash: row.configurationHash,
          association: binding.association, reservationId: resource.reservationId ?? null,
          policy: { revision: policy.revision, permissions: policy.requiredPermissions, expiresAt: policy.expiresAt.toISOString() } };
      }
    }
    const after = await this.authorization.scopes.resolveCurrent();
    if (after.scope.id !== before.scope.id || identity(after.context) !== identity(context)) throw new BudgetError('FORBIDDEN');
    return { authorizationKey: `task-budget:${requestFingerprint({ action, identity: identity(context), proof })}`,
      expiresAt: new Date(this.clock().getTime() + 5000) };
  }
}
