import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiScopeRepository } from '../ai-scope.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { modelRequestSchema, type ModelUsage } from '../model-gateway.ports';
import { gatewayPlatformBudgetPrincipal } from '../budget/gateway-budget-principal';
import { BudgetError, type BudgetAction, type BudgetGrant, type BudgetPolicyKey, type BudgetQuotePort, type BudgetRecord, type BudgetReserveCommand } from '../budget/budget.ports';
import { validateBudgetSettings } from '../budget/budget-settings';
import type { BudgetAuthorizationSource, BudgetEntitlementSource } from '../budget/budget-dependency-adapters';
import type { GatewayActualUsagePricing } from '../budget/prisma-gateway-accounting-facts';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import { TEXT_PROBE_SCENE } from '../text-capability-probe';
import { PLATFORM_AI_PROVIDER_PERMISSIONS } from '../../../common/platform-ai-access-policy';

const identity = (context: AiExecutionContext) => {
  const { requestId: _id, authorizedAt: _at, ...value } = context;
  return requestFingerprint(value);
};
const actions = ['settings_read', 'settings_write', 'reserve', 'dispatch', 'read', 'settle', 'release', 'unknown', 'reconcile'];
const code = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/** Financial authorization for platform-owned calls. The current platform
 * identity, the platform invocation binding and the platform scope's own task
 * action policy are all mandatory; no tenant subscription, workspace policy
 * or entitled constant is consulted or fabricated. */
export class PlatformBudgetAuthorizationSource implements BudgetAuthorizationSource {
  private readonly bindings;
  constructor(private readonly input: { db: PrismaClient; scopes: Pick<AiScopeRepository, 'resolveCurrent'>; clock?: () => Date },
    bindings?: PrismaGatewayInvocationBindings) {
    if (typeof input?.scopes?.resolveCurrent !== 'function' || typeof input.db?.$transaction !== 'function') throw new BudgetError('UNAVAILABLE');
    this.bindings = bindings ?? new PrismaGatewayInvocationBindings(input.db, input.scopes, input.clock);
  }
  async resolveContext() { return (await this.input.scopes.resolveCurrent()).context; }
  async authorize(action: BudgetAction, value: Readonly<AiExecutionContext>, resourceValue: Readonly<Record<string, unknown>>) {
    if (!actions.includes(action)) throw new BudgetError('FORBIDDEN');
    const context = structuredClone(value), resource = structuredClone(resourceValue);
    const before = await this.input.scopes.resolveCurrent();
    const principal = gatewayPlatformBudgetPrincipal(before.context);
    if (identity(context) !== identity(before.context) || context.actor.kind !== 'saas_admin' || context.scope.kind !== 'platform'
      || before.scope.kind !== 'PLATFORM'
      || context.actor.userId !== principal.actorId) throw new BudgetError('FORBIDDEN');
    // Base identity may be read-only. A task policy can narrow a financial
    // action, but cannot turn that read identity into platform management.
    // Enforce it here too: non-HTTP/internal callers must retain the boundary.
    if (action !== 'read' && action !== 'settings_read'
      && (!('permissions' in context) || !Array.isArray(context.permissions)
        || !context.permissions.includes(PLATFORM_AI_PROVIDER_PERMISSIONS.manage))) throw new BudgetError('FORBIDDEN');
    const gatewayContext = { actorId: principal.actorId };
    const clock = this.input.clock ?? (() => new Date());
    let proof: unknown;
    if (action === 'settings_read' || action === 'settings_write') {
      // The platform budget settings host owns writes through its own Guard;
      // this branch serves policy reads with the same platform policy key.
      const policy = resource.policy as { scopeKind?: unknown; scopeId?: unknown; sceneCode?: unknown } | undefined;
      if (!policy || policy.scopeKind !== 'PLATFORM' || policy.scopeId !== before.scope.id
        || typeof policy.sceneCode !== 'string' || !code.test(policy.sceneCode)) throw new BudgetError('FORBIDDEN');
      proof = { policy };
    } else {
      const association = resource.association as Record<string, unknown> | undefined;
      if (!association || typeof association.requestId !== 'string' || !code.test(association.requestId)
        || requestFingerprint(association.scope) !== requestFingerprint(context.scope)) throw new BudgetError('FORBIDDEN');
      const row = await this.input.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
        scopeId: before.scope.id, callId: association.requestId } } });
      if (!row || row.scopeId !== before.scope.id || row.actorId !== principal.actorId
        || row.sceneCode !== TEXT_PROBE_SCENE || !isGatewayConfig(row.configuration)) throw new BudgetError('FORBIDDEN');
      const dispatching = action === 'reserve' || action === 'dispatch';
      const binding = dispatching ? await this.bindings.resolveForReserve(gatewayContext, {
        callId: row.callId, model: row.configuration.model, maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash,
      }) : typeof resource.reservationId === 'string'
        ? await this.bindings.resolveForReservation(gatewayContext, resource.reservationId) : null;
      if (!binding || requestFingerprint(binding.association) !== requestFingerprint(association)
        || binding.actorId !== principal.actorId || binding.sceneCode !== row.sceneCode) throw new BudgetError('FORBIDDEN');
      // Recovery needs the original terminal-read policy as well as today's
      // independent management permission above. It does not require the old
      // new-execution policy or enable reserve/dispatch after shutdown.
      const operation = dispatching ? 'transition_task' : 'read_step_terminal';
      const policyRow = await this.input.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: {
        scopeId: before.scope.id, taskId: row.taskId, operation } } });
      if (!policyRow || policyRow.scopeId !== before.scope.id || policyRow.taskId !== row.taskId || policyRow.operation !== operation
        || !Number.isSafeInteger(policyRow.revision) || policyRow.revision < 1 || !(policyRow.expiresAt instanceof Date)
        || !Number.isFinite(policyRow.expiresAt.getTime()) || policyRow.expiresAt <= clock()
        || !Array.isArray(policyRow.requiredPermissions) || policyRow.requiredPermissions.length === 0
        // The SaaS platform context carries its permission list at the top
        // level (no `access` member); an absent or non-array list fails closed.
        || !('permissions' in context) || !Array.isArray(context.permissions)
        || policyRow.requiredPermissions.some(permission => typeof permission !== 'string'
          || !context.permissions.includes(permission))) throw new BudgetError('FORBIDDEN');
      proof = { invocationId: row.id, registrationHash: row.registrationHash, configurationHash: row.configurationHash,
        association: binding.association, reservationId: resource.reservationId ?? null,
        policy: { revision: policyRow.revision, permissions: policyRow.requiredPermissions, expiresAt: policyRow.expiresAt.toISOString() } };
    }
    const after = await this.input.scopes.resolveCurrent();
    if (after.scope.id !== before.scope.id || identity(after.context) !== identity(context)) throw new BudgetError('FORBIDDEN');
    return { authorizationKey: `platform-budget:${requestFingerprint({ action, identity: identity(context), proof })}`,
      expiresAt: new Date(clock().getTime() + 5000) };
  }
}

