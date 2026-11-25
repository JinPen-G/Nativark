import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { BudgetError } from './budget.ports';
type Tx = Parameters<Parameters<import('@prisma/client').PrismaClient['$transaction']>[0]>[0];
const allocationSchema = z.record(z.string().min(1).max(191),
  z.string().regex(/^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u));
export function creditAllocations(value: unknown) {
  const parsed = allocationSchema.safeParse(value);
  if (!parsed.success) throw new BudgetError('UNAVAILABLE');
  return parsed.data;
}
export function creditAtoms(value: Prisma.Decimal | string): bigint {
  const amount = typeof value === 'string' ? new prismaRuntime.Decimal(value) : value;
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 6) throw new BudgetError('UNAVAILABLE');
  return BigInt(amount.toFixed(6).replace('.', ''));
}
export function creditAmount(atoms: bigint): string {
  const digits = atoms.toString().padStart(7, '0');
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`;
}
/** SQL aggregation over the ORIGINAL reservations, including unresolved holds.
 * This is a limit check, never another reserve/settle/release operation. */
export async function creditConsumption(tx: Pick<Tx, 'aiBudgetReservation'>,
  tenantId: string, currency: string, workspaceId?: string) {
  const rows = await tx.aiBudgetReservation.groupBy({ by: ['status'],
    where: { tenantId, ...(workspaceId ? { workspaceId } : {}), unitKind: 'money', moneyCurrency: currency,
      billingMode: { in: ['platform_managed', 'legacy_unknown'] },
      status: { in: ['reserved', 'pending_reconciliation', 'settled'] } },
    orderBy: { status: 'asc' }, take: 4,
    _count: { _all: true, reservedMoney: true, actualMoney: true },
    _sum: { reservedMoney: true, actualMoney: true } });
  if (rows.length > 3 || new Set(rows.map(row => row.status)).size !== rows.length) throw new BudgetError('UNAVAILABLE');
  let spent = 0n, held = 0n;
  for (const row of rows) {
    const field = row.status === 'settled' ? 'actualMoney' : 'reservedMoney', amount = row._sum[field];
    if (row._count._all < 1 || row._count[field] !== row._count._all || amount === null
      || !amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 6) throw new BudgetError('UNAVAILABLE');
    if (row.status === 'settled') spent += creditAtoms(amount); else held += creditAtoms(amount);
  }
  return { spent, held };
}
/** Same SERIALIZABLE transaction as canonical reserve(). The shared tenant row
 * serializes ALL platform-money scenes/spaces; old accounting remains readable
 * after limits change. Legacy money records conservatively retain their holds. */
export async function assertPlatformCreditLimit(tx: Tx, tenantId: string, workspaceId: string | null,
  currency: string, requested: string) {
  await tx.$queryRaw(prismaRuntime.sql`SELECT tenantId FROM ai_tenant_ai_allowances WHERE tenantId = ${tenantId} AND currency = ${currency} FOR UPDATE`);
  const account = await tx.aiTenantAiAllowance.findUnique({ where: { tenantId_currency: { tenantId, currency } } });
  if (!account || account.grantedAmount.lte(0)) throw new BudgetError('EXHAUSTED');
  const quantity = creditAtoms(requested), total = await creditConsumption(tx, tenantId, currency);
  if (total.spent + total.held + quantity > creditAtoms(account.grantedAmount)) throw new BudgetError('EXHAUSTED');
  if (workspaceId) {
    const allocated = creditAllocations(account.allocationsJson)[workspaceId];
    if (!allocated) throw new BudgetError('EXHAUSTED');
    const usage = await creditConsumption(tx, tenantId, currency, workspaceId);
    if (usage.spent + usage.held + quantity > creditAtoms(allocated)) throw new BudgetError('EXHAUSTED');
  }
}
