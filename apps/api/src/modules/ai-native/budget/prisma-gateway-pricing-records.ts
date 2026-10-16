import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { BudgetError } from './budget.ports';
import type { BudgetAuthorizationSource } from './budget-dependency-adapters';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { gatewayPriceEvidenceSchema, gatewayInputBoundEvidenceSchema, type GatewayPriceEvidence } from './gateway-pricing-evidence';

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const reference = z.object({ reference: key }).strict();
const bindingCommand = reference.extend({ callId: key.max(128) }).strict();
const selector = z.object({ configurationHash: z.string().regex(/^[a-f0-9]{64}$/u), priceVersion: key.max(64) }).strict();
export type GatewayPricingRecordDb = Pick<PrismaClient,
  'aiGatewayInvocation' | 'aiProviderProfile' | 'aiScope' | 'aiGatewayPriceRecord' | 'aiGatewayInputBoundRecord'>;
/** Pricing consumes a cloneable projection, not the full invocation row (its
 * Prisma Decimal fencing token is validated by the original binding source). */
export const gatewayPricingInvocationSelect = Object.freeze({ id: true, scopeId: true, callId: true, actorId: true,
  sceneCode: true, configuration: true, configurationHash: true, registrationHash: true,
  intentHash: true, priceVersion: true, maxOutputTokens: true } satisfies Prisma.AiGatewayInvocationSelect);
export interface GatewayPricingEvidenceSource {
  readPrice(reference: string, context: Readonly<AiExecutionContext>): Promise<unknown>;
  readInputBound(reference: string, context: Readonly<AiExecutionContext>, binding: Readonly<{
    invocationId: string; scopeId: string; registrationHash: string; intentHash: string;
    configurationHash: string; priceVersion: string; priceHash: string; maxOutputTokens: number;
  }>): Promise<unknown>;
}
const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...stable } = context;
  return hash(stable);
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new BudgetError('INVALID');
  return parsed.data;
};

