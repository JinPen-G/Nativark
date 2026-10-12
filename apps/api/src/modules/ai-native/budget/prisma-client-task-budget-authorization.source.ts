import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { composePersistedClientTaskAuthorization } from '../scenes/client-task-execution.composition';
import type { AiAuthorizedClientMaterial, AiClientTaskDependencies } from '../scenes/client-task.authority';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { BudgetError, type BudgetAction } from './budget.ports';
import type { BudgetAuthorizationSource } from './budget-dependency-adapters';

const identityHash = (context: AiExecutionContext) => {
  const { requestId: _request, authorizedAt: _at, ...identity } = context;
  return requestFingerprint(identity);
};

/** Current CUSTOMER task policy + original invocation, not operator permissions
 * or a caller's entitled flag. Only the original financial lifecycle is allowed;
 * customer settings management is always denied. No second ledger/dispatcher. */
export class PrismaClientTaskBudgetAuthorizationSource implements BudgetAuthorizationSource {
  readonly scopes;
  private readonly authorization;
  private readonly bindings;
  private readonly clock;
  constructor(private readonly input: AiClientTaskDependencies & { db: PrismaClient; command: unknown;
    loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>; clock?: () => Date }) {
    this.clock = input.clock ?? (() => new Date());
    this.authorization = composePersistedClientTaskAuthorization(input, input.command, input.loadMaterial, this.clock);
    this.scopes = this.authorization.scopes;
    this.bindings = new PrismaGatewayInvocationBindings(input.db, this.scopes, this.clock);
  }
  async resolveContext() { return (await this.scopes.resolveCurrent()).context; }
  async authorize(action: BudgetAction, value: Readonly<AiExecutionContext>, resourceValue: Readonly<Record<string, unknown>>) {
    if (!['reserve', 'dispatch', 'read', 'settle', 'release', 'unknown', 'reconcile'].includes(action)) throw new BudgetError('FORBIDDEN');
    const context = structuredClone(value), resource = structuredClone(resourceValue);
    const before = await this.scopes.resolveCurrent();
    if (context.audience !== 'client' || context.actor.kind !== 'customer' || context.scope.kind !== 'workspace'
      || before.scope.kind !== 'WORKSPACE' || identityHash(context) !== identityHash(before.context)) throw new BudgetError('FORBIDDEN');
    const association = resource.association as Record<string, unknown> | undefined;
    if (!association || typeof association.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(association.requestId)
      || requestFingerprint(association.scope) !== requestFingerprint(context.scope)) throw new BudgetError('FORBIDDEN');
    const row = structuredClone(await this.input.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
      scopeId: before.scope.id, callId: association.requestId } } }));
    if (!row || row.scopeId !== before.scope.id || row.actorId !== context.actor.customerId || !isGatewayConfig(row.configuration)) throw new BudgetError('FORBIDDEN');
    const dispatching = action === 'reserve' || action === 'dispatch';
    const operation = dispatching ? 'execute' : action === 'read' ? 'read' : 'accounting';
    const initialGrant = await this.authorization.execution.readGrant(row.taskId, operation);
    if (identityHash(initialGrant.context) !== identityHash(context)) throw new BudgetError('FORBIDDEN');
    const gatewayContext = { actorId: context.actor.customerId, tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId };
    const binding = dispatching ? await this.bindings.resolveForReserve(gatewayContext, { callId: row.callId,
      model: row.configuration.model, maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash })
      : typeof resource.reservationId === 'string' ? await this.bindings.resolveForReservation(gatewayContext, resource.reservationId) : null;
    if (!binding || requestFingerprint(binding.association) !== requestFingerprint(association)
      || binding.actorId !== context.actor.customerId || binding.sceneCode !== row.sceneCode) throw new BudgetError('FORBIDDEN');
    const finalGrant = await this.authorization.execution.readGrant(row.taskId, operation);
    const after = await this.scopes.resolveCurrent();
    if (identityHash(finalGrant.context) !== identityHash(context) || initialGrant.proof !== finalGrant.proof
      || identityHash(after.context) !== identityHash(context)
      || after.scope.id !== before.scope.id) throw new BudgetError('FORBIDDEN');
    return { authorizationKey: `client-task-budget:${requestFingerprint({ action, identity: identityHash(context),
      invocationId: row.id, registrationHash: row.registrationHash, configurationHash: row.configurationHash,
      association: binding.association, reservationId: resource.reservationId ?? null, policyBinding: finalGrant.proof })}`,
      expiresAt: new Date(Math.min(finalGrant.expiresAt.getTime(), this.clock().getTime() + 5000)) };
  }
}
