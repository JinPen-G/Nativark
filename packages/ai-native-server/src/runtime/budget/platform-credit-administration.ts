/** Original credit application facts and platform decision. A supplied host
 * owns current authority, Tenant locks and the same allowance transaction. */
import { HttpException } from '@nestjs/common';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma } from '@prisma/client';
import type { AiCreditRequest } from '@rental-os/platform-contracts/ai-finance';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { creditAtoms } from './platform-credit-limit';

export const id = z.string().min(1).max(191);
export const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
export const currency = z.string().regex(/^[A-Z]{3}$/u);
export const amount = z.string().regex(/^(0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/u)
  .transform(value => new prismaRuntime.Decimal(value)).refine(value => value.isFinite() && value.gt(0));
export const decisionSchema = z.object({ requestId: id, operationKey: key, expectedRevision: z.number().int().positive(),
  decision: z.enum(['approve', 'reject']), amount: amount.optional() }).strict()
  .refine(value => value.decision === 'approve' ? !!value.amount : value.amount === undefined);
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fail(code: string, status = 409): never {
  throw new HttpException({ code, retryable: false, ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'read_original_operation' } : {}) }, status);
}
export const iso = (value: Date) => value.toISOString();
export const requestInclude = { tenant: { select: { name: true, status: true } } } as const;
type Row = Prisma.AiTenantAiCreditRequestGetPayload<{ include: typeof requestInclude }>;
export function present(row: Row): AiCreditRequest {
  if (!['pending', 'approved', 'rejected'].includes(row.state)) fail('AI_RESOURCE_UNAVAILABLE', 503);
  return { id: row.id, tenantId: row.tenantId, tenantName: row.tenant.name, currency: row.currency,
    requestedAmount: row.requestedAmount.toFixed(6), state: row.state as AiCreditRequest['state'],
    revision: row.revision, grantedAmount: row.grantedAmount?.toFixed(6) ?? null,
    createdAt: iso(row.createdAt), decidedAt: row.decidedAt ? iso(row.decidedAt) : null };
}

export const platformCreditQueueInput = z.object({ cursor: id.optional() }).strict();
export const platformCreditReceiptInput = z.object({ requestId: id, operationKey: key }).strict();

export interface AiCreditDecisionTarget { tenantId: string; enabling: boolean }
type CreditQueries = Pick<Prisma.TransactionClient, 'aiTenantAiCreditRequest'>;

/** Capture the submitted key/amount/selector before authentication awaits.
 * Report malformed input only AFTER current authority has passed, so a clone
 * failure neither changes the command nor discloses private parser details. */
export function snapshotCommand<S extends z.ZodTypeAny>(schema: S, raw: unknown): () => z.output<S> {
  let parsed: z.SafeParseReturnType<z.input<S>, z.output<S>> | undefined;
  try { parsed = schema.safeParse(structuredClone(raw)); } catch { /* rejected by the authorized reader below */ }
  return () => { if (!parsed?.success) fail('AI_INVALID_INPUT', 400); return parsed.data; };
}
export async function readCreditCurrencies(db: Pick<Prisma.TransactionClient, 'aiBudgetPolicy'>, after?: string, exact?: string) {
  const rows = await db.aiBudgetPolicy.findMany({ where: { scopeKind: 'PLATFORM', enabled: true,
    unitKind: 'money', moneyCurrency: exact ?? { not: null, ...(after ? { gt: after } : {}) } }, distinct: ['moneyCurrency'],
    orderBy: { moneyCurrency: 'asc' }, select: { moneyCurrency: true }, take: 9 });
  if (rows.some(row => !currency.safeParse(row.moneyCurrency).success)) fail('AI_RESOURCE_UNAVAILABLE', 503);
  return rows.map(row => row.moneyCurrency!).sort();
}

