import { Prisma, type PrismaClient } from '@prisma/client';
import type { SubscriptionService } from '../../subscription/subscription.service';
import type { SubscriptionBudgetEntitlementReader } from './budget-dependency-adapters';
import { BudgetError } from './budget.ports';

type EntitlementSnapshot = { revision: number; available: boolean; validUntil: number };
/** Original SubscriptionService observations, not a grant or financial operation.
 * read retains its coherent private transaction; readIn joins a caller-owned
 * native transaction without nesting. The owner supplies current identity,
 * isolation/row fences, cancellation and final adoption/commit revalidation. */
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
  private keys(tenantId: string, featureCode: string) {
    if (![tenantId, featureCode].every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/.test(value))) throw new BudgetError('INVALID');
  }
  private async snapshotIn(tx: Prisma.TransactionClient, tenantId: string, featureCode: string,
    live: () => void = () => {}): Promise<EntitlementSnapshot> {
    live();
    const now = this.now();
    const context = await this.subscriptions.readCategoryCommercialContext(tenantId, tx, now, [featureCode]);
    live();
    const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: {
      subscription: { select: { startAt: true, endAt: true } },
      subscriptionSegments: { where: { status: 'SCHEDULED' }, select: { startAt: true, endAt: true } }
    } });
    live();
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
  }
  private projection(snapshot: EntitlementSnapshot, featureCode: string) {
    if (snapshot.available && this.now().getTime() >= snapshot.validUntil) throw new BudgetError('UNAVAILABLE');
    return { revision: snapshot.revision, entitlements: [{ code: featureCode, available: snapshot.available }] };
  }
  async read(tenantId: string, featureCode: string) {
    this.keys(tenantId, featureCode);
    try {
      const snapshot = await this.db.$transaction(tx => this.snapshotIn(tx, tenantId, featureCode), {
        // Preserve the original read-only snapshot and post-transaction expiry check.
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000
      });
      return this.projection(snapshot, featureCode);
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('UNAVAILABLE');
    }
  }
  /** Same-native metadata only. Never begins/commits a transaction or locks the
   * identity/catalog again. Requires the owner's coherent snapshot/fences; return
   * is neither commit acknowledgement nor reusable execution permission. */
  async readIn(tenantId: string, featureCode: string, native: Prisma.TransactionClient, signal: AbortSignal) {
    this.keys(tenantId, featureCode);
    try {
      const live = () => { if (signal.aborted) throw new BudgetError('UNAVAILABLE'); };
      live();
      if (!native || '$transaction' in native || typeof native.tenant?.findUnique !== 'function') throw new BudgetError('UNAVAILABLE');
      const snapshot = await this.snapshotIn(native, tenantId, featureCode, live);
      const result = this.projection(snapshot, featureCode);
      live();
      return result;
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('UNAVAILABLE');
    }
  }
}