/** Platform commercial admission = the current PLATFORM policy itself. A
 * missing, disabled, zero or non-limited policy denies NEW usage while the
 * original lifecycle keeps its own separate grant above. */
export class PlatformPolicyEntitlementSource implements BudgetEntitlementSource {
  constructor(private readonly db: Pick<PrismaClient, 'aiBudgetPolicy'> & Pick<PrismaClient, 'aiScope'>,
    private readonly sceneCode: string = TEXT_PROBE_SCENE, private readonly clock: () => Date = () => new Date()) {}
  async #platformScopeId() {
    const row = await this.db.aiScope.findFirst({ where: { kind: 'PLATFORM' }, select: { id: true } });
    if (!row?.id) throw new BudgetError('UNAVAILABLE');
    return row.id;
  }
  async check(context: Readonly<AiExecutionContext>, featureCode: string) {
    if (featureCode !== 'ai.native.platform.probe' || context.scope?.kind !== 'platform' || context.actor?.kind !== 'saas_admin') {
      throw new BudgetError('FORBIDDEN');
    }
    const row = await this.db.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: {
      scopeId: await this.#platformScopeId(), scopeKind: 'PLATFORM', sceneCode: this.sceneCode } },
      select: { configRevision: true, enabled: true, settingsJson: true } });
    if (!row || !Number.isSafeInteger(row.configRevision) || row.configRevision < 1) throw new BudgetError('UNAVAILABLE');
    // Same canonical validation as the persisted-settings writers, so this
    // read-side admission can never be looser than the write-side schema.
    const settings = structuredClone(row.settingsJson) as unknown as import('@rental-os/shared').AiUsageSettingsDraft;
    validateBudgetSettings(settings);
    const admitted = row.enabled === true
      && Object.values(settings.gates ?? {}).every(gate => gate?.enabled === true)
      && settings.budget?.state === 'limited'
      && Array.isArray(settings.allowedScenes) && settings.allowedScenes.includes(this.sceneCode)
      && settings.maxConcurrent > 0 && settings.maxCallsPerRun > 0;
    return { available: admitted === true, revision: row.configRevision };
  }
}

/** Explicit platform calls pricing: the single PLATFORM policy layer must be
 * configured for calls at the trusted price version. Actual usage counts one
 * original invocation; calls are never a token or monetary bound. */