export async function readPlatformCreditQueue(db: CreditQueries, input: { cursor?: string }) {
  const rows = await db.aiTenantAiCreditRequest.findMany({ where: { state: 'pending' },
    include: requestInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
  return { requests: rows.slice(0, 50).map(present), nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function readPlatformCreditReceipt(db: CreditQueries, actorId: string, input: { requestId: string; operationKey: string }) {
  const row = await db.aiTenantAiCreditRequest.findUnique({ where: { id: input.requestId }, include: requestInclude });
  return row ? { state: 'recorded' as const, request: present(row), originalDecision: row.state === 'pending' ? 'unknown' as const
    : row.decidedBy === actorId && row.decisionOperationKey === input.operationKey ? 'matched' as const : 'superseded' as const }
    : { state: 'unknown' as const };
}

export async function decidePlatformCredit(db: CreditQueries, actorId: string, input: z.output<typeof decisionSchema>,
  recheck: () => Promise<void>, write: (work: (tx: Prisma.TransactionClient, recheckInWrite: () => Promise<void>) => Promise<AiCreditRequest>,
    target: AiCreditDecisionTarget) => Promise<AiCreditRequest>) {
  const decisionHash = digest({ actorId, requestId: input.requestId,
    operationKey: input.operationKey, decision: input.decision, amount: input.amount?.toFixed(6) ?? null });
  const target = await db.aiTenantAiCreditRequest.findUnique({ where: { id: input.requestId }, select: { tenantId: true } });
  await recheck();
  if (!target?.tenantId) fail('AI_RESOURCE_UNAVAILABLE', 404);
  const targetAuthority = { tenantId: target.tenantId, enabling: false };
  return write(async (tx, recheckInWrite) => {
    const reused = await tx.aiTenantAiCreditRequest.findFirst({ where: { decidedBy: actorId, decisionOperationKey: input.operationKey }, select: { id: true } });
    if (reused && reused.id !== input.requestId) fail('AI_REVISION_CONFLICT');
    await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_tenant_ai_credit_requests WHERE id = ${input.requestId} FOR UPDATE`);
    const row = await tx.aiTenantAiCreditRequest.findUnique({ where: { id: input.requestId }, include: requestInclude });
    if (!row || row.tenantId !== target.tenantId) fail('AI_RESOURCE_UNAVAILABLE', 404);
    if (row.state !== 'pending') { if (row.decisionHash !== decisionHash) fail('AI_REVISION_CONFLICT'); await recheckInWrite(); return present(row); }
    if (row.revision !== input.expectedRevision) fail('AI_REVISION_CONFLICT');
    // A frozen target may still expose the same committed decision. Only a
    // new grant requires an active target through the final transaction check.
    targetAuthority.enabling = input.decision === 'approve';
    if (input.decision === 'approve') {
      if (row.tenant.status !== 'ACTIVE') fail('AI_ACCESS_DENIED', 403);
      if (input.amount!.gt(row.requestedAmount)) fail('AI_CREDIT_ALLOCATION_EXCEEDED');
      if (!(await readCreditCurrencies(tx, undefined, row.currency)).includes(row.currency)) fail('AI_PLATFORM_PRICING_NOT_CONFIGURED', 503);
      await tx.$queryRaw(prismaRuntime.sql`SELECT tenantId FROM ai_tenant_ai_allowances WHERE tenantId = ${row.tenantId} AND currency = ${row.currency} FOR UPDATE`);
      const current = await tx.aiTenantAiAllowance.findUnique({ where: { tenantId_currency: { tenantId: row.tenantId, currency: row.currency } } });
      if (creditAtoms(current?.grantedAmount ?? '0') + creditAtoms(input.amount!) > creditAtoms('999999999999999999.999999')) fail('AI_CREDIT_ALLOCATION_EXCEEDED');
      await tx.aiTenantAiAllowance.upsert({ where: { tenantId_currency: { tenantId: row.tenantId, currency: row.currency } },
        create: { tenantId: row.tenantId, currency: row.currency, grantedAmount: input.amount!, allocationsJson: {} },
        update: { grantedAmount: { increment: input.amount! }, revision: { increment: 1 } } });
    }
    await recheckInWrite();
    const changed = await tx.aiTenantAiCreditRequest.updateMany({ where: { id: row.id, state: 'pending', revision: input.expectedRevision },
      data: { state: input.decision === 'approve' ? 'approved' : 'rejected', grantedAmount: input.amount ?? null,
        decidedBy: actorId, decisionOperationKey: input.operationKey, decisionHash, decidedAt: new Date(), revision: { increment: 1 } } });
    if (changed.count !== 1) fail('AI_REVISION_CONFLICT');
    const saved = await tx.aiTenantAiCreditRequest.findUniqueOrThrow({ where: { id: row.id }, include: requestInclude });
    return present(saved);
  }, targetAuthority);
}
