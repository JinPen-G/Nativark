import { Injectable, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AiCreditBalance, AiCreditRequest, AiCreditSummary, AiTenantCallRecord, AiTenantCallRecords } from '@rental-os/shared';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../../auth/auth.service';
import { creditAllocations, creditConsumption } from './platform-credit-limit';
import { isGatewayConfig } from '../gateway-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { modelUsageSchema } from '../model-gateway.ports';
import { CountCallHistoryReader, type CallHistoryAnchor } from './count-call-history.reader';

const id = z.string().min(1).max(191), key = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const currency = z.string().regex(/^[A-Z]{3}$/u);
const amount = z.string().regex(/^(0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/u)
  .transform(value => new Prisma.Decimal(value)).refine(value => value.isFinite() && value.gt(0));
const applySchema = z.object({ operationKey: key, currency, amount }).strict();
const decisionSchema = z.object({ requestId: id, operationKey: key, expectedRevision: z.number().int().positive(),
  decision: z.enum(['approve', 'reject']), amount: amount.optional() }).strict()
  .refine(value => value.decision === 'approve' ? !!value.amount : value.amount === undefined);
const allocationSchema = z.object({ currency, expectedRevision: z.number().int().positive(),
  operationKey: key,
  allocations: z.array(z.object({ workspaceId: id, amount: z.string().regex(/^(0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/u) }).strict()).max(64)
    .refine(rows => new Set(rows.map(row => row.workspaceId)).size === rows.length) }).strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code: string, status = 409): never {
  throw new HttpException({ code, retryable: false, ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'read_original_operation' } : {}) }, status);
}
const iso = (value: Date) => value.toISOString();
const callQuerySchema = z.object({ since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }),
  cursor: id.optional(), workspaceId: id.optional(), mode: z.enum(['platform_managed', 'tenant_managed']).optional() }).strict();
const callSelect = { id: true, scopeId: true, taskId: true, runId: true, stepId: true, actionId: true,
  actorId: true, callId: true, sceneCode: true, createdAt: true, configuration: true, configurationHash: true, priceVersion: true,
  accountingReceipts: { take: 2, select: { id: true, scopeId: true, scopeKind: true, taskId: true, tenantId: true,
    workspaceId: true, invocationId: true, admissionId: true, reservationId: true, dispatchToken: true,
    requestHash: true, state: true, inputTokens: true, outputTokens: true, usageHash: true, usageDetails: true,
    admission: { select: { id: true, scopeKind: true, tenantId: true, workspaceId: true,
      actorId: true, callId: true, profileId: true, dispatchId: true, requestHash: true, completedAt: true } },
    reservation: { select: { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true,
      status: true, dispatchState: true, actorId: true, callId: true, requestId: true, idempotencyKey: true,
      runId: true, stepId: true, actionId: true, sceneCode: true,
      configurationHash: true, configRevision: true, priceVersion: true, billingMode: true, unitKind: true,
      actualTokens: true, actualCalls: true, actualMoney: true, moneyCurrency: true,
      ledger: { where: { kind: { in: ['settle', 'reconcile', 'release'] } }, take: 2, select: {
        reservationId: true, scopeId: true, scopeKind: true, tenantId: true, kind: true, evidenceHash: true,
        inputTokens: true, outputTokens: true, calls: true, moneyAmount: true, moneyCurrency: true, reason: true } } } } } } } as const satisfies Prisma.AiGatewayInvocationSelect;
type CallRow = Prisma.AiGatewayInvocationGetPayload<{ select: typeof callSelect }>;
type CallReceipt = CallRow['accountingReceipts'][number];
/** Mirrors the original accounting facts' immutable admission/request linkage.
 * Never checks today's admission status, TTL, capabilities or spending rights:
 * legitimate expired/revoked calls remain readable, but hashes alone cannot
 * connect a foreign admission or a different original idempotency key. */
