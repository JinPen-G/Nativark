import { PrismaGatewayCallPricing } from './prisma-gateway-call-pricing';
import { BudgetError, type BudgetQuotePort, type BudgetReserveCommand, type BudgetGrant, type BudgetRecord } from './budget.ports';
import type { GatewayActualUsagePricing } from './prisma-gateway-accounting-facts';
import type { ModelUsage } from '../model-gateway.ports';
/** Select ONE accounting path. BYOK only records invocation/token usage in the
 * existing ledger. Platform price evidence still comes from the SaaS source. */
export class ServiceModePricing implements BudgetQuotePort, GatewayActualUsagePricing {
  constructor(private readonly db: ConstructorParameters<typeof PrismaGatewayCallPricing>[0],
    private readonly scopes: ConstructorParameters<typeof PrismaGatewayCallPricing>[1],
    private readonly platformPricing: BudgetQuotePort & GatewayActualUsagePricing,
    private readonly clock?: () => Date) {}
  private byok(priceVersion: string) { return new PrismaGatewayCallPricing(this.db, this.scopes, priceVersion, this.clock, true); }
  async quote(command: Readonly<BudgetReserveCommand>, grant: Readonly<BudgetGrant>) {
    if (command.association.config.serviceMode === 'tenant_managed') return this.byok(command.association.priceVersion).quote(command, grant);
    const quote = await this.platformPricing.quote(command, grant);
    if (command.association.scope.kind !== 'platform' && quote.quantity.unit !== 'money') throw new BudgetError('UNAVAILABLE');
    return quote;
  }
  quantity(record: Readonly<BudgetRecord>, usage: Readonly<ModelUsage>) {
    // Previously recorded monetary debt retains its original pricing evidence;
    // switching service mode does not rewrite, refund or settle it as free.
    return record.association.config.serviceMode === 'tenant_managed' && record.reserved.unit === 'calls'
      ? this.byok(record.association.priceVersion).quantity(record, usage) : this.platformPricing.quantity(record, usage);
  }
}
