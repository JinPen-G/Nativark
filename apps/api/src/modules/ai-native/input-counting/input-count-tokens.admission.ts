/** Admission for the counting operation itself. A count request is an
 * external provider call with its own derived request id, its own calls-unit
 * reservation in the SAME budget account, and the original task/run/step as
 * its resource binding. The reserve/dispatch authority is the original
 * invocation's own authority (whoever may dispatch the text call may count its
 * frozen input); lifecycle actions verify the counting reservation and the
 * original task's read authority. No token bound is required to admit a count
 * — that would be circular — and calls are never converted into tokens. */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext, AiUsageAssociationDraft } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import { aiTaskAccessFromContext } from '../ai-task.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { PrismaTaskBudgetAuthorizationSource } from '../budget/prisma-task-budget-authorization.source';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import { gatewayBudgetPrincipal } from '../budget/gateway-budget-principal';
import { BudgetError, type BudgetAction, type BudgetEvidencePort,
  type BudgetGrant, type BudgetQuote, type BudgetQuotePort, type BudgetRecord,
  type BudgetReserveCommand, type BudgetUsageEvidence } from '../budget/budget.ports';
import type { BudgetAuthorizationSource } from '../budget/budget-dependency-adapters';
import { PrismaCountTokensReceipts, countTokensReceiptDocumentHash, countTokensCallId, countTokensSceneCode,
  type CountTokensReceiptDb } from './input-count-tokens.receipt';

export { countTokensCallId, countTokensSceneCode };

const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const hash64 = z.string().regex(/^[a-f0-9]{64}$/u);

export type CountTokensAdmissionDb = Pick<PrismaClient, 'aiGatewayInvocation' | 'aiBudgetReservation' | 'aiTaskActionPolicy'>
  & CountTokensReceiptDb;
const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return requestFingerprint(value);
};
const originalReserveRequest = (row: { callId: string; configuration: unknown; configurationHash: string;
  maxOutputTokens: number; intentHash: string; model: string }) => {
  if (!isGatewayConfig(row.configuration)) throw new BudgetError('UNAVAILABLE');
  return { callId: row.callId, model: row.model, maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash };
};