function callAssociated(row: CallRow, receipt: CallReceipt) {
  const admission = receipt.admission, reservation = receipt.reservation, config = row.configuration;
  if (!admission || !reservation || !isGatewayConfig(config)) return false;
  return typeof admission.id === 'string' && admission.id.length > 0
    && typeof receipt.dispatchToken === 'string' && receipt.dispatchToken.length > 0
    && typeof receipt.requestHash === 'string' && receipt.requestHash.length > 0
    && receipt.admissionId === admission.id && receipt.reservationId === reservation.id
    && receipt.invocationId === row.id && receipt.taskId === row.taskId
    && admission.scopeKind === 'WORKSPACE' && admission.scopeKind === receipt.scopeKind
    && admission.tenantId === receipt.tenantId && admission.workspaceId === receipt.workspaceId
    && admission.actorId === row.actorId && admission.callId === row.callId && admission.profileId === config.configId
    && admission.dispatchId === receipt.dispatchToken && admission.requestHash === receipt.requestHash
    && reservation.requestId === row.callId && reservation.idempotencyKey === row.callId;
}
function callUsage(row: CallRow, receipt: CallReceipt | undefined) {
  if (!receipt || receipt.state !== 'dispatched' || receipt.inputTokens === null || receipt.outputTokens === null) return null;
  const usage = modelUsageSchema.safeParse({ inputTokens: Number(receipt.inputTokens), outputTokens: Number(receipt.outputTokens),
    ...(receipt.usageDetails != null ? { billingDetails: receipt.usageDetails } : {}) });
  return usage.success && requestFingerprint({ receiptId: receipt.id, invocationId: row.id,
    admissionId: receipt.admissionId, reservationId: receipt.reservationId, dispatchToken: receipt.dispatchToken,
    requestHash: receipt.requestHash, usage: usage.data }) === receipt.usageHash ? usage.data : null;
}
/** The original dispatch owner writes completedAt only after a validated
 * response, including when Tokens are absent. It attests one request, not
 * known usage, a financial settlement or permission for a new invocation. */
function callCompleted(receipt: CallReceipt) {
  const at = receipt.admission?.completedAt, reservation = receipt.reservation;
  return receipt.state === 'dispatched' && reservation.status !== 'released'
    && ['dispatched', 'completed', 'unknown'].includes(reservation.dispatchState)
    && at instanceof Date && Number.isFinite(at.getTime());
}
/** Observe the original terminal event; never price usage again from current rates.
 * A settled reservation alone does not prove its amount or even a known outcome. */
function callSettlement(row: CallRow, receipt: CallReceipt) {
  const reservation = receipt.reservation, events = reservation.ledger;
  if (reservation.status !== 'settled' || reservation.dispatchState !== 'completed' || events.length !== 1
    || reservation.priceVersion !== row.priceVersion) return null;
  const event = events[0];
  if (!['settle', 'reconcile'].includes(event.kind) || event.reservationId !== reservation.id
    || event.scopeId !== receipt.scopeId || event.scopeKind !== receipt.scopeKind || event.tenantId !== receipt.tenantId
    || event.outputTokens !== null || event.reason !== null) return null;
  let quantity;
  if (reservation.unitKind === 'money' && reservation.billingMode === 'platform_managed') {
    const money = reservation.actualMoney;
    if (!money || !money.isFinite() || money.isNegative() || money.decimalPlaces() > 6
      || !currency.safeParse(reservation.moneyCurrency).success || reservation.actualTokens !== null || reservation.actualCalls !== null
      || !event.moneyAmount?.eq(money) || event.moneyCurrency !== reservation.moneyCurrency || event.inputTokens !== null || event.calls !== null) return null;
    quantity = { unit: 'money' as const, amount: money.toFixed(6), currency: reservation.moneyCurrency!, scale: 6 as const };
  } else if (reservation.unitKind === 'tokens') {
    const tokens = reservation.actualTokens;
    if (tokens === null || tokens < 0n || tokens > BigInt(Number.MAX_SAFE_INTEGER)
      || tokens !== receipt.inputTokens! + receipt.outputTokens! || reservation.actualMoney !== null || reservation.actualCalls !== null
      || event.inputTokens !== tokens || event.calls !== null || event.moneyAmount !== null || event.moneyCurrency !== null) return null;
    quantity = { unit: 'tokens' as const, value: Number(tokens) };
  } else if (reservation.unitKind === 'calls') {
    if (reservation.actualCalls !== 1 || reservation.actualMoney !== null || reservation.actualTokens !== null
      || event.calls !== 1 || event.inputTokens !== null || event.moneyAmount !== null || event.moneyCurrency !== null) return null;
    quantity = { unit: 'calls' as const, value: 1 };
  } else return null;
  return requestFingerprint({ usageHash: receipt.usageHash, priceVersion: row.priceVersion, quantity }) === event.evidenceHash ? quantity : null;
}
function callCancelled(receipt: CallReceipt) {
  const reservation = receipt.reservation, events = reservation.ledger;
  if (receipt.state !== 'cancelled' || reservation.status !== 'released' || reservation.dispatchState !== 'not_dispatched'
    || receipt.inputTokens !== null || receipt.outputTokens !== null || receipt.usageHash !== null || receipt.usageDetails !== null
    || reservation.actualMoney !== null || reservation.actualTokens !== null || reservation.actualCalls !== null || events.length !== 1) return false;
  const event = events[0];
  return event.kind === 'release' && event.reservationId === reservation.id && event.scopeId === receipt.scopeId
    && event.scopeKind === receipt.scopeKind && event.tenantId === receipt.tenantId && event.evidenceHash === null
    && event.inputTokens === null && event.outputTokens === null && event.calls === null && event.moneyAmount === null && event.moneyCurrency === null;
}
const allocationReceipt = z.object({ kind: z.literal('ai_credit_allocation'), currency,
  commandHash: z.string().regex(/^[a-f0-9]{64}$/u), result: z.object({ state: z.literal('allocated'), revision: z.number().int().positive() }).strict() }).strict();
