/** SaaS-reviewed platform rates in the original price store. The review and
 * evidence are one immutable row, not a tenant audit entry or another ledger.
 * Tenant adoption projects this fixed rate only; it grants no execution,
 * supplier invoice certification or input-token certification. */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft } from '@rental-os/platform-contracts/ai-gateway';
import type { AiScopeRepository } from '../ai-scope.repository';
import { isAiStepExecutionContext } from '../../execution-context-validation';
import { BudgetError } from './budget.ports';
import { reviewedGatewayPriceInput, reviewedGatewayPriceReadInput } from './reviewed-gateway-price-input';
import { PrismaGatewayPricingRecords, platformReviewedPricePayloadSchema, platformReviewedPriceReference, type GatewayPricingRecordDb } from './prisma-gateway-price-store';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';


type Db = GatewayPricingRecordDb & Pick<PrismaClient, '$transaction'>;
type ReviewLease = { revalidate(): Promise<void>; close(): void; revalidatesReviewInTransaction?: true };
const profileSelect = { id: true, scopeId: true, scopeKind: true, serviceMode: true, configRevision: true,
  provider: true, protocol: true, model: true, credentialRef: true } satisfies Prisma.AiProviderProfileSelect;
const stable = ({ requestId: _id, authorizedAt: _at, ...value }: AiExecutionContext) => hash(value);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export class PlatformReviewedGatewayPriceService {
  private readonly records: PrismaGatewayPricingRecords;
  constructor(private readonly db: Db, private readonly scopes: { read: Pick<AiScopeRepository, 'resolveCurrent'>;
    write: Pick<AiScopeRepository, 'resolveCurrent'> }, private readonly profileId: string,
    private readonly requestActive: () => Promise<unknown>,
    private readonly begin: (tx: Prisma.TransactionClient, actorId: string, scopeId: string) => Promise<ReviewLease | undefined>,
    private readonly clock: () => Date = () => new Date()) {
    this.records = new PrismaGatewayPricingRecords(db);
  }
  private reference(actorId: string, operationKey: string) { return platformReviewedPriceReference(this.profileId, actorId, operationKey); }
  private async current(write: boolean) {
    try {
      await this.requestActive();
      const current = structuredClone(await this.scopes[write ? 'write' : 'read'].resolveCurrent());
      if (!isAiStepExecutionContext(current.context) || current.context.scope.kind !== 'platform' || current.scope.kind !== 'PLATFORM'
        || current.context.actor.kind !== 'saas_admin' || current.context.audience !== 'operator') throw new BudgetError('FORBIDDEN');
      return { ...current, actorId: current.context.actor.userId, binding: hash({ scopeId: current.scope.id, identity: stable(current.context) }) };
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      if (error instanceof Error && 'code' in error && ['AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED', 'FORBIDDEN'].includes(String(error.code)))
        throw new BudgetError('FORBIDDEN');
      throw new BudgetError('UNAVAILABLE');
    }
  }
  private async recheck(before: Awaited<ReturnType<PlatformReviewedGatewayPriceService['current']>>, write: boolean) {
    if ((await this.current(write)).binding !== before.binding) throw new BudgetError('FORBIDDEN');
  }
  private summary(record: Awaited<ReturnType<PrismaGatewayPricingRecords['price']>>, operationKey: string) {
    const value = record.evidence;
    return { state: 'recorded' as const, operationKey, id: record.id, evidenceHash: record.hash, priceVersion: value.priceVersion,
      configurationHash: hash(value.configuration), configId: value.configuration.configId, configRevision: value.configuration.configRevision,
      validFrom: value.validFrom, expiresAt: value.expiresAt, billing: structuredClone(value.billing),
      rateAuthority: 'platform_reviewed_budget_rate_not_provider_invoice' as const,
      inputCounting: 'not_certified_by_rate_review' as const, executionPermission: false as const };
  }
  async review(value: unknown) {
    const parsed = reviewedGatewayPriceInput.safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const command = parsed.data;
    if (command.configId !== this.profileId) throw new BudgetError('FORBIDDEN');
    const before = await this.current(true);
    const load = async (db: Pick<Prisma.TransactionClient, 'aiProviderProfile'>) => {
      const row = structuredClone(await db.aiProviderProfile.findFirst({ where: { id: this.profileId }, select: profileSelect }));
      if (!row || row.id !== this.profileId || row.scopeId !== before.scope.id || row.scopeKind !== 'PLATFORM'
        || row.serviceMode !== 'platform_managed') throw new BudgetError('FORBIDDEN');
      if (row.configRevision !== command.expectedConfigRevision) throw new BudgetError('REVISION_CONFLICT');
      return row;
    };
    const profile = await load(this.db), configuration: AiGatewayConfigReferenceDraft = { configId: profile.id,
      configRevision: profile.configRevision, provider: profile.provider, protocol: profile.protocol,
      model: profile.model, credentialRef: profile.credentialRef, serviceMode: 'platform_managed',
      consumerScope: { kind: 'platform' }, configurationScope: { kind: 'platform' } };
    const reference = this.reference(before.actorId, command.operationKey), commandHash = hash({ command, actorId: before.actorId, scopeId: before.scope.id });
    const parsedPayload = platformReviewedPricePayloadSchema.safeParse({ kind: 'platform-reviewed-price-record-1',
      evidence: { kind: 'gateway-price-1', configuration, priceVersion: command.priceVersion, validFrom: command.validFrom,
        expiresAt: command.expiresAt, billing: command.billing, usageClass: 'plain_text_input_output_tokens',
        additionalBillingDimensions: command.billing.unit === 'money' && command.billing.inputCache ? 'input_cache_tokens' : 'none',
        provenance: { reference, revision: String(command.expectedConfigRevision), documentHash: commandHash } },
      review: { actorId: before.actorId, operationKey: command.operationKey, sceneCode: command.sceneCode, profileId: this.profileId,
        expectedConfigRevision: command.expectedConfigRevision, commandHash, authority: 'platform_reviewed_budget_rate_not_provider_invoice' } });
    if (!parsedPayload.success || Date.parse(command.expiresAt) <= this.clock().getTime()) throw new BudgetError('INVALID');
    const payload = parsedPayload.data, configurationHash = hash(configuration), payloadHash = hash(payload);
    const id = this.records.priceId(before.scope.id, configurationHash, command.priceVersion);
    await this.recheck(before, true);
    let attempted = false;
    try {
      await this.db.$transaction(async tx => {
        const lease = await this.begin(tx, before.actorId, before.scope.id);
        const recheckInWrite = () => lease?.revalidatesReviewInTransaction ? lease.revalidate() : this.recheck(before, true);
        try {
          await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_provider_profiles WHERE id = ${this.profileId} FOR UPDATE`);
          if (!isDeepStrictEqual(await load(tx), profile)) throw new BudgetError('REVISION_CONFLICT');
          const [original, version] = await Promise.all([
            tx.aiGatewayPriceRecord.findFirst({ where: { scopeId: before.scope.id, sourceReference: reference } }),
            tx.aiGatewayPriceRecord.findUnique({ where: { id } })]);
          if (original || version) {
            if (!original || !version || original.id !== id || version.id !== id || version.scopeId !== before.scope.id
              || version.sourceReference !== reference || version.payloadHash !== payloadHash || hash(version.payload) !== payloadHash)
              throw new BudgetError('IDEMPOTENCY_CONFLICT');
            await recheckInWrite();
            if (!lease?.revalidatesReviewInTransaction) await lease?.revalidate();
            return;
          }
          // The Profile lock may have waited behind another configuration
          // writer. Recheck current management authority before this append.
          await recheckInWrite();
          if (Date.parse(command.expiresAt) <= this.clock().getTime()) throw new BudgetError('INVALID');
          attempted = true;
          await tx.aiGatewayPriceRecord.create({ data: { id, scopeId: before.scope.id, configurationHash,
            priceVersion: command.priceVersion, sourceReference: reference, payloadHash, payload: json(payload) } });
          await recheckInWrite();
          if (!lease?.revalidatesReviewInTransaction) await lease?.revalidate();
        } finally { lease?.close(); }
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      const result = await this.records.price(before.scope.id, configurationHash, command.priceVersion);
      if (result.hash !== payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
      await this.recheck(before, true);
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
    const command = parsed.data, before = await this.current(false), reference = this.reference(before.actorId, command.operationKey);
    const row = structuredClone(await this.db.aiGatewayPriceRecord.findFirst({ where: { scopeId: before.scope.id, sourceReference: reference } }));
    if (!row) throw new BudgetError('PENDING_RECONCILIATION');
    const payload = platformReviewedPricePayloadSchema.safeParse(row.payload);
    if (row.scopeId !== before.scope.id || row.sourceReference !== reference || !payload.success
      || payload.data.review.actorId !== before.actorId || payload.data.review.operationKey !== command.operationKey
      || payload.data.review.profileId !== this.profileId || payload.data.review.sceneCode !== command.sceneCode) throw new BudgetError('FORBIDDEN');
    const result = await this.records.price(before.scope.id, row.configurationHash, row.priceVersion);
    if (result.hash !== row.payloadHash) throw new BudgetError('FORBIDDEN');
    await this.recheck(before, false);
    return this.summary(result, command.operationKey);
  }
}
