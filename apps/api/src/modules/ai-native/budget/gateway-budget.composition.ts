import type { AiScopeRepository } from '../ai-scope.repository';
import type { PrismaClient } from '@prisma/client';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { BudgetError, type BudgetQuotePort, type BudgetPolicyKey } from './budget.ports';
import type { AiUsageSettingsDraft } from '@rental-os/shared';
import { z } from 'zod';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { validateBudgetSettings, presentBudgetSettingsFields } from './budget-settings';
import type { BudgetAuthorizationSource, BudgetEntitlementSource } from './budget-dependency-adapters';
import { PersistedBudgetEvidenceAdapter, ServerBudgetAuthorityAdapter } from './budget-dependency-adapters';
import { BudgetGatewayAdapter } from './budget-gateway-adapter';
import { createPersistedBudgetSubsystem } from './budget.module';
import { BudgetService } from './budget.service';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { PersistentGatewayBudget } from './persistent-gateway-budget';
import { PrismaGatewayAccountingFacts, type GatewayActualUsagePricing } from './prisma-gateway-accounting-facts';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { PrismaTaskBudgetAuthorizationSource } from './prisma-task-budget-authorization.source';
import { PrismaClientTaskBudgetAuthorizationSource } from './prisma-client-task-budget-authorization.source';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { PrismaGatewayRecordedPricing } from './prisma-gateway-recorded-pricing';
import { budgetSettingsOperationSchema, budgetSettingsReceiptSchema, settingsOperationId } from './budget-settings-operation';
import { GatewayPricingRecordManagement, type GatewayPricingEvidenceSource } from './prisma-gateway-pricing-records';