const allocationOperationId = (tenantId: string, userId: string, currency: string, operationKey: string) =>
  `ai-credit-allocation:${digest({ tenantId, userId, currency, operationKey })}`;
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
const requestInclude = { tenant: { select: { name: true, status: true } } } as const;
type Row = Prisma.AiTenantAiCreditRequestGetPayload<{ include: typeof requestInclude }>;
function present(row: Row): AiCreditRequest {
  if (!['pending', 'approved', 'rejected'].includes(row.state)) fail('AI_RESOURCE_UNAVAILABLE', 503);
  return { id: row.id, tenantId: row.tenantId, tenantName: row.tenant.name, currency: row.currency,
    requestedAmount: row.requestedAmount.toFixed(6), state: row.state as AiCreditRequest['state'],
    revision: row.revision, grantedAmount: row.grantedAmount?.toFixed(6) ?? null,
    createdAt: iso(row.createdAt), decidedAt: row.decidedAt ? iso(row.decidedAt) : null };
}

/** SaaS approves additional platform credit; tenant administrators distribute
 * ceilings. No supplier keys/rates or business execution are handled here. */
@Injectable()
export class AiCreditService {
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}
  /** Capture the submitted key/amount/selector before authentication awaits.
   * Report malformed input only AFTER current authority has passed, so a clone
   * failure neither changes the command nor discloses private parser details. */
  private snapshotCommand<S extends z.ZodTypeAny>(schema: S, raw: unknown): () => z.output<S> {
    let parsed: z.SafeParseReturnType<z.input<S>, z.output<S>> | undefined;
    try { parsed = schema.safeParse(structuredClone(raw)); } catch { /* rejected by the authorized reader below */ }
    return () => { if (!parsed?.success) fail('AI_INVALID_INPUT', 400); return parsed.data; };
  }
  private async identity(authorization: string | undefined, platform: boolean, manage: boolean) {
    const current = await this.auth.resolveAccessContext(authorization, { audience: 'operator' });
    if (!current || !current.user.isActive || current.hasWorkspaces && !current.workspaceValid
      || !!current.user.isSaasAdmin !== platform || (!platform && !current.tenantUser.isPlatformAdmin)) fail('AI_ACCESS_DENIED', 403);
    const required = platform ? manage ? 'system:ai-provider:manage' : 'system:ai-provider:view' : 'system:params:manage';
    if (!(current.user.permissions.includes(required) || current.user.permissions.includes('*')
      || !platform && current.user.isPlatformAdmin)) fail('AI_ACCESS_DENIED', 403);
    return { userId: current.user.id, tenantId: current.user.tenantId, workspaceId: current.workspaceId,
      permissions: [...current.user.permissions].sort(), tenantPermissions: [...current.tenantUser.permissions].sort(), platform };
  }
  private async call<T>(authorization: string | undefined, platform: boolean,
    work: (actor: Awaited<ReturnType<AiCreditService['identity']>>, recheck: () => Promise<void>) => Promise<T>, manage = false, write = false) {
    try {
      const actor = await this.identity(authorization, platform, manage), initial = digest(actor);
      const recheck = async () => { if (digest(await this.identity(authorization, platform, manage)) !== initial) fail('AI_ACCESS_DENIED', 403); };
      const result = await work(actor, recheck);
      try { await recheck(); }
      catch (error) {
        // The write transaction has already returned. Losing current delivery
        // authority cannot attest rollback or let the client discard its key.
        // Original receipt reads still require fresh authority; never replay here.
        if (write) fail('AI_RESULT_UNKNOWN');
        throw error;
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof z.ZodError) fail('AI_INVALID_INPUT', 400);
      fail('AI_RESOURCE_UNAVAILABLE', 503);
    }
  }
  private async write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    let completed = false;
    try { return await this.db.$transaction(async tx => { const result = await work(tx); completed = true; return result; },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }); }
    catch (error) { if (!completed && error instanceof HttpException) throw error; fail('AI_RESULT_UNKNOWN'); }
  }
  private async currencies(db: Pick<Tx, 'aiBudgetPolicy'> = this.db) {
    const rows = await db.aiBudgetPolicy.findMany({ where: { scopeKind: 'PLATFORM', enabled: true,
      unitKind: 'money', moneyCurrency: { not: null } }, distinct: ['moneyCurrency'], select: { moneyCurrency: true }, take: 9 });
    if (rows.length > 8 || rows.some(row => !currency.safeParse(row.moneyCurrency).success)) fail('AI_RESOURCE_UNAVAILABLE', 503);
    return rows.map(row => row.moneyCurrency!).sort();
  }
  /** One bounded read snapshot: an old allowance/assignment cannot be paired
   * with later committed consumption. Current identity is rechecked separately;
   * this projection grants no admission, allocation or financial mutation. */
  async read(authorization: string | undefined): Promise<AiCreditSummary> {
    return this.call(authorization, false, (actor, recheck) => this.db.$transaction(async tx => {
      const [currencies, accounts, requests, workspaces] = await Promise.all([
        this.currencies(tx), tx.aiTenantAiAllowance.findMany({ where: { tenantId: actor.tenantId }, take: 9 }),
        tx.aiTenantAiCreditRequest.findMany({ where: { tenantId: actor.tenantId }, include: requestInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 21 }),
        tx.businessWorkspace.findMany({ where: { tenantId: actor.tenantId }, select: { id: true, name: true }, take: 65 })]);
      if (accounts.length > 8 || workspaces.length > 64) fail('AI_RESOURCE_UNAVAILABLE', 503);
      const balances: AiCreditBalance[] = [];
      for (const row of accounts) {
        const usage = await creditConsumption(tx, actor.tenantId, row.currency);
        balances.push({ currency: row.currency, grantedAmount: row.grantedAmount.toFixed(6), spentAmount: usage.spent.toFixed(6),
          heldAmount: usage.held.toFixed(6), availableAmount: Prisma.Decimal.max(0, row.grantedAmount.sub(usage.spent).sub(usage.held)).toFixed(6),
          revision: row.revision, allocations: Object.entries(creditAllocations(row.allocationsJson)).map(([workspaceId, amount]) => ({ workspaceId, amount })) });
      }
      await recheck(); return { currencies, balances, requests: requests.slice(0, 20).map(present), workspaces,
        requestHistoryComplete: requests.length <= 20 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 }));
  }
  async request(authorization: string | undefined, raw: unknown) {
    const command = this.snapshotCommand(applySchema, raw);
    return this.call(authorization, false, async (actor, recheck) => {
      const input = command(), requestHash = digest({ currency: input.currency, amount: input.amount.toFixed(6) });
      return this.write(async tx => {
        const where = { tenantId_requestedBy_operationKey: { tenantId: actor.tenantId, requestedBy: actor.userId, operationKey: input.operationKey } };
        const previous = await tx.aiTenantAiCreditRequest.findUnique({ where, include: requestInclude });
        if (previous) { if (previous.requestHash !== requestHash) fail('AI_REVISION_CONFLICT'); await recheck(); return present(previous); }
        if (!(await this.currencies(tx)).includes(input.currency)) fail('AI_PLATFORM_PRICING_NOT_CONFIGURED', 503);
        if (await tx.aiTenantAiCreditRequest.findFirst({ where: { tenantId: actor.tenantId, currency: input.currency, state: 'pending' }, select: { id: true } })) fail('AI_CREDIT_REQUEST_PENDING');
        await recheck();
        return present(await tx.aiTenantAiCreditRequest.create({ data: { id: randomUUID(), tenantId: actor.tenantId,
          requestedBy: actor.userId, operationKey: input.operationKey, requestHash, currency: input.currency,
          requestedAmount: input.amount }, include: requestInclude }));
      });
    }, false, true);
  }
  async receipt(authorization: string | undefined, raw: unknown) {
    const command = this.snapshotCommand(z.object({ operationKey: key }).strict(), raw);
    return this.call(authorization, false, async actor => {
      const input = command();
      const row = await this.db.aiTenantAiCreditRequest.findUnique({ where: { tenantId_requestedBy_operationKey: {
        tenantId: actor.tenantId, requestedBy: actor.userId, operationKey: input.operationKey } }, include: requestInclude });
      return row ? { state: 'recorded' as const, request: present(row) } : { state: 'unknown' as const };
    });
  }
  async allocate(authorization: string | undefined, raw: unknown) {
    const command = this.snapshotCommand(allocationSchema, raw);
    return this.call(authorization, false, async (actor, recheck) => {
      const input = command();
      return this.write(async tx => {
        const operationId = allocationOperationId(actor.tenantId, actor.userId, input.currency, input.operationKey), commandHash = digest(input);
        const original = await tx.operationLog.findUnique({ where: { id: operationId } });
        if (original) {
          const receipt = allocationReceipt.safeParse(original.detail);
          if (original.tenantId !== actor.tenantId || original.userId !== actor.userId || original.workspaceId !== null
            || original.action !== 'ai.credit.allocate' || !receipt.success || receipt.data.currency !== input.currency
            || receipt.data.commandHash !== commandHash) fail('AI_REVISION_CONFLICT');
          await recheck(); return receipt.data.result;
        }
        await tx.$queryRaw(Prisma.sql`SELECT tenantId FROM ai_tenant_ai_allowances WHERE tenantId = ${actor.tenantId} AND currency = ${input.currency} FOR UPDATE`);
        const where = { tenantId_currency: { tenantId: actor.tenantId, currency: input.currency } };
        const account = await tx.aiTenantAiAllowance.findUnique({ where });
        if (!account || account.revision !== input.expectedRevision) fail('AI_REVISION_CONFLICT');
        const allocations = Object.fromEntries(input.allocations.map(row => [row.workspaceId, new Prisma.Decimal(row.amount).toFixed(6)]));
        const allowed = await tx.businessWorkspace.findMany({ where: { tenantId: actor.tenantId,
          id: { in: Object.keys(allocations) } }, select: { id: true, status: true }, take: 65 });
        if (allowed.length !== Object.keys(allocations).length) fail('AI_ACCESS_DENIED', 403);
        const total = Object.values(allocations).reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
        if (total.gt(account.grantedAmount)) fail('AI_CREDIT_ALLOCATION_EXCEEDED');
        const prior = creditAllocations(account.allocationsJson);
        if (allowed.some(row => row.status !== 'ACTIVE'
          && new Prisma.Decimal(allocations[row.id]).gt(new Prisma.Decimal(prior[row.id] ?? 0)))) fail('AI_ACCESS_DENIED', 403);
        for (const workspaceId of new Set([...Object.keys(prior), ...Object.keys(allocations)])) {
          const usage = await creditConsumption(tx, actor.tenantId, input.currency, workspaceId);
          if (usage.spent.add(usage.held).gt(new Prisma.Decimal(allocations[workspaceId] ?? 0))) fail('AI_CREDIT_ALREADY_COMMITTED');
        }
        await recheck();
        const updated = await tx.aiTenantAiAllowance.updateMany({ where: { ...where.tenantId_currency, revision: input.expectedRevision },
          data: { allocationsJson: allocations, revision: { increment: 1 } } });
        if (updated.count !== 1) fail('AI_REVISION_CONFLICT');
        const result = { state: 'allocated' as const, revision: input.expectedRevision + 1 };
        await tx.operationLog.create({ data: { id: operationId, tenantId: actor.tenantId, workspaceId: null,
          userId: actor.userId, action: 'ai.credit.allocate', detail: {
            kind: 'ai_credit_allocation', currency: input.currency, commandHash, result } } });
        return result;
      });
    }, false, true);
  }
  async allocationReceipt(authorization: string | undefined, raw: unknown) {
    const command = this.snapshotCommand(z.object({ currency, operationKey: key }).strict(), raw);
    return this.call(authorization, false, async actor => {
      const input = command();
      const row = await this.db.operationLog.findUnique({ where: { id: allocationOperationId(actor.tenantId, actor.userId, input.currency, input.operationKey) } });
      if (!row) return { state: 'unknown' as const };
      const receipt = allocationReceipt.safeParse(row.detail);
      if (row.tenantId !== actor.tenantId || row.userId !== actor.userId || row.workspaceId !== null
        || row.action !== 'ai.credit.allocate' || !receipt.success || receipt.data.currency !== input.currency) fail('AI_RESOURCE_UNAVAILABLE', 503);
      return { state: 'recorded' as const, result: receipt.data.result };
    });
  }
  async platformRead(authorization: string | undefined, raw: unknown = {}) {
    const command = this.snapshotCommand(z.object({ cursor: id.optional() }).strict(), raw);
    return this.call(authorization, true, async () => {
      const input = command();
      const rows = await this.db.aiTenantAiCreditRequest.findMany({ where: { state: 'pending' },
        include: requestInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
      return { requests: rows.slice(0, 50).map(present), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
  /** Tenant-admin metadata only, including legitimate disabled-service history.
   * Original usage, terminal ledger and reservation are read in one bounded
   * snapshot. No current rates, task text, credential/config API or ledger write. */
  async calls(authorization: string | undefined, raw: unknown): Promise<AiTenantCallRecords> {
    // Freeze scalar query fields before the first authorization await.
    const command = this.snapshotCommand(callQuerySchema, raw);
    return this.call(authorization, false, async (actor, recheck) => {
      const input = command(), since = new Date(input.since), until = new Date(input.until);
      if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || until <= since
        || until.getTime() - since.getTime() > 31 * 86400000 || until.getTime() > Date.now() + 60000) fail('AI_INVALID_INPUT', 400);
      return this.db.$transaction(async tx => {
        const spaces = await tx.businessWorkspace.findMany({ where: { tenantId: actor.tenantId,
          ...(input.workspaceId ? { id: input.workspaceId } : {}) }, select: { id: true, name: true }, take: 65 });
        if (spaces.length > 64) fail('AI_RESOURCE_UNAVAILABLE', 503);
        if (input.workspaceId && spaces.length !== 1) fail('AI_ACCESS_DENIED', 403);
        const scopes = await tx.aiScope.findMany({ where: { tenantId: actor.tenantId, kind: 'WORKSPACE',
          workspaceId: { in: spaces.map(row => row.id) } }, select: { id: true, workspaceId: true }, take: 65 });
        if (scopes.length > 64) fail('AI_RESOURCE_UNAVAILABLE', 503);
        const where: Prisma.AiGatewayInvocationWhereInput = { scopeId: { in: scopes.map(row => row.id) },
          createdAt: { gte: since, lt: until }, ...(input.mode ? { configuration: { path: '$.serviceMode', equals: input.mode } } : {}) };
        const counts = new CountCallHistoryReader(tx), countQuery = { tenantId: actor.tenantId, scopes, since, until,
          ...(input.mode ? { mode: input.mode } : {}) };
        // Check the anchor within the same tenant/space/time/source filter, then
        // page by its immutable ordering tuple, not an offset against a live row.
        const modelAnchor = input.cursor ? await tx.aiGatewayInvocation.findFirst({ where: { ...where, id: input.cursor },
          select: { id: true, createdAt: true } }) : null;
        const anchor: CallHistoryAnchor | null = modelAnchor ? { ...modelAnchor, kind: 'model' }
          : input.cursor ? await counts.anchor(countQuery, input.cursor) : null;
        if (input.cursor && !anchor) fail('AI_ACCESS_DENIED', 403);
        const position: Prisma.AiGatewayInvocationWhereInput | undefined = !anchor ? undefined
          : anchor.kind === 'input_counting' ? { createdAt: { lt: anchor.createdAt } }
            : { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] };
        const rows = await tx.aiGatewayInvocation.findMany({ where: position ? { AND: [where, position] } : where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, select: callSelect });
        if (rows.length > 51) fail('AI_RESOURCE_UNAVAILABLE', 503);
        const counted = await counts.list(countQuery, anchor ?? undefined);
        const models = rows.map(row => {
          const scope = scopes.find(scope => scope.id === row.scopeId), space = spaces.find(space => space.id === scope?.workspaceId);
          if (!scope?.workspaceId || !space || row.accountingReceipts.length > 1) fail('AI_RESOURCE_UNAVAILABLE', 503);
          const config = row.configuration, known = isGatewayConfig(config) && requestFingerprint(config) === row.configurationHash
            && 'tenantId' in config && config.tenantId === actor.tenantId
            && (config.configurationScope.kind === 'platform' || config.configurationScope.tenantId === actor.tenantId);
          const mode = known ? config.serviceMode : 'unknown' as const;
          const receipt = row.accountingReceipts[0], reservation = receipt?.reservation;
          if (receipt && reservation && (receipt.scopeKind !== 'WORKSPACE' || receipt.tenantId !== actor.tenantId || receipt.workspaceId !== space.id
            || receipt.scopeId !== row.scopeId || receipt.taskId !== row.taskId || receipt.invocationId !== row.id
            || reservation.id !== receipt.reservationId || reservation.scopeKind !== receipt.scopeKind || reservation.scopeId !== row.scopeId
            || reservation.tenantId !== receipt.tenantId || reservation.workspaceId !== receipt.workspaceId
            || reservation.actorId !== row.actorId || reservation.callId !== row.callId || reservation.sceneCode !== row.sceneCode
            || reservation.runId !== row.runId || reservation.stepId !== row.stepId || reservation.actionId !== row.actionId
            || reservation.configurationHash !== null && reservation.configurationHash !== row.configurationHash
            || known && reservation.configRevision !== config.configRevision)) fail('AI_RESOURCE_UNAVAILABLE', 503);
          const associated = receipt !== undefined && callAssociated(row, receipt);
          const usage = associated ? callUsage(row, receipt) : null;
          const settlement = receipt && usage && known && reservation?.configurationHash === row.configurationHash
            && reservation.billingMode === mode ? callSettlement(row, receipt) : null;
          const state: AiTenantCallRecord['state'] = !receipt ? 'registered'
            : !associated ? 'unknown'
            : reservation?.status === 'pending_reconciliation' || reservation?.dispatchState === 'unknown' ? 'unknown'
            : settlement ? 'settled' : callCancelled(receipt) ? 'cancelled'
            : reservation?.status === 'reserved' && reservation.dispatchState === 'not_dispatched' && receipt.state === 'reserved' ? 'reserved'
            : reservation?.status === 'reserved' && reservation.dispatchState === 'dispatched' && receipt.state === 'dispatched' ? 'dispatched' : 'unknown';
          const money = mode === 'platform_managed' && settlement?.unit === 'money' ? settlement : null;
          const record = { id: row.id, taskId: row.taskId, callId: row.callId, createdAt: iso(row.createdAt), workspaceId: space.id,
            workspaceName: space.name, actorName: '', operationKind: 'model' as const,
            calls: associated && receipt && (usage || callCompleted(receipt)) ? '1' : null,
            sceneCode: row.sceneCode, mode, modelLabel: mode === 'tenant_managed' && known ? config.model : mode === 'platform_managed' ? 'Rental OS AI' : '配置待核对',
            state, inputTokens: usage ? receipt!.inputTokens!.toString() : null, outputTokens: usage ? receipt!.outputTokens!.toString() : null,
            cachedInputTokens: usage?.billingDetails ? String(usage.billingDetails.cachedInputTokens) : null,
            amount: money?.amount ?? null, currency: money?.currency ?? null };
          return { actorId: row.actorId, createdAt: row.createdAt, record };
        });
        // Both sources are already ordered in the read transaction. Preserve
        // within-source ID order; at equal timestamps model rows come first.
        const merged = []; let modelIndex = 0, countIndex = 0;
        while (modelIndex < models.length || countIndex < counted.length) {
          if (modelIndex < models.length && (countIndex === counted.length
            || models[modelIndex].createdAt >= counted[countIndex].createdAt)) merged.push(models[modelIndex++]);
          else merged.push(counted[countIndex++]);
        }
        const page = merged.slice(0, 50), actorIds = [...new Set(page.map(row => row.actorId))];
        const users = await tx.user.findMany({ where: { tenantId: actor.tenantId, id: { in: actorIds } },
          select: { id: true, displayName: true }, take: 50 });
        const records: AiTenantCallRecord[] = page.map(({ actorId, record }) => ({ ...record,
          workspaceName: spaces.find(space => space.id === record.workspaceId)?.name ?? fail('AI_RESOURCE_UNAVAILABLE', 503),
          actorName: users.find(user => user.id === actorId)?.displayName ?? '其他授权主体' }));
        await recheck();
        return { records, nextCursor: merged.length > 50 ? page[49].record.id : null, observedAt: new Date().toISOString() };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    });
  }
  async platformReceipt(authorization: string | undefined, raw: unknown) {
    const command = this.snapshotCommand(z.object({ requestId: id, operationKey: key }).strict(), raw);
    return this.call(authorization, true, async actor => {
      const input = command();
      const row = await this.db.aiTenantAiCreditRequest.findUnique({ where: { id: input.requestId }, include: requestInclude });
      return row ? { state: 'recorded' as const, request: present(row), originalDecision: row.state === 'pending' ? 'unknown' as const
        : row.decidedBy === actor.userId && row.decisionOperationKey === input.operationKey ? 'matched' as const : 'superseded' as const }
        : { state: 'unknown' as const };
    });
  }
  async platformDecide(authorization: string | undefined, raw: unknown) {
    const command = this.snapshotCommand(decisionSchema, raw);
    return this.call(authorization, true, async (actor, recheck) => {
      const input = command(), decisionHash = digest({ actorId: actor.userId, requestId: input.requestId,
        operationKey: input.operationKey, decision: input.decision, amount: input.amount?.toFixed(6) ?? null });
      return this.write(async tx => {
        const reused = await tx.aiTenantAiCreditRequest.findFirst({ where: { decidedBy: actor.userId, decisionOperationKey: input.operationKey }, select: { id: true } });
        if (reused && reused.id !== input.requestId) fail('AI_REVISION_CONFLICT');
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tenant_ai_credit_requests WHERE id = ${input.requestId} FOR UPDATE`);
        const row = await tx.aiTenantAiCreditRequest.findUnique({ where: { id: input.requestId }, include: requestInclude });
        if (!row) fail('AI_RESOURCE_UNAVAILABLE', 404);
        if (row.state !== 'pending') { if (row.decisionHash !== decisionHash) fail('AI_REVISION_CONFLICT'); await recheck(); return present(row); }
        if (row.revision !== input.expectedRevision) fail('AI_REVISION_CONFLICT');
        if (input.decision === 'approve') {
          if (row.tenant.status !== 'ACTIVE') fail('AI_ACCESS_DENIED', 403);
          if (input.amount!.gt(row.requestedAmount)) fail('AI_CREDIT_ALLOCATION_EXCEEDED');
          if (!(await this.currencies(tx)).includes(row.currency)) fail('AI_PLATFORM_PRICING_NOT_CONFIGURED', 503);
          await tx.$queryRaw(Prisma.sql`SELECT tenantId FROM ai_tenant_ai_allowances WHERE tenantId = ${row.tenantId} AND currency = ${row.currency} FOR UPDATE`);
          const current = await tx.aiTenantAiAllowance.findUnique({ where: { tenantId_currency: { tenantId: row.tenantId, currency: row.currency } } });
          if ((current?.grantedAmount ?? new Prisma.Decimal(0)).add(input.amount!).gt('999999999999999999.999999')) fail('AI_CREDIT_ALLOCATION_EXCEEDED');
          await tx.aiTenantAiAllowance.upsert({ where: { tenantId_currency: { tenantId: row.tenantId, currency: row.currency } },
            create: { tenantId: row.tenantId, currency: row.currency, grantedAmount: input.amount!, allocationsJson: {} },
            update: { grantedAmount: { increment: input.amount! }, revision: { increment: 1 } } });
        }
        await recheck();
        const changed = await tx.aiTenantAiCreditRequest.updateMany({ where: { id: row.id, state: 'pending', revision: input.expectedRevision },
          data: { state: input.decision === 'approve' ? 'approved' : 'rejected', grantedAmount: input.amount ?? null,
            decidedBy: actor.userId, decisionOperationKey: input.operationKey, decisionHash, decidedAt: new Date(), revision: { increment: 1 } } });
        if (changed.count !== 1) fail('AI_REVISION_CONFLICT');
        const saved = await tx.aiTenantAiCreditRequest.findUniqueOrThrow({ where: { id: row.id }, include: requestInclude });
        return present(saved);
      });
    }, true, true);
  }
}
