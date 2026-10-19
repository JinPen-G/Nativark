/** Human-reviewed BYOK budget rates, appended to the original pricing store.
 * Not a provider invoice, input-token certificate, model call or dispatch gate.
 * One transaction retains the rate and original review receipt; lost replies
 * are observed by the same key, never repaired with another price version. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import type { BudgetAuthorizationSource } from './budget-dependency-adapters';
import { BudgetError } from './budget.ports';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { gatewayPriceEvidenceSchema, gatewayPriceBillingSchema } from './gateway-pricing-evidence';
import { PrismaGatewayPricingRecords, type GatewayPricingRecordDb } from './prisma-gateway-pricing-records';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';

type Db = GatewayPricingRecordDb & Pick<PrismaClient, '$transaction' | 'operationLog' | 'aiTenantModelConfiguration'>;
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const reviewedGatewayPriceInput = z.object({ sceneCode: key, operationKey: key, configId: key.max(36),
  expectedConfigRevision: z.number().int().min(1).max(4294967295), priceVersion: key.max(64),
  validFrom: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  billing: gatewayPriceBillingSchema, confirmReviewedRate: z.literal(true) }).strict();
export const reviewedGatewayPriceReadInput = z.object({ sceneCode: key, operationKey: key }).strict();
const stable = ({ authorizedAt: _at, requestId: _request, ...context }: AiExecutionContext) => hash(context);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const configurationSelect = { tenantId: true, mode: true, revision: true } satisfies Prisma.AiTenantModelConfigurationSelect;
const profileSelect = { id: true, scopeId: true, scopeKind: true, profileKey: true, role: true, serviceMode: true,
  configRevision: true, provider: true, protocol: true, model: true, credentialRef: true } satisfies Prisma.AiProviderProfileSelect;

export class ReviewedGatewayPriceService {
  private readonly records: PrismaGatewayPricingRecords;
  constructor(private readonly db: Db, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly authority: BudgetAuthorizationSource, private readonly requestActive: () => Promise<unknown>,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof requestActive !== 'function') throw new BudgetError('UNAVAILABLE');
    this.records = new PrismaGatewayPricingRecords(db);
  }
  private async current(sceneCode: string, action: 'settings_read' | 'settings_write') {
    await this.requestActive();
    const current = structuredClone(await this.scopes.resolveCurrent()), principal = gatewayBudgetPrincipal(current.context);
    if (current.context.audience !== 'operator' || principal.actorKind !== 'USER' || current.scope.kind !== 'WORKSPACE'
      || principal.tenantId !== current.scope.tenantId || principal.workspaceId !== current.scope.workspaceId) throw new BudgetError('FORBIDDEN');
    const grant = structuredClone(await this.authority.authorize(action, structuredClone(current.context), {
      policy: { scopeId: current.scope.id, scopeKind: 'WORKSPACE', sceneCode } }));
    if (!grant?.authorizationKey || !(grant.expiresAt instanceof Date) || !Number.isFinite(grant.expiresAt.getTime())
      || grant.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
    return { ...current, principal, binding: hash({ identity: stable(current.context), scopeId: current.scope.id, key: grant.authorizationKey }) };
  }
  private async recheck(initial: Awaited<ReturnType<ReviewedGatewayPriceService['current']>>, scene: string, action: 'settings_read' | 'settings_write') {
    if ((await this.current(scene, action)).binding !== initial.binding) throw new BudgetError('FORBIDDEN');
  }
  private logId(scopeId: string, operationKey: string) {
    const value = hash({ kind: 'gateway-reviewed-price-1', scopeId, operationKey });
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
  }
  private async configuration(db: Pick<Prisma.TransactionClient, 'aiTenantModelConfiguration' | 'aiScope' | 'aiProviderProfile'>,
    tenantId: string, configId: string, revision: number) {
    const selection = structuredClone(await db.aiTenantModelConfiguration.findUnique({ where: { tenantId }, select: configurationSelect }));
    const owner = structuredClone(await db.aiScope.findFirst({ where: { kind: 'TENANT', tenantId, workspaceId: null },
      select: { id: true, kind: true, tenantId: true, workspaceId: true } }));
    const profile = structuredClone(await db.aiProviderProfile.findFirst({ where: { id: configId }, select: profileSelect }));
    // A tenant administrator cannot set platform-managed supplier rates. Model
    // disabled state is not a settings gate; a saved rate grants no execution.
    if (!selection || selection.tenantId !== tenantId || selection.mode !== 'tenant_managed'
      || !owner || owner.kind !== 'TENANT' || owner.tenantId !== tenantId || owner.workspaceId !== null
      || !profile || profile.id !== configId || profile.scopeId !== owner.id || profile.scopeKind !== 'TENANT'
      || profile.profileKey !== 'default' || profile.role !== 'DEFAULT' || profile.serviceMode !== 'tenant_managed') throw new BudgetError('FORBIDDEN');
    if (selection.revision !== revision || profile.configRevision !== revision) throw new BudgetError('REVISION_CONFLICT');
    return { selection, owner, profile };
  }
  private summary(record: Awaited<ReturnType<PrismaGatewayPricingRecords['price']>>, operationKey: string) {
    const evidence = record.evidence;
    return { state: 'recorded' as const, operationKey, id: record.id, evidenceHash: record.hash, priceVersion: evidence.priceVersion,
      configurationHash: hash(evidence.configuration), configId: evidence.configuration.configId,
      configRevision: evidence.configuration.configRevision, validFrom: evidence.validFrom, expiresAt: evidence.expiresAt,
      billing: structuredClone(evidence.billing), rateAuthority: 'tenant_reviewed_budget_rate_not_provider_invoice' as const,
      inputCounting: 'not_certified_by_rate_review' as const, executionPermission: false as const };
  }
  async review(value: unknown) {
    const parsed = reviewedGatewayPriceInput.safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const command = parsed.data, before = await this.current(command.sceneCode, 'settings_write');
    const snapshot = await this.configuration(this.db, before.principal.tenantId, command.configId, command.expectedConfigRevision);
    const profile = snapshot.profile;
    const configuration: AiGatewayConfigReferenceDraft = { configId: profile.id, configRevision: profile.configRevision,
      provider: profile.provider, protocol: profile.protocol, model: profile.model, credentialRef: profile.credentialRef,
      tenantId: before.principal.tenantId, serviceMode: 'tenant_managed',
      configurationScope: { kind: 'tenant', tenantId: before.principal.tenantId } };
    const commandHash = hash({ command, scopeId: before.scope.id, actorId: before.principal.actorId });
    const evidence = gatewayPriceEvidenceSchema.safeParse({ kind: 'gateway-price-1', configuration, priceVersion: command.priceVersion,
      validFrom: command.validFrom, expiresAt: command.expiresAt, billing: command.billing,
      usageClass: 'plain_text_input_output_tokens', additionalBillingDimensions: command.billing.unit === 'money' && command.billing.inputCache ? 'input_cache_tokens' : 'none',
      provenance: { reference: command.operationKey, revision: String(command.expectedConfigRevision), documentHash: commandHash } });
    if (!evidence.success || Date.parse(command.expiresAt) <= this.clock().getTime()) throw new BudgetError('INVALID');
    const payloadHash = hash(evidence.data), configurationHash = hash(configuration);
    const id = this.records.priceId(before.scope.id, configurationHash, command.priceVersion);
    const audit = { id: this.logId(before.scope.id, command.operationKey), tenantId: before.principal.tenantId,
      workspaceId: before.principal.workspaceId, userId: before.principal.actorId, action: 'ai.gateway.price.reviewed',
      detail: json({ version: 'gateway-reviewed-price-1', scopeId: before.scope.id, sceneCode: command.sceneCode,
        operationKey: command.operationKey, commandHash, priceId: id, payloadHash,
        authority: 'tenant_reviewed_budget_rate_not_provider_invoice', executionPermission: false }) };
    let attempted = false;
    await this.recheck(before, command.sceneCode, 'settings_write');
    try {
      await this.db.$transaction(async tx => {
        // Fixed order: tenant configuration -> its profile -> immutable rate /
        // receipt. Re-read AFTER locking, never continue with a stale profile.
        await tx.$queryRaw(Prisma.sql`SELECT tenantId FROM ai_tenant_model_configurations WHERE tenantId = ${before.principal.tenantId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_provider_profiles WHERE id = ${command.configId} FOR UPDATE`);
        if (!isDeepStrictEqual(await this.configuration(tx, before.principal.tenantId, command.configId, command.expectedConfigRevision), snapshot))
          throw new BudgetError('REVISION_CONFLICT');
        const previous = await tx.operationLog.findUnique({ where: { id: audit.id } });
        const saved = await tx.aiGatewayPriceRecord.findUnique({ where: { id } });
        if (previous || saved) {
          if (!previous || !saved || previous.tenantId !== audit.tenantId || previous.workspaceId !== audit.workspaceId
            || previous.userId !== audit.userId || previous.action !== audit.action || !isDeepStrictEqual(previous.detail, audit.detail)
            || saved.scopeId !== before.scope.id || saved.sourceReference !== command.operationKey
            || saved.payloadHash !== payloadHash || hash(saved.payload) !== payloadHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
          return;
        }
        // This request-local probe only checks cancellation, not authority.
        // Do not open another Auth/Scope transaction while holding DB locks.
        await this.requestActive();
        if (Date.parse(command.expiresAt) <= this.clock().getTime()) throw new BudgetError('INVALID');
        attempted = true;
        await tx.aiGatewayPriceRecord.create({ data: { id, scopeId: before.scope.id, configurationHash,
          priceVersion: command.priceVersion, sourceReference: command.operationKey, payloadHash, payload: json(evidence.data) } });
        await tx.operationLog.create({ data: audit });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      const result = await this.records.price(before.scope.id, configurationHash, command.priceVersion);
      if (result.hash !== payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
      await this.recheck(before, command.sceneCode, 'settings_write');
      return this.summary(result, command.operationKey);
    } catch (error) {
      if (attempted) throw new BudgetError('PENDING_RECONCILIATION');
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('UNAVAILABLE');
    }
  }
  async receipt(value: unknown) {
    const parsed = reviewedGatewayPriceReadInput.safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const command = parsed.data, before = await this.current(command.sceneCode, 'settings_read');
    const row = structuredClone(await this.db.aiGatewayPriceRecord.findFirst({ where: { scopeId: before.scope.id, sourceReference: command.operationKey } }));
    const audit = structuredClone(await this.db.operationLog.findUnique({ where: { id: this.logId(before.scope.id, command.operationKey) } }));
    const metadata = audit?.detail as Record<string, unknown> | null;
    if (!row || !audit) throw new BudgetError('PENDING_RECONCILIATION');
    if (row.scopeId !== before.scope.id || row.sourceReference !== command.operationKey || audit.tenantId !== before.principal.tenantId
      || audit.workspaceId !== before.principal.workspaceId || audit.userId !== before.principal.actorId || audit.action !== 'ai.gateway.price.reviewed'
      || !metadata || metadata.version !== 'gateway-reviewed-price-1' || metadata.scopeId !== before.scope.id
      || metadata.sceneCode !== command.sceneCode || metadata.operationKey !== command.operationKey
      || metadata.priceId !== row.id || metadata.payloadHash !== row.payloadHash) throw new BudgetError('FORBIDDEN');
    const result = await this.records.price(before.scope.id, row.configurationHash, row.priceVersion);
    if (result.evidence.provenance.documentHash !== metadata.commandHash || result.hash !== row.payloadHash) throw new BudgetError('FORBIDDEN');
    await this.recheck(before, command.sceneCode, 'settings_read');
    return this.summary(result, command.operationKey);
  }
}