export function createPersistedGatewayBudget(input: {
  db: ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0] & ConstructorParameters<typeof PrismaGatewayAccountingFacts>[0]
    & Partial<Pick<PrismaClient, 'operationLog'>>;
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  authorization: BudgetAuthorizationSource;
  /** Optional composition-owned entitlement source. The SaaS platform passes
   * its own policy gate; absent keeps the tenant subscription adapter. */
  entitlements?: BudgetEntitlementSource;
  /** Feature code handed to the entitlement source above. */
  entitlementFeatureCode?: string;
  pricing: BudgetQuotePort & GatewayActualUsagePricing;
  clock?: () => Date;
}) {
  const bindings = new PrismaGatewayInvocationBindings(input.db, input.scopes, input.clock);
  const facts = new PrismaGatewayAccountingFacts(input.db, bindings, input.scopes, input.pricing, input.clock);
  const service = input.entitlements
    ? new BudgetService(new PrismaBudgetRepository(input.db, input.clock),
      new ServerBudgetAuthorityAdapter(input.authorization, input.entitlements, input.entitlementFeatureCode),
      input.pricing, new PersistedBudgetEvidenceAdapter(facts), input.clock)
    : createPersistedBudgetSubsystem({ db: input.db, subscriptions: input.subscriptions, authorization: input.authorization,
      quotes: input.pricing, evidence: new PersistedBudgetEvidenceAdapter(facts), clock: input.clock });
  const selector = z.object({ scope: z.enum(['tenant', 'workspace']),
    sceneCode: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const write = selector.extend({ expectedRevision: z.number().int().min(0).max(4294967294), settings: z.unknown(),
    operation: budgetSettingsOperationSchema.pick({ operationKey: true, action: true, commandHash: true }).optional() }).strict();
  const identity = (value: Awaited<ReturnType<typeof input.scopes.resolveCurrent>>) => {
    const { requestId: _, authorizedAt: __, ...context } = value.context;
    return requestFingerprint({ context, scope: value.scope });
  };
  const target = async (value: z.infer<typeof selector>) => {
    const current = structuredClone(await input.scopes.resolveCurrent());
    if (current.context.actor.kind !== 'user' || current.context.audience !== 'operator'
      || current.context.scope.kind !== 'workspace' || current.scope.kind !== 'WORKSPACE'
      || current.context.scope.tenantId !== current.scope.tenantId
      || current.context.scope.workspaceId !== current.scope.workspaceId) throw new BudgetError('FORBIDDEN');
    const tenantId = current.context.scope.tenantId;
    const columns = aiPersistenceScopeColumns(value.scope === 'tenant' ? { kind: 'tenant', tenantId } : current.context.scope);
    const row = await input.db.aiScope.findFirst({ where: columns });
    if (!row || Object.entries(columns).some(([key, item]) => row[key as keyof typeof row] !== item)) throw new BudgetError('UNAVAILABLE');
    const key: BudgetPolicyKey = { scopeKind: columns.kind, scopeId: row.id, sceneCode: value.sceneCode };
    const recheck = async () => {
      if (identity(current) !== identity(structuredClone(await input.scopes.resolveCurrent()))) throw new BudgetError('FORBIDDEN');
    };
    await recheck();
    return { key, tenantId, context: current.context, recheck };
  };
  // Management consumers use the SAME service/repository/entitlement as the
  // financial lifecycle. These are internal server methods, not public DTOs
  // or a client-supplied scope ID. Platform policy remains platform-owned.
  const readSettings = async (value: unknown) => {
    const parsed = selector.safeParse(value);
    if (!parsed.success) throw new BudgetError('INVALID');
    const current = await target(parsed.data);
    const policy = await service.settings(current.key);
    await current.recheck();
    if (policy && (policy.scopeId !== current.key.scopeId || policy.scopeKind !== current.key.scopeKind
      || policy.sceneCode !== current.key.sceneCode || policy.settings.sceneCode !== current.key.sceneCode
      || policy.settings.scope.kind !== 'tenant' || policy.settings.scope.tenantId !== current.tenantId)) throw new BudgetError('FORBIDDEN');
    return policy;
  };
  const settings = Object.freeze({
    read: readSettings,
    readOperation: async (value: unknown) => {
      const parsed = selector.extend({ operationKey: budgetSettingsOperationSchema.shape.operationKey }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const { operationKey, ...selection } = parsed.data, current = await target(selection), context = current.context;
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw new BudgetError('FORBIDDEN');
      // Observation uses current read permission, not a live Profile, write
      // permission or permission to admit a new model call.
      await readSettings(selection);
      if (typeof input.db.operationLog?.findFirst !== 'function') throw new BudgetError('UNAVAILABLE');
      const row = structuredClone(await input.db.operationLog.findFirst({ where: { id: settingsOperationId(current.key, operationKey),
        tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, userId: context.actor.userId,
        action: 'ai.budget.settings.saved' }, select: { id: true, tenantId: true, workspaceId: true, userId: true,
          action: true, detail: true, createdAt: true } }));
      await readSettings(selection); await current.recheck();
      const base = { ...selection, operationKey, admission: 'not_granted' as const, automaticRetry: false as const };
      if (!row || row.tenantId !== context.scope.tenantId || row.workspaceId !== context.scope.workspaceId
        || row.userId !== context.actor.userId) return { ...base, state: 'unknown' as const };
      const detail = budgetSettingsReceiptSchema.safeParse(row.detail);
      if (row.action !== 'ai.budget.settings.saved' || !detail.success || row.id !== settingsOperationId(current.key, operationKey)
        || detail.data.operationKey !== operationKey || detail.data.scopeKind !== current.key.scopeKind
        || detail.data.scopeId !== current.key.scopeId || detail.data.sceneCode !== current.key.sceneCode
        || detail.data.tenantId !== row.tenantId || detail.data.workspaceId !== row.workspaceId || detail.data.actorId !== row.userId
        || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) throw new BudgetError('UNAVAILABLE');
      return { ...base, state: 'recorded' as const, action: detail.data.action, expectedRevision: detail.data.expectedRevision,
        savedRevision: detail.data.savedRevision, commandHash: detail.data.commandHash, recordedAt: row.createdAt.toISOString() };
    },
    /** Tenant-facing data projection, not a model capability/dispatch grant.
     * The raw read above remains an internal server management result. */
    summary: async (value: unknown) => {
      const parsed = selector.safeParse(value);
      if (!parsed.success) throw new BudgetError('INVALID');
      const policy = await readSettings(parsed.data);
      const base = { scope: parsed.data.scope, sceneCode: parsed.data.sceneCode, admission: 'not_granted' as const };
      if (!policy) return { ...base, state: 'not_configured' as const, revision: null, settings: null, modelPolicy: null };
      const stored = policy.settings;
      if (!isGatewayConfig(stored.config)) throw new BudgetError('UNAVAILABLE');
      if (stored.scope.kind !== 'tenant' || !('tenantId' in stored.config)
        || stored.config.tenantId !== stored.scope.tenantId) throw new BudgetError('FORBIDDEN');
      return { ...base, state: 'configured' as const, revision: policy.revision,
        settings: presentBudgetSettingsFields(stored),
        // Platform provider/model/credential metadata must not reach tenant UI,
        // including through an allowedModels whitelist used internally.
        modelPolicy: stored.config.serviceMode === 'platform_managed'
          ? { mode: 'platform_managed' as const, serviceName: 'Rental OS AI' as const, selection: 'managed_by_platform' as const }
          : { mode: 'tenant_managed' as const, allowedModels: [...stored.allowedModels] },
        configurationMeaning: 'saved_policy_reference_not_current_selection' as const };
    },
    save: async (value: unknown, revalidateSelection?: () => Promise<void>) => {
      const parsed = write.safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const command = parsed.data, proposed = command.settings as AiUsageSettingsDraft;
      validateBudgetSettings(proposed);
      if (!isGatewayConfig(proposed.config) || proposed.sceneCode !== command.sceneCode) throw new BudgetError('INVALID');
      const current = await target(command);
      if (proposed.scope.kind !== 'tenant' || proposed.scope.tenantId !== current.tenantId
        || !('tenantId' in proposed.config) || proposed.config.tenantId !== current.tenantId
        || (proposed.config.serviceMode === 'platform_managed'
          ? proposed.config.configurationScope.kind !== 'platform' : proposed.config.configurationScope.kind !== 'tenant')
        || (proposed.config.configurationScope.kind === 'tenant'
          && proposed.config.configurationScope.tenantId !== current.tenantId)) throw new BudgetError('FORBIDDEN');
      // Authorize the original management action before reading profile facts.
      const grant = await input.authorization.authorize('settings_write',
        structuredClone(await input.authorization.resolveContext()), { policy: current.key });
      if (!grant) throw new BudgetError('FORBIDDEN');
      const revalidateConfiguration = async () => {
        await revalidateSelection?.();
        const ownerColumns = aiPersistenceScopeColumns(proposed.config.configurationScope);
        const owner = await input.db.aiScope.findFirst({ where: ownerColumns });
        const profile = await input.db.aiProviderProfile.findFirst({ where: { id: proposed.config.configId,
          configRevision: proposed.config.configRevision } });
        if (!owner || Object.entries(ownerColumns).some(([key, item]) => owner[key as keyof typeof owner] !== item)
          || !profile || profile.id !== proposed.config.configId || profile.configRevision !== proposed.config.configRevision
          || profile.scopeId !== owner.id || profile.scopeKind !== owner.kind
          || profile.serviceMode !== proposed.config.serviceMode || profile.model !== proposed.config.model
          || profile.provider !== proposed.config.provider || profile.protocol !== proposed.config.protocol
          || profile.credentialRef !== proposed.config.credentialRef) throw new BudgetError('FORBIDDEN');
        await current.recheck();
      };
      await revalidateConfiguration();
      const context = current.context;
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw new BudgetError('FORBIDDEN');
      const saved = await service.saveSettings(current.key, proposed, command.expectedRevision, revalidateConfiguration,
        command.operation && { ...command.operation, tenantId: context.scope.tenantId,
          workspaceId: context.scope.workspaceId, actorId: context.actor.userId });
      // If current identity changed after COMMIT, do not disclose the saved
      // policy or pretend that the write was rolled back.
      try { await current.recheck(); } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      return saved;
    }
  });
  const recoveryCommand = z.object({ reservationId: z.string().min(1).max(36)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const originalCallCommand = z.object({ callId: z.string().min(1).max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const originalReservation = async (value: unknown) => {
    const parsed = recoveryCommand.safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const before = structuredClone(await input.scopes.resolveCurrent());
    const { actorKind: _, ...context } = gatewayBudgetPrincipal(before.context);
    const binding = structuredClone(await bindings.resolveForReservation(context, parsed.data.reservationId));
    const record = await service.read(parsed.data.reservationId, binding.association);
    return { before, binding, record, reservationId: parsed.data.reservationId };
  };
  const recovery = Object.freeze({
    /** A reserve/link acknowledgement can be lost before its reservation ID
     * reaches the host. Find only that original call's existing reservation;
     * no result here attests dispatch, usage or permission to reserve again. */
    readCall: async (value: unknown) => {
      const parsed = originalCallCommand.safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const before = structuredClone(await input.scopes.resolveCurrent());
      const principal = gatewayBudgetPrincipal(before.context);
      if (before.scope.kind !== 'WORKSPACE' || before.scope.tenantId !== principal.tenantId
        || before.scope.workspaceId !== principal.workspaceId) throw new BudgetError('FORBIDDEN');
      const row = structuredClone(await input.db.aiBudgetReservation.findUnique({ where: {
        scopeId_scopeKind_callId: { scopeId: before.scope.id, scopeKind: 'WORKSPACE', callId: parsed.data.callId }
      }, select: { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, actorId: true, callId: true } }));
      // Absence is not proof of no consumption. In particular, do not perform
      // a replacement reserve after a lost COMMIT response or a missing link.
      if (!row) throw new BudgetError('PENDING_RECONCILIATION');
      if (row.scopeId !== before.scope.id || row.scopeKind !== 'WORKSPACE'
        || row.tenantId !== principal.tenantId || row.workspaceId !== principal.workspaceId
        || row.actorId !== principal.actorId || row.callId !== parsed.data.callId) throw new BudgetError('FORBIDDEN');
      const { record } = await originalReservation({ reservationId: row.id });
      if (record.id !== row.id || record.callId !== parsed.data.callId
        || identity(before) !== identity(await input.scopes.resolveCurrent())) throw new BudgetError('FORBIDDEN');
      return structuredClone(record);
    },
    /** Read the original balance/status after an uncertain response. This is
     * not a proof of no consumption and never starts or settles a call. */
    read: async (value: unknown) => {
      const { before, record } = await originalReservation(value);
      if (identity(before) !== identity(await input.scopes.resolveCurrent())) throw new BudgetError('FORBIDDEN');
      return structuredClone(record);
    },
    /** Exact existing recovery event; read never delegates to release/reconcile.
     * Terminal current state alone cannot attest which original operation committed. */
    readOperation: async (value: unknown) => {
      const parsed = recoveryCommand.extend({ operation: z.enum(['releaseUnsent', 'reconcile']) }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new BudgetError('INVALID');
      const { before, binding, record: current, reservationId } = await originalReservation({ reservationId: parsed.data.reservationId });
      const evidenceRef = parsed.data.operation === 'reconcile' ? await facts.originalUsageReference(reservationId) : undefined;
      const eventKey = requestFingerprint(parsed.data.operation === 'releaseUnsent'
        ? { method: 'persisted-original-unsent-release-1', reservationId, association: binding.association }
        : { method: 'persisted-original-usage-reconcile-1', reservationId, evidenceRef, association: binding.association });
      const record = await service.readMutation(reservationId, binding.association, {
        action: parsed.data.operation === 'releaseUnsent' ? 'release' : 'reconcile', eventKey, evidenceRef });
      if (identity(before) !== identity(await input.scopes.resolveCurrent())) throw new BudgetError('FORBIDDEN');
      if (record && (record.id !== current.id || record.callId !== current.callId)) throw new BudgetError('FORBIDDEN');
      return { operation: parsed.data.operation, status: record ? 'observed' as const : 'not_observed' as const, record };
    },
    /** Complete only a previously persisted NOT-SENT cancellation. Neither
     * expiry nor a failed provider request is evidence permitting a refund. */
    releaseUnsent: async (value: unknown) => {
      const { before, binding, record: original, reservationId } = await originalReservation(value);
      const dispatch = await facts.readDispatch(reservationId);
      if (dispatch.state !== 'not_dispatched' || original.dispatched
        || !['reserved', 'released'].includes(original.status)) throw new BudgetError('PENDING_RECONCILIATION');
      let record;
      try {
        record = original.status === 'released' ? await service.read(reservationId, binding.association)
          : await service.release(reservationId, binding.association, requestFingerprint({
            method: 'persisted-original-unsent-release-1', reservationId, association: binding.association }));
      } catch (error) {
        if (error instanceof BudgetError) throw error;
        throw new BudgetError('PENDING_RECONCILIATION');
      }
      try {
        if (identity(before) !== identity(await input.scopes.resolveCurrent()) || record.id !== reservationId
          || record.status !== 'released' || record.dispatched) throw new BudgetError('PENDING_RECONCILIATION');
      } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      return structuredClone(record);
    },
    /** Server-only explicit recovery, not a background sweep or a new dispatch.
     * Auth, entitlement and original usage are rechecked by the existing service.
     * A lost mutation response stays unknown; never retry the write here. */
    reconcile: async (value: unknown) => {
      const { before, binding, record: original, reservationId } = await originalReservation(value);
      const evidenceRef = await facts.originalUsageReference(reservationId);
      // Stable original-operation event across process restarts. The repository
      // also compares the actual evidence payload on same-key replay.
      const eventKey = requestFingerprint({ method: 'persisted-original-usage-reconcile-1', reservationId,
        evidenceRef, association: binding.association });
      let record;
      try {
        if (original.status === 'settled') {
          // A prior settle/reconcile COMMIT may have succeeded even if its
          // acknowledgement was lost. Observe it, don't invent another event.
          const evidence = await facts.readUsage(reservationId, evidenceRef, true);
          record = await service.read(reservationId, binding.association);
          if (record.status !== 'settled' || requestFingerprint(record.actual) !== requestFingerprint(evidence.quantity)) {
            throw new BudgetError('PENDING_RECONCILIATION');
          }
        } else {
          record = await service.reconcile(reservationId, binding.association, eventKey, evidenceRef);
        }
      }
      catch (error) {
        if (error instanceof BudgetError) throw error;
        throw new BudgetError('PENDING_RECONCILIATION');
      }
      try {
        const after = await input.scopes.resolveCurrent();
        if (identity(before) !== identity(after) || record.id !== reservationId || record.status !== 'settled'
          || record.actual === null) throw new BudgetError('PENDING_RECONCILIATION');
      } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      return structuredClone(record);
    }
  });
  return { bindings, facts, settings, recovery, budget: new PersistentGatewayBudget(new BudgetGatewayAdapter(service, bindings), facts) };
}

type RecordedPricingAccountingDependencies =
  Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'pricing'>
  & { db: ConstructorParameters<typeof PrismaGatewayRecordedPricing>[0] };

function recordedPricingRecovery(gateway: ReturnType<typeof createPersistedGatewayBudget>, pricing: PrismaGatewayRecordedPricing) {
  const readPricing = async (value: unknown, readOriginal: typeof gateway.recovery.read) => {
    const command = structuredClone(value);
    const original = await readOriginal(command);
    const basis = await pricing.receipt(original);
    const current = await readOriginal(command);
    if (requestFingerprint(original) !== requestFingerprint(current)) throw new BudgetError('PENDING_RECONCILIATION');
    const latest = await pricing.receipt(current);
    if (requestFingerprint(basis) !== requestFingerprint(latest)) throw new BudgetError('PENDING_RECONCILIATION');
    const confirmed = await readOriginal(command);
    if (requestFingerprint(current) !== requestFingerprint(confirmed)) throw new BudgetError('PENDING_RECONCILIATION');
    return { ...basis, reservationStatus: confirmed.status, configurationRevision: confirmed.association.config.configRevision,
      dispatched: confirmed.dispatched, recordedActualQuantity: confirmed.actual };
  };
  return Object.freeze({ ...gateway.recovery,
    readPricing: (value: unknown) => readPricing(value, gateway.recovery.read),
    readPricingCall: (value: unknown) => readPricing(value, gateway.recovery.readCall)
  });
}

/** Original stored pricing only: no new-price/input-bound producer, model
 * connection or execution gate is required. Current accounting authorization
 * and same-ledger binding still apply; this never publishes new evidence. */
export function createRecordedPricingGatewayAccountingRecovery(input: RecordedPricingAccountingDependencies) {
  const pricing = new PrismaGatewayRecordedPricing(input.db, input.scopes, input.clock);
  const gateway = createPersistedGatewayBudget({ ...input, pricing });
  return recordedPricingRecovery(gateway, pricing);
}

export function createRecordedPricingGatewayBudget(input: RecordedPricingAccountingDependencies
  & { pricingEvidence: GatewayPricingEvidenceSource; sceneCode: string }) {
  const pricing = new PrismaGatewayRecordedPricing(input.db, input.scopes, input.clock);
  const gateway = createPersistedGatewayBudget({ ...input, pricing });
  const pricingRecords = new GatewayPricingRecordManagement(input.db, input.scopes, input.authorization,
    input.pricingEvidence, gateway.bindings, input.sceneCode, input.clock);
  return { ...gateway, pricingRecords, recovery: recordedPricingRecovery(gateway, pricing) };
}

/** Workspace-user server assembly with real current task/configuration
 * authorization. Trusted versioned pricing remains required and fail-closed;
 * this helper does not invent model rates or register a production provider. */
export function createAuthorizedPersistedGatewayBudget(input:
  Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'authorization' | 'scopes' | 'db'>
  & ConstructorParameters<typeof PrismaTaskBudgetAuthorizationSource>[0]) {
  const authorization = new PrismaTaskBudgetAuthorizationSource(input);
  return createPersistedGatewayBudget({ ...input, authorization, scopes: authorization.scopes });
}

/** Explicit customer assembly; requires current original material authorization,
 * persisted execution policy and trusted pricing. Does not enable client models. */
export function createAuthorizedClientPersistedGatewayBudget(input:
  Omit<Parameters<typeof createPersistedGatewayBudget>[0], 'authorization' | 'scopes' | 'db'>
  & ConstructorParameters<typeof PrismaClientTaskBudgetAuthorizationSource>[0]) {
  const authorization = new PrismaClientTaskBudgetAuthorizationSource(input);
  return createPersistedGatewayBudget({ ...input, authorization, scopes: authorization.scopes });
}
