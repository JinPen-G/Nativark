/** Financial permission for one existing AUTOMATION Task and its original
 * model invocation. New effects require the current subject/policy and human
 * resource Guard; this port cannot manage settings or borrow a user identity. */
import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { CurrentPersistentTaskAuthorization } from '../runner/authorized-persistent-task-input.composition';
import { isGatewayConfig } from '../gateway-contract-validation';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import type { BudgetAuthorizationSource } from './budget-dependency-adapters';
import { BudgetError, type BudgetAction } from './budget.ports';

const identity = (context: AiExecutionContext) => {
  const { requestId: _request, authorizedAt: _at, ...value } = context;
  return requestFingerprint(value);
};

export class PrismaAutomationTaskBudgetAuthorizationSource implements BudgetAuthorizationSource {
  readonly scopes;
  private readonly bindings;
  constructor(private readonly db: PrismaClient, private readonly authorization: CurrentPersistentTaskAuthorization,
    private readonly taskId: string, private readonly clock: () => Date = () => new Date()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(taskId)
      || typeof authorization?.scopes?.resolveCurrent !== 'function'
      || typeof authorization.execution?.authorize !== 'function' || typeof authorization.authority?.resolve !== 'function') {
      throw new BudgetError('UNAVAILABLE');
    }
    this.scopes = authorization.scopes;
    this.bindings = new PrismaGatewayInvocationBindings(db, this.scopes, clock);
  }
  async resolveContext() { return (await this.scopes.resolveCurrent()).context; }
  async authorize(action: BudgetAction, value: Readonly<AiExecutionContext>, resourceValue: Readonly<Record<string, unknown>>) {
    if (!['reserve', 'dispatch', 'read', 'settle', 'release', 'unknown', 'reconcile'].includes(action)) throw new BudgetError('FORBIDDEN');
    const context = structuredClone(value), resource = structuredClone(resourceValue), before = await this.scopes.resolveCurrent();
    const principal = gatewayBudgetPrincipal(context);
    if (principal.actorKind !== 'AUTOMATION' || context.actor.kind !== 'automation' || context.scope.kind !== 'workspace'
      || before.scope.kind !== 'WORKSPACE' || identity(context) !== identity(before.context)) throw new BudgetError('FORBIDDEN');
    const association = resource.association as Record<string, unknown> | undefined;
    if (!association || typeof association.requestId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(association.requestId)
      || requestFingerprint(association.scope) !== requestFingerprint(context.scope)) throw new BudgetError('FORBIDDEN');
    const row = await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
      scopeId: before.scope.id, callId: association.requestId } }, select: { id: true, scopeId: true, taskId: true, actorId: true,
        configuration: true, callId: true, maxOutputTokens: true, intentHash: true, sceneCode: true, registrationHash: true, configurationHash: true } });
    if (!row || row.scopeId !== before.scope.id || row.taskId !== this.taskId || row.actorId !== principal.actorId
      || !isGatewayConfig(row.configuration) || requestFingerprint(row.configuration) !== row.configurationHash) throw new BudgetError('FORBIDDEN');
    const dispatching = action === 'reserve' || action === 'dispatch';
    const current = () => dispatching ? this.authorization.execution.authorize(this.taskId)
      : this.authorization.authority.resolve(this.taskId, 'read_step_terminal');
    if (identity(await current()) !== identity(context)) throw new BudgetError('FORBIDDEN');
    const { actorKind: _kind, ...gateway } = principal;
    const binding = dispatching ? await this.bindings.resolveForReserve(gateway, {
      callId: row.callId, model: row.configuration.model, maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash })
      : typeof resource.reservationId === 'string' ? await this.bindings.resolveForReservation(gateway, resource.reservationId) : null;
    if (!binding || binding.actorId !== principal.actorId || binding.sceneCode !== row.sceneCode
      || requestFingerprint(binding.association) !== requestFingerprint(association)) throw new BudgetError('FORBIDDEN');
    const after = await this.scopes.resolveCurrent();
    if (identity(await current()) !== identity(context) || identity(after.context) !== identity(context)
      || after.scope.id !== before.scope.id) throw new BudgetError('FORBIDDEN');
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('FORBIDDEN');
    const expiresAt = Math.min(Date.parse(context.actor.expiresAt), now.getTime() + 5000);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) throw new BudgetError('FORBIDDEN');
    return { authorizationKey: `automation-budget:${requestFingerprint({ action, identity: identity(context), taskId: this.taskId,
      invocationId: row.id, registrationHash: row.registrationHash, configurationHash: row.configurationHash,
      association: binding.association, reservationId: resource.reservationId ?? null })}`, expiresAt: new Date(expiresAt) };
  }
}