export class PrismaGatewayPricingRecords {
  constructor(private readonly db: GatewayPricingRecordDb) {
    if (typeof db?.aiGatewayPriceRecord?.findUnique !== 'function' || typeof db.aiGatewayPriceRecord.create !== 'function'
      || typeof db.aiGatewayPriceRecord.findFirst !== 'function'
      || typeof db.aiGatewayInputBoundRecord?.findUnique !== 'function' || typeof db.aiGatewayInputBoundRecord.create !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  priceId(scopeId: string, configurationHash: string, priceVersion: string) {
    return hash({ kind: 'gateway-price-key-1', scopeId, configurationHash, priceVersion });
  }
  boundId(scopeId: string, invocationId: string) { return hash({ kind: 'gateway-bound-key-1', scopeId, invocationId }); }
  async price(scopeId: string, configurationHash: string, priceVersion: string) {
    const id = this.priceId(scopeId, configurationHash, priceVersion);
    const row = structuredClone(await this.db.aiGatewayPriceRecord.findUnique({ where: { id } }));
    if (!row || row.id !== id || row.scopeId !== scopeId || row.configurationHash !== configurationHash
      || row.priceVersion !== priceVersion || hash(row.payload) !== row.payloadHash) throw new BudgetError('UNAVAILABLE');
    const evidence = parse(gatewayPriceEvidenceSchema, row.payload);
    if (hash(evidence.configuration) !== configurationHash || evidence.priceVersion !== priceVersion
      || row.sourceReference !== evidence.provenance.reference) throw new BudgetError('FORBIDDEN');
    return { id, hash: row.payloadHash, evidence };
  }
  async bound(scopeId: string, invocationId: string) {
    const id = this.boundId(scopeId, invocationId);
    const row = structuredClone(await this.db.aiGatewayInputBoundRecord.findUnique({ where: { id } }));
    if (!row || row.id !== id || row.scopeId !== scopeId || row.invocationId !== invocationId
      || hash(row.payload) !== row.payloadHash) throw new BudgetError('UNAVAILABLE');
    const evidence = parse(gatewayInputBoundEvidenceSchema, row.payload);
    const price = await this.price(scopeId, evidence.configurationHash, evidence.priceVersion);
    if (evidence.scopeId !== scopeId || evidence.invocationId !== invocationId || evidence.priceHash !== price.hash
      || row.priceRecordId !== price.id) throw new BudgetError('FORBIDDEN');
    return { id, hash: row.payloadHash, evidence, price };
  }
}

/** Current-authorized history is independent of the producer's availability.
 * Absent publication dependencies allow observations only; publication never
 * substitutes stored history for fresh evidence or current execution binding. */
export class GatewayPricingRecordManagement {
  private readonly records;
  constructor(private readonly db: GatewayPricingRecordDb,
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly authorization: BudgetAuthorizationSource,
    private readonly source: GatewayPricingEvidenceSource | undefined,
    private readonly bindings: Pick<PrismaGatewayInvocationBindings, 'resolveForReserve'> | undefined,
    private readonly sceneCode: string, private readonly clock: () => Date = () => new Date()) {
    if (!key.max(128).safeParse(sceneCode).success || typeof authorization?.authorize !== 'function'
      || typeof scopes?.resolveCurrent !== 'function'
      || source !== undefined && (typeof source?.readPrice !== 'function' || typeof source.readInputBound !== 'function')
      || bindings !== undefined && typeof bindings?.resolveForReserve !== 'function') throw new BudgetError('UNAVAILABLE');
    this.records = new PrismaGatewayPricingRecords(db);
  }
  private async authorize(action: 'settings_read' | 'settings_write') {
    const current = structuredClone(await this.scopes.resolveCurrent());
    const principal = gatewayBudgetPrincipal(current.context);
    if (current.scope.kind !== 'WORKSPACE' || current.context.audience !== 'operator' || current.context.actor.kind !== 'user'
      || principal.tenantId !== current.scope.tenantId || principal.workspaceId !== current.scope.workspaceId) throw new BudgetError('FORBIDDEN');
    const resource = { policy: { scopeId: current.scope.id, scopeKind: 'WORKSPACE', sceneCode: this.sceneCode } };
    const grant = structuredClone(await this.authorization.authorize(action, structuredClone(current.context), structuredClone(resource)));
    if (!grant?.authorizationKey || !Number.isFinite(grant.expiresAt?.getTime()) || grant.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    return { ...current, principal, resource, grant };
  }
  private async recheck(before: Awaited<ReturnType<GatewayPricingRecordManagement['authorize']>>, action: 'settings_read' | 'settings_write') {
    const after = await this.authorize(action);
    if (identity(after.context) !== identity(before.context) || after.scope.id !== before.scope.id
      || after.grant.authorizationKey !== before.grant.authorizationKey) throw new BudgetError('FORBIDDEN');
  }
  private active(evidence: { validFrom: string; expiresAt: string }) {
    const now = this.clock().getTime();
    if (!Number.isFinite(now) || Date.parse(evidence.validFrom) > now || Date.parse(evidence.expiresAt) <= now) throw new BudgetError('UNAVAILABLE');
  }
  private async profile(evidence: GatewayPriceEvidence, tenantId: string) {
    const c = evidence.configuration;
    if (!('tenantId' in c) || c.tenantId !== tenantId) throw new BudgetError('FORBIDDEN');
    const columns = aiPersistenceScopeColumns(c.configurationScope);
    const owner = structuredClone(await this.db.aiScope.findFirst({ where: columns }));
    const row = structuredClone(await this.db.aiProviderProfile.findFirst({ where: { id: c.configId } }));
    if (!owner || Object.entries(columns).some(([name, expected]) => owner[name as keyof typeof owner] !== expected)
      || !row || row.scopeId !== owner.id || row.scopeKind !== owner.kind
      || (c.serviceMode === 'platform_managed' ? owner.kind !== 'PLATFORM' : owner.kind !== 'TENANT' || owner.tenantId !== tenantId)
      || !row.enabled || row.disabledAt || row.configRevision !== c.configRevision || row.provider !== c.provider
      || row.protocol !== c.protocol || row.model !== c.model || row.credentialRef !== c.credentialRef || row.serviceMode !== c.serviceMode) throw new BudgetError('FORBIDDEN');
  }
  async publishPrice(value: unknown) {
    const source = this.source;
    if (!source) throw new BudgetError('UNAVAILABLE');
    const command = parse(reference, value), current = await this.authorize('settings_write');
    const evidence = parse(gatewayPriceEvidenceSchema, await source.readPrice(command.reference, structuredClone(current.context)));
    if (evidence.provenance.reference !== command.reference) throw new BudgetError('FORBIDDEN');
    this.active(evidence); await this.profile(evidence, current.principal.tenantId);
    const scopeId = current.scope.id, configurationHash = hash(evidence.configuration), priceVersion = evidence.priceVersion;
    const id = this.records.priceId(scopeId, configurationHash, priceVersion), payloadHash = hash(evidence);
    const existing = structuredClone(await this.db.aiGatewayPriceRecord.findUnique({ where: { id } }));
    if (existing && existing.payloadHash !== payloadHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
    const confirmed = parse(gatewayPriceEvidenceSchema, await source.readPrice(command.reference, structuredClone(current.context)));
    if (hash(confirmed) !== payloadHash) throw new BudgetError('REVISION_CONFLICT');
    this.active(confirmed); await this.profile(confirmed, current.principal.tenantId);
    await this.recheck(current, 'settings_write');
    // Source/profile/authorization reads may outlive the evidence. Refuse
    // before any append, not merely when a later dispatch tries to use it.
    this.active(confirmed);
    try {
      if (!existing) await this.db.aiGatewayPriceRecord.create({ data: { id, scopeId, configurationHash, priceVersion,
        sourceReference: command.reference, payloadHash, payload: json(evidence) } });
      const result = await this.records.price(scopeId, configurationHash, priceVersion);
      if (result.hash !== payloadHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
      await this.recheck(current, 'settings_write');
      this.active(confirmed);
      return { state: 'recorded' as const, id, payloadHash, configurationHash, priceVersion, executionPermission: false as const };
    } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
  }
  async publishInputBound(value: unknown) {
    const source = this.source, bindings = this.bindings;
    if (!source || !bindings) throw new BudgetError('UNAVAILABLE');
    const command = parse(bindingCommand, value), current = await this.authorize('settings_write');
    const row = structuredClone(await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: current.scope.id, callId: command.callId } },
      select: gatewayPricingInvocationSelect }));
    if (!row || row.scopeId !== current.scope.id || row.actorId !== current.principal.actorId || row.sceneCode !== this.sceneCode
      || !isGatewayConfig(row.configuration) || hash(row.configuration) !== row.configurationHash) throw new BudgetError('FORBIDDEN');
    const { actorKind: _, ...context } = current.principal;
    const request = { callId: row.callId, intentHash: row.intentHash, model: row.configuration.model, maxOutputTokens: row.maxOutputTokens };
    await bindings.resolveForReserve(context, request);
    const price = await this.records.price(current.scope.id, row.configurationHash, row.priceVersion);
    this.active(price.evidence);
    const binding = { invocationId: row.id, scopeId: row.scopeId, registrationHash: row.registrationHash, intentHash: row.intentHash,
      configurationHash: row.configurationHash, priceVersion: row.priceVersion, priceHash: price.hash, maxOutputTokens: row.maxOutputTokens };
    const evidence = parse(gatewayInputBoundEvidenceSchema, await source.readInputBound(command.reference, structuredClone(current.context), structuredClone(binding)));
    if (Object.entries(binding).some(([name, expected]) => evidence[name as keyof typeof evidence] !== expected)
      || evidence.provenance.reference !== command.reference) throw new BudgetError('FORBIDDEN');
    this.active(evidence);
    const id = this.records.boundId(row.scopeId, row.id), payloadHash = hash(evidence);
    const existing = structuredClone(await this.db.aiGatewayInputBoundRecord.findUnique({ where: { id } }));
    if (existing && existing.payloadHash !== payloadHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
    const confirmed = parse(gatewayInputBoundEvidenceSchema,
      await source.readInputBound(command.reference, structuredClone(current.context), structuredClone(binding)));
    if (hash(confirmed) !== payloadHash) throw new BudgetError('REVISION_CONFLICT');
    this.active(confirmed); this.active(price.evidence);
    await bindings.resolveForReserve(context, request); await this.recheck(current, 'settings_write');
    this.active(confirmed); this.active(price.evidence);
    try {
      if (!existing) await this.db.aiGatewayInputBoundRecord.create({ data: { id, scopeId: row.scopeId, invocationId: row.id,
        priceRecordId: price.id, payloadHash, payload: json(evidence) } });
      const result = await this.records.bound(row.scopeId, row.id);
      if (result.hash !== payloadHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
      await this.recheck(current, 'settings_write');
      this.active(confirmed); this.active(price.evidence);
      return { state: 'recorded' as const, id, payloadHash, callId: row.callId, executionPermission: false as const };
    } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
  }
  async readPublication(value: unknown) {
    const command = parse(reference, value), current = await this.authorize('settings_read');
    const row = structuredClone(await this.db.aiGatewayPriceRecord.findFirst({ where: { scopeId: current.scope.id, sourceReference: command.reference } }));
    if (!row) throw new BudgetError('PENDING_RECONCILIATION');
    if (row.scopeId !== current.scope.id || row.sourceReference !== command.reference) throw new BudgetError('FORBIDDEN');
    const result = await this.records.price(current.scope.id, row.configurationHash, row.priceVersion);
    if (result.id !== row.id || result.hash !== row.payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
    await this.recheck(current, 'settings_read');
    return result;
  }
  async readPrice(value: unknown) {
    const command = parse(selector, value), current = await this.authorize('settings_read');
    const result = await this.records.price(current.scope.id, command.configurationHash, command.priceVersion);
    await this.recheck(current, 'settings_read');
    return result;
  }
  async readInputBound(value: unknown) {
    const command = parse(z.object({ callId: key.max(128) }).strict(), value), current = await this.authorize('settings_read');
    const row = structuredClone(await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: current.scope.id, callId: command.callId } },
      select: gatewayPricingInvocationSelect }));
    if (!row || row.actorId !== current.principal.actorId || row.scopeId !== current.scope.id || row.sceneCode !== this.sceneCode) throw new BudgetError('FORBIDDEN');
    const result = await this.records.bound(current.scope.id, row.id);
    if (result.evidence.registrationHash !== row.registrationHash || result.evidence.intentHash !== row.intentHash
      || result.evidence.configurationHash !== row.configurationHash || result.evidence.priceVersion !== row.priceVersion) throw new BudgetError('FORBIDDEN');
    await this.recheck(current, 'settings_read');
    return result;
  }
}
