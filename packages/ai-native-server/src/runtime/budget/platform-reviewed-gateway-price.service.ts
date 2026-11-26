/** SaaS-reviewed platform rates in the original price store. The review and
 * evidence are one immutable row, not a tenant audit entry or another ledger.
 * Tenant adoption projects this fixed rate only; it grants no execution,
 * supplier invoice certification or input-token certification. */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import type { AiScopeRepository } from '../ai-scope.repository';
import { BudgetError } from './budget.ports';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { PrismaGatewayPricingRecords, platformReviewedPricePayloadSchema, type GatewayPricingRecordDb,
  type GatewayPricingEvidenceSource } from './prisma-gateway-price-store';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import { beginPlatformAiManagementTransaction } from '../platform-management-transaction';

type Db = GatewayPricingRecordDb & Pick<PrismaClient, '$transaction' | 'aiTenantModelConfiguration'>;
const profileSelect = { id: true, scopeId: true, scopeKind: true, serviceMode: true, configRevision: true,
  provider: true, protocol: true, model: true, credentialRef: true } satisfies Prisma.AiProviderProfileSelect;

import { PlatformReviewedGatewayPriceService as OriginalPriceReview } from './platform-price-review';

/** Rental's original identity bridge into the single rate store. */
export class PlatformReviewedGatewayPriceService extends OriginalPriceReview {
  constructor(db: Db, scopes: { read: Pick<AiScopeRepository, 'resolveCurrent'>; write: Pick<AiScopeRepository, 'resolveCurrent'> },
    profileId: string, requestActive: () => Promise<unknown>, clock?: () => Date) {
    super(db, scopes, profileId, requestActive, beginPlatformAiManagementTransaction, clock);
  }
}

/** Only projects the SaaS-reviewed fixed rate into a current platform-mode
 * tenant. No rate override or input certification is accepted from a caller. */
export class PrismaPlatformReviewedPriceSource implements GatewayPricingEvidenceSource {
  private readonly records: PrismaGatewayPricingRecords;
  constructor(private readonly db: Db, private readonly profileId: string, private readonly sceneCode: string,
    private readonly requestActive: () => Promise<unknown>) {
    this.records = new PrismaGatewayPricingRecords(db);
  }
  readPrice(reference: string, value: Readonly<AiExecutionContext>) { return this.project(reference, value, true); }
  /** Internal original-adoption verification only. The consumer must first
   * authorize and load its owned persisted adoption; not a public catalog. */
  readPriceHistory(reference: string, value: Readonly<AiExecutionContext>) { return this.project(reference, value, false); }
  private async project(reference: string, value: Readonly<AiExecutionContext>, current: boolean) {
    const context = structuredClone(value), principal = gatewayBudgetPrincipal(context);
    if (!/^platform-rate:[a-f0-9]{64}$/u.test(reference) || context.audience !== 'operator' || principal.actorKind !== 'USER') throw new BudgetError('FORBIDDEN');
    await this.requestActive();
    const row = structuredClone(await this.db.aiGatewayPriceRecord.findUnique({ where: { id: reference.slice('platform-rate:'.length) } }));
    const parsed = platformReviewedPricePayloadSchema.safeParse(row?.payload);
    if (!row || row.id !== reference.slice('platform-rate:'.length) || !parsed.success) throw new BudgetError('UNAVAILABLE');
    if (parsed.data.review.sceneCode !== this.sceneCode) throw new BudgetError('FORBIDDEN');
    const source = await this.records.price(row.scopeId, row.configurationHash, row.priceVersion), configuration = source.evidence.configuration;
    if (source.id !== row.id || source.hash !== row.payloadHash) throw new BudgetError('FORBIDDEN');
    if ((current && configuration.configId !== this.profileId) || configuration.serviceMode !== 'platform_managed' || configuration.configurationScope.kind !== 'platform'
      || !('consumerScope' in configuration) || configuration.consumerScope.kind !== 'platform') throw new BudgetError('FORBIDDEN');
    const scope = await this.db.aiScope.findFirst({ where: { id: row.scopeId, kind: 'PLATFORM', tenantId: null, workspaceId: null } });
    if (!scope || scope.id !== row.scopeId || scope.kind !== 'PLATFORM' || scope.tenantId !== null || scope.workspaceId !== null)
      throw new BudgetError('FORBIDDEN');
    if (current) {
      const [profile, selection] = await Promise.all([
      this.db.aiProviderProfile.findFirst({ where: { id: configuration.configId }, select: profileSelect }),
      this.db.aiTenantModelConfiguration.findUnique({ where: { tenantId: principal.tenantId }, select: { tenantId: true, mode: true } })]);
      if (!profile || profile.id !== configuration.configId || profile.scopeId !== row.scopeId || profile.scopeKind !== 'PLATFORM'
      || profile.serviceMode !== 'platform_managed' || profile.configRevision !== configuration.configRevision
      || profile.protocol !== configuration.protocol || profile.provider !== configuration.provider || profile.model !== configuration.model
      || profile.credentialRef !== configuration.credentialRef || selection?.tenantId !== principal.tenantId || selection.mode !== 'platform_managed')
        throw new BudgetError('REVISION_CONFLICT');
    }
    await this.requestActive();
    return { ...structuredClone(source.evidence), configuration: { configId: configuration.configId, configRevision: configuration.configRevision,
      provider: configuration.provider, protocol: configuration.protocol, model: configuration.model, credentialRef: configuration.credentialRef,
      serviceMode: 'platform_managed', tenantId: principal.tenantId, configurationScope: { kind: 'platform' } },
      provenance: { reference, revision: source.evidence.provenance.revision,
        documentHash: hash({ originalPriceId: source.id, originalPriceHash: source.hash }) } };
  }
  /** Rate review projects prices only; it never certifies input tokens. Input
   * bounds are produced by the trusted counting source composed beside this
   * source (input-counting/**) — this method stays fail-closed so a rate-only
   * assembly can never publish a bound it did not count. */
  async readInputBound(_reference: string, _context: Readonly<AiExecutionContext>,
    _binding: Readonly<{ invocationId: string; scopeId: string; registrationHash: string; intentHash: string;
      configurationHash: string; priceVersion: string; priceHash: string; maxOutputTokens: number }>): Promise<never> {
    throw new BudgetError('UNAVAILABLE');
  }
}
