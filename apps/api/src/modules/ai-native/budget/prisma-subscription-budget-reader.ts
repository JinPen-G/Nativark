import { Prisma, type PrismaClient } from '@prisma/client';
import type { SubscriptionService } from '../../subscription/subscription.service';
import type { SubscriptionBudgetEntitlementReader } from './budget-dependency-adapters';
import { BudgetError } from './budget.ports';

export class PrismaSubscriptionBudgetReader implements SubscriptionBudgetEntitlementReader {
  constructor(private readonly db: Pick<PrismaClient, '$transaction'>,
    private readonly subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof subscriptions?.readCategoryCommercialContext !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('UNAVAILABLE');
    return now;
  }
  async read(tenantId: string, featureCode: string) {
    if (![tenantId, featureCode].every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/.test(value))) throw new BudgetError('INVALID');
    try {
      const snapshot = await this.db.$transaction(async tx => {
        const now = this.now();
        const context = await this.subscriptions.readCategoryCommercialContext(tenantId, tx, now, [featureCode]);
        const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: {
          subscription: { select: { startAt: true, endAt: true } },
          subscriptionSegments: { where: { status: 'SCHEDULED' }, select: { startAt: true, endAt: true } }
        } });
        const entries = context.entitlements.filter(entry => entry.code === featureCode);
        if (!row || entries.length !== 1 || typeof entries[0].available !== 'boolean'
          || !Number.isSafeInteger(context.revision) || context.revision < 1) throw new BudgetError('FORBIDDEN');
        // Category-scoped entitlements need an explicit workspace/category mapping, not a global AI grant.
        if (!Array.isArray(entries[0].categories) || entries[0].categories.length !== 0) throw new BudgetError('UNAVAILABLE');
        const dates = [row.subscription, ...row.subscriptionSegments].flatMap(term => term ? [term.startAt, term.endAt] : [])
          .filter((date): date is Date => date instanceof Date && date > now);
        const validUntil = dates.length ? Math.min(...dates.map(date => date.getTime())) : now.getTime();
        const active = context.serviceStatus === 'active' || context.serviceStatus === 'expiring';
        return { revision: context.revision, available: active && context.newBusinessAllowed === true && entries[0].available === true, validUntil };
      // Read-only coherent entitlement snapshot, also called from financial
      // transaction revalidation. It is not a subscription write/lock grant.
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
      if (snapshot.available && this.now().getTime() >= snapshot.validUntil) throw new BudgetError('UNAVAILABLE');
      return { revision: snapshot.revision, entitlements: [{ code: featureCode, available: snapshot.available }] };
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('UNAVAILABLE');
    }
  }
}