export class InputCountTokensAuthorizationSource implements BudgetAuthorizationSource {
  private readonly base;
  private readonly bindings;
  private readonly taskAuthority;
  private readonly clock;
  private readonly taskDb: Pick<PrismaClient, 'aiTask'>;
  constructor(input: PersistedTaskAuthorizationDependencies & { guard: ConstructorParameters<typeof PrismaTaskBudgetAuthorizationSource>[0]['guard'] },
    private readonly db: CountTokensAdmissionDb) {
    this.base = new PrismaTaskBudgetAuthorizationSource(input);
    this.bindings = new PrismaGatewayInvocationBindings(input.db, this.base.scopes, input.clock ?? (() => new Date()));
    this.taskAuthority = composePersistedTaskAuthorization(input);
    this.clock = input.clock ?? (() => new Date());
    this.taskDb = input.db;
  }
  get scopes(): Pick<AiScopeRepository, 'resolveCurrent'> { return this.base.scopes; }
  async resolveContext() { return this.base.resolveContext(); }
  /** Receipt-free observation still requires current original-task read
   * policy and persisted ownership; knowing an invocation id is not authority. */
  async authorizeObservation(taskId: string): Promise<AiExecutionContext> {
    const context = structuredClone(await this.taskAuthority.authority.resolve(taskId, 'read_step_terminal'));
    const current = structuredClone(await this.scopes.resolveCurrent());
    if (identity(context) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    const task = await this.taskDb.aiTask.findFirst({ where: aiTaskAccessFromContext(context, taskId, this.clock()).where,
      select: { id: true, scopeId: true } });
    if (!task || task.id !== taskId || task.scopeId !== current.scope.id) throw new BudgetError('FORBIDDEN');
    const after = await this.taskAuthority.authority.resolve(taskId, 'read_step_terminal');
    if (identity(context) !== identity(after)) throw new BudgetError('FORBIDDEN');
    return context;
  }
  /** The counting association must bind the original invocation: same
   * run/step/action and config, with the count request id derived by the
   * server from the original call id — never chosen by the caller. */
  private async verifyOriginal(association: Readonly<AiUsageAssociationDraft>, row: { id: string; scopeId: string; taskId: string;
    runId: string; stepId: string; actionId: string; actorId: string; callId: string; configuration: unknown;
    configurationHash: string; maxOutputTokens: number; intentHash: string }) {
    if (association.runId !== row.runId || association.stepId !== row.stepId || association.actionId !== row.actionId
      || !isGatewayConfig(association.config) || requestFingerprint(association.config) !== row.configurationHash
      || countTokensCallId(row.callId) !== association.requestId || association.idempotencyKey !== association.requestId)
      throw new BudgetError('FORBIDDEN');
    return originalReserveRequest({ ...row, model: (row.configuration as { model: string }).model });
  }
  async authorize(action: BudgetAction, value: Readonly<AiExecutionContext>, resource: Readonly<Record<string, unknown>>) {
    if (action === 'settings_read' || action === 'settings_write') return this.base.authorize(action, value, resource);
    const context = structuredClone(value), resourceValue = structuredClone(resource);
    const association = resourceValue.association as AiUsageAssociationDraft | undefined;
    if (!association || typeof association.requestId !== 'string' || typeof association.stepId !== 'string')
      throw new BudgetError('FORBIDDEN');
    const gateway = gatewayBudgetPrincipal(context);
    const current = structuredClone(await this.taskAuthority.scopes.resolveCurrent());
    if (identity(context) !== identity(current.context) || current.context.actor.kind !== 'user'
      || current.scope.kind !== 'WORKSPACE' || current.scope.tenantId !== gateway.tenantId
      || current.scope.workspaceId !== gateway.workspaceId
      || requestFingerprint(association.scope) !== requestFingerprint(current.context.scope)) throw new BudgetError('FORBIDDEN');
    const dispatching = action === 'reserve' || action === 'dispatch';
    // Decimal-bearing rows are read without structuredClone, mirroring the
    // original bindings source; the fencing token is only compared, never copied.
    const row = dispatching
      ? await this.db.aiGatewayInvocation.findFirst({ where: { scopeId: current.scope.id, stepId: association.stepId } })
      : await this.reservationInvocation(String(resourceValue.reservationId ?? ''), association, current.scope.id, gateway.actorId);
    if (!row || row.scopeId !== current.scope.id || row.actorId !== gateway.actorId) throw new BudgetError('FORBIDDEN');
    const request = await this.verifyOriginal(association, row);
    if (dispatching) {
      const binding = structuredClone(await this.bindings.resolveForReserve({ actorId: gateway.actorId,
        tenantId: gateway.tenantId, workspaceId: gateway.workspaceId }, request));
      if (binding.association.requestId !== row.callId) throw new BudgetError('FORBIDDEN');
      return this.base.authorize(action, context, { association: binding.association });
    }
    return this.lifecycle(action, context, row, association, gateway);
  }
  private async reservationInvocation(reservationId: string, association: Readonly<AiUsageAssociationDraft>,
    scopeId: string, actorId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(reservationId)) throw new BudgetError('FORBIDDEN');
    const reservation = await this.db.aiBudgetReservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.scopeId !== scopeId || reservation.scopeKind !== 'WORKSPACE'
      || reservation.actorId !== actorId || reservation.callId !== association.requestId
      || reservation.runId !== association.runId || reservation.stepId !== association.stepId
      || reservation.actionId !== association.actionId) throw new BudgetError('FORBIDDEN');
    return this.db.aiGatewayInvocation.findFirst({ where: { scopeId, stepId: reservation.stepId } });
  }
  /** Original accounting authority over the counting reservation: current
   * identity plus the original task's read policy, mirroring the base source's
   * non-dispatching branch without inventing a task state. */
  private async lifecycle(action: BudgetAction, context: AiExecutionContext, row: { taskId: string; scopeId: string; callId: string },
    association: Readonly<AiUsageAssociationDraft>, gateway: { actorId: string }) {
    const taskContext = await this.taskAuthority.authority.resolve(row.taskId, 'read_step_terminal');
    if (identity(taskContext) !== identity(context)) throw new BudgetError('FORBIDDEN');
    const policy = structuredClone(await this.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: {
      scopeId: row.scopeId, taskId: row.taskId, operation: 'read_step_terminal' } } }));
    const now = this.clock();
    if (!policy || policy.scopeId !== row.scopeId || policy.taskId !== row.taskId || policy.operation !== 'read_step_terminal'
      || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || !(policy.expiresAt instanceof Date)
      || !Number.isFinite(policy.expiresAt.getTime()) || policy.expiresAt <= now
      || !Array.isArray(policy.requiredPermissions) || policy.requiredPermissions.length === 0
      || !('access' in context) || policy.requiredPermissions.some(permission => typeof permission !== 'string'
        || !context.access.permissions.includes(permission))) throw new BudgetError('FORBIDDEN');
    if (identity((await this.taskAuthority.scopes.resolveCurrent()).context) !== identity(context)) throw new BudgetError('FORBIDDEN');
    return { authorizationKey: `count-tokens:${requestFingerprint({ action, identity: identity(context),
      invocationCallId: row.callId, association, reservationOwner: gateway.actorId })}`,
      expiresAt: new Date(now.getTime() + 5000) };
  }
}