export class PlatformGatewayCallPricing implements BudgetQuotePort, GatewayActualUsagePricing {
  private readonly bindings;
  constructor(private readonly db: ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0]
    & Pick<PrismaClient, 'aiBudgetPolicy' | 'aiBudgetReservation' | 'aiScope'>, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly priceVersion: string, private readonly clock: () => Date = () => new Date()) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(priceVersion)
      || typeof db?.aiBudgetPolicy?.findFirst !== 'function') throw new BudgetError('UNAVAILABLE');
    this.bindings = new PrismaGatewayInvocationBindings(db, scopes, clock);
  }
  private async current() {
    const result = structuredClone(await this.scopes.resolveCurrent());
    const principal = gatewayPlatformBudgetPrincipal(result.context);
    if (result.scope.kind !== 'PLATFORM') throw new BudgetError('FORBIDDEN');
    return { ...result, gateway: { actorId: principal.actorId } };
  }
  async quote(value: Readonly<BudgetReserveCommand>, grantValue: Readonly<BudgetGrant>) {
    const command = structuredClone(value), grant = structuredClone(grantValue), before = await this.current();
    if (!grant.entitled || identity(grant.context) !== identity(before.context)
      || command.association.priceVersion !== this.priceVersion || command.callId !== command.association.requestId) throw new BudgetError('FORBIDDEN');
    const row = await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
      scopeId: before.scope.id, callId: command.callId } } });
    if (!row || row.scopeId !== before.scope.id || row.actorId !== before.gateway.actorId || row.sceneCode !== command.sceneCode) throw new BudgetError('FORBIDDEN');
    const binding = structuredClone(await this.bindings.resolveForReserve(before.gateway, {
      callId: row.callId, model: command.association.config.model, maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash,
    }));
    if (requestFingerprint(binding.association) !== requestFingerprint(command.association)) throw new BudgetError('FORBIDDEN');
    const key: BudgetPolicyKey = { scopeKind: 'PLATFORM', scopeId: before.scope.id, sceneCode: row.sceneCode };
    const policy = await this.db.aiBudgetPolicy.findFirst({ where: key });
    if (!policy || policy.scopeKind !== key.scopeKind || policy.scopeId !== key.scopeId || policy.sceneCode !== key.sceneCode) throw new BudgetError('UNAVAILABLE');
    // Only an explicitly stored priceVersion mismatch rejects here: the
    // policy column is nullable and the trusted price version travels on the
    // association, which the caller checks against this.priceVersion above.
    if (policy.unitKind !== 'calls' || policy.priceVersion && policy.priceVersion !== this.priceVersion) throw new BudgetError('UNAVAILABLE');
    const after = await this.current();
    if (before.scope.id !== after.scope.id || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    const expiresAt = new Date(Math.min(command.expiresAt.getTime(), binding.expiresAt.getTime()));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= this.clock()
      || !(grant.expiresAt instanceof Date) || grant.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    return { association: binding.association, callId: row.callId, sceneCode: row.sceneCode,
      model: command.association.config.model, actorId: binding.actorId, quantity: { unit: 'calls' as const, value: 1 },
      policies: [key], consumerScope: key, expiresAt,
      evidenceHash: requestFingerprint({ method: 'original-invocation-call-1', priceVersion: this.priceVersion,
        invocationId: row.id, registrationHash: row.registrationHash, association: binding.association, policies: [key] }) };
  }
  /** Actual original invocation count after dispatch/usage evidence checks. */
  async quantity(value: Readonly<BudgetRecord>, usageValue: Readonly<ModelUsage>) {
    const record = structuredClone(value), usage = structuredClone(usageValue), before = await this.current();
    if (!record.dispatched || record.reserved.unit !== 'calls' || record.reserved.value !== 1
      || record.actorId !== before.gateway.actorId
      || ![usage.inputTokens, usage.outputTokens].every(count => Number.isSafeInteger(count) && count >= 0)) throw new BudgetError('UNAVAILABLE');
    const binding = await this.bindings.resolveForReservation(before.gateway, record.id);
    if (requestFingerprint(binding.association) !== requestFingerprint(record.association)) throw new BudgetError('FORBIDDEN');
    const stored = await this.db.aiBudgetReservation.findFirst({ where: { id: record.id, scopeId: before.scope.id,
      scopeKind: 'PLATFORM', actorId: before.gateway.actorId, callId: record.callId } });
    if (!stored || stored.unitKind !== 'calls' || stored.reservedCalls !== 1
      || stored.priceVersion !== record.association.priceVersion || stored.dispatchState === 'not_dispatched') throw new BudgetError('UNAVAILABLE');
    const after = await this.current();
    if (before.scope.id !== after.scope.id || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    return { unit: 'calls' as const, value: 1 };
  }
}

export function platformModelRequestGuard(model: string) {
  if (!modelRequestSchema.shape.model.safeParse(model).success) throw new BudgetError('INVALID');
}