/** Calls-unit quote for counting operations under explicitly configured
 * counting-scene policies. Quantity is one real call per count request; it is
 * never converted into tokens, money or a bound. */
export class InputCountTokensCallPricing implements BudgetQuotePort {
  constructor(private readonly db: CountTokensAdmissionDb & Pick<PrismaClient, 'aiScope' | 'aiBudgetPolicy'>,
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly countingPriceVersion: string | undefined, private readonly clock: () => Date = () => new Date()) {
    if (countingPriceVersion !== undefined && !code.max(64).safeParse(countingPriceVersion).success) throw new BudgetError('UNAVAILABLE');
  }
  private async current() {
    const current = structuredClone(await this.scopes.resolveCurrent());
    const principal = gatewayBudgetPrincipal(current.context);
    if (current.scope.kind !== 'WORKSPACE' || principal.tenantId !== current.scope.tenantId
      || principal.workspaceId !== current.scope.workspaceId) throw new BudgetError('FORBIDDEN');
    const { actorKind: _, ...gateway } = principal;
    return { ...current, gateway };
  }
  async quote(value: Readonly<BudgetReserveCommand>, grantValue: Readonly<BudgetGrant>): Promise<BudgetQuote> {
    if (!this.countingPriceVersion) throw new BudgetError('UNAVAILABLE');
    const command = structuredClone(value), grant = structuredClone(grantValue), before = await this.current();
    if (!grant.entitled || identity(grant.context) !== identity(before.context)
      || command.association.priceVersion !== this.countingPriceVersion
      || command.callId !== command.association.requestId || command.association.idempotencyKey !== command.callId) throw new BudgetError('FORBIDDEN');
    const row = await this.db.aiGatewayInvocation.findFirst({ where: {
      scopeId: before.scope.id, stepId: command.association.stepId } });
    if (!row || row.scopeId !== before.scope.id || row.actorId !== before.gateway.actorId
      || countTokensSceneCode(row.sceneCode) !== command.sceneCode
      || row.runId !== command.association.runId || row.actionId !== command.association.actionId
      || countTokensCallId(row.callId) !== command.callId || !isGatewayConfig(command.association.config)
      || requestFingerprint(command.association.config) !== row.configurationHash) throw new BudgetError('FORBIDDEN');
    const policies = [];
    for (const scope of [{ kind: 'platform' as const }, { kind: 'tenant' as const, tenantId: before.gateway.tenantId },
      { kind: 'workspace' as const, tenantId: before.gateway.tenantId, workspaceId: before.gateway.workspaceId }]) {
      const columns = aiPersistenceScopeColumns(scope);
      const canonical = await this.db.aiScope.findFirst({ where: columns });
      if (!canonical || Object.entries(columns).some(([key, item]) => canonical[key as keyof typeof canonical] !== item))
        throw new BudgetError('UNAVAILABLE');
      const key = { scopeKind: columns.kind, scopeId: canonical.id, sceneCode: command.sceneCode };
      const policy = await this.db.aiBudgetPolicy.findFirst({ where: key });
      if (!policy || policy.scopeId !== key.scopeId || policy.scopeKind !== key.scopeKind || policy.sceneCode !== key.sceneCode
        || policy.unitKind !== 'calls' || policy.priceVersion && policy.priceVersion !== this.countingPriceVersion)
        throw new BudgetError('UNAVAILABLE');
      policies.push(key);
    }
    const after = await this.current();
    if (before.scope.id !== after.scope.id || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    const expiresAt = new Date(Math.min(command.expiresAt.getTime(), row.expiresAt.getTime()));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= this.clock()
      || !(grant.expiresAt instanceof Date) || grant.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    return { association: structuredClone(command.association), callId: command.callId, sceneCode: command.sceneCode,
      model: command.association.config.model, actorId: before.gateway.actorId,
      quantity: { unit: 'calls' as const, value: 1 }, policies, consumerScope: policies[2], expiresAt,
      evidenceHash: requestFingerprint({ method: 'ai-count-tokens-admission-1', invocationId: row.id,
        registrationHash: row.registrationHash, countCallId: command.callId,
        association: command.association, policies }) };
  }
}

/** Counting dispatch/usage evidence from the persisted reservation and the
 * immutable count receipt. Missing receipts never become zero usage. */
export class InputCountTokensEvidence implements BudgetEvidencePort {
  private readonly receipts;
  private readonly reservationDb;
  constructor(db: CountTokensAdmissionDb) {
    this.receipts = new PrismaCountTokensReceipts(db);
    this.reservationDb = db;
  }
  private async reservation(record: Readonly<BudgetRecord>) {
    const row = await this.reservationDb.aiBudgetReservation.findUnique({ where: { id: record.id } });
    const association = record.association;
    if (!row || row.id !== record.id || row.scopeId !== record.scopeId || row.scopeKind !== 'WORKSPACE'
      || record.scopeKind !== 'WORKSPACE' || association.scope.kind !== 'workspace'
      || row.actorId !== record.actorId || row.callId !== record.callId || row.sceneCode !== record.sceneCode
      || row.tenantId !== association.scope.tenantId || row.workspaceId !== association.scope.workspaceId
      || row.requestId !== association.requestId || row.idempotencyKey !== association.idempotencyKey
      || row.runId !== association.runId || row.stepId !== association.stepId || row.actionId !== association.actionId
      || row.priceVersion !== association.priceVersion || row.unitKind !== 'calls'
      || record.reserved.unit !== 'calls' || record.reserved.value !== 1 || row.reservedCalls !== 1
      || !isGatewayConfig(association.config) || row.configurationHash !== requestFingerprint(association.config)
      || row.configRevision !== association.config.configRevision) throw new BudgetError('FORBIDDEN');
    return row;
  }
  async dispatch(record: Readonly<BudgetRecord>): Promise<'not_dispatched' | 'dispatched' | 'unknown'> {
    const row = await this.reservation(record);
    return row.dispatchState === 'not_dispatched' ? 'not_dispatched' : row.dispatchState === 'unknown' ? 'unknown' : 'dispatched';
  }
  async usage(record: Readonly<BudgetRecord>, evidenceRef: string, _reconcile: boolean): Promise<BudgetUsageEvidence> {
    if (!hash64.safeParse(evidenceRef).success) throw new BudgetError('INVALID');
    const read = async () => {
      const row = await this.reservation(record), receipt = await this.receipts.read(evidenceRef);
      const invocation = await this.reservationDb.aiGatewayInvocation.findFirst({ where: {
        scopeId: row.scopeId, stepId: row.stepId, id: receipt.invocationId }, select: {
        id: true, scopeId: true, taskId: true, runId: true, stepId: true, actionId: true, actorId: true,
        callId: true, configuration: true, configurationHash: true, registrationHash: true,
        intentHash: true, priceVersion: true, maxOutputTokens: true, sceneCode: true } });
      // A terminal label alone is not usage evidence. Bind the original count
      // claim, reservation and immutable generation registration; expiry/new
      // pricing are irrelevant to accounting for an already observed request.
      if (!['observed', 'failed'].includes(receipt.state) || !invocation
        || !['dispatched', 'completed', 'unknown'].includes(row.dispatchState)
        || row.status === 'released' || receipt.scopeId !== row.scopeId
        || receipt.tenantId !== row.tenantId || receipt.workspaceId !== row.workspaceId
        || receipt.countCallId !== row.callId || receipt.actorId !== row.actorId
        || receipt.admission.reservationId !== row.id || receipt.admission.sceneCode !== row.sceneCode
        || invocation.id !== receipt.invocationId || invocation.scopeId !== row.scopeId
        || invocation.actorId !== row.actorId || invocation.runId !== row.runId
        || invocation.stepId !== row.stepId || invocation.actionId !== row.actionId
        || receipt.callId !== invocation.callId || countTokensCallId(invocation.callId) !== row.callId
        || countTokensSceneCode(invocation.sceneCode) !== row.sceneCode || receipt.sceneCode !== invocation.sceneCode
        || receipt.registrationHash !== invocation.registrationHash || receipt.intentHash !== invocation.intentHash
        || receipt.configurationHash !== invocation.configurationHash || receipt.priceVersion !== invocation.priceVersion
        || receipt.maxOutputTokens !== invocation.maxOutputTokens || !isGatewayConfig(invocation.configuration)
        || requestFingerprint(invocation.configuration) !== row.configurationHash
        || receipt.model !== invocation.configuration.model || receipt.protocol !== invocation.configuration.protocol
        || !await this.receipts.hasDispatchClaim({ tenantId: receipt.tenantId, workspaceId: receipt.workspaceId,
          actorId: receipt.actorId, callId: receipt.callId, reservationId: row.id,
          registrationHash: receipt.registrationHash, intentHash: receipt.intentHash,
          configurationHash: receipt.configurationHash, countRequestHash: receipt.countRequestHash }))
        throw new BudgetError('UNAVAILABLE');
      return { receipt, invocation };
    };
    const before = await read(), after = await read();
    if (requestFingerprint(before) !== requestFingerprint(after)) throw new BudgetError('PENDING_RECONCILIATION');
    return { quantity: { unit: 'calls' as const, value: 1 },
      ...(before.receipt.inputTokens !== undefined ? { inputTokens: before.receipt.inputTokens } : {}),
      evidenceHash: countTokensReceiptDocumentHash(before.receipt) };
  }
}
