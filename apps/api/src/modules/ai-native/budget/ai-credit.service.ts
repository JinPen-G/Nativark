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
    work: (actor: Awaited<ReturnType<AiCreditService['identity']>>, recheck: () => Promise<void>) => Promise<T>, manage = false) {
    try {
      const actor = await this.identity(authorization, platform, manage), initial = digest(actor);
      const recheck = async () => { if (digest(await this.identity(authorization, platform, manage)) !== initial) fail('AI_ACCESS_DENIED', 403); };
      const result = await work(actor, recheck); await recheck(); return result;
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
  async read(authorization: string | undefined): Promise<AiCreditSummary> {
    return this.call(authorization, false, async (actor, recheck) => {
      const [currencies, accounts, requests, workspaces] = await Promise.all([
        this.currencies(), this.db.aiTenantAiAllowance.findMany({ where: { tenantId: actor.tenantId }, take: 9 }),
        this.db.aiTenantAiCreditRequest.findMany({ where: { tenantId: actor.tenantId }, include: requestInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 21 }),
        this.db.businessWorkspace.findMany({ where: { tenantId: actor.tenantId }, select: { id: true, name: true }, take: 65 })]);
      if (accounts.length > 8 || workspaces.length > 64) fail('AI_RESOURCE_UNAVAILABLE', 503);
      const balances: AiCreditBalance[] = [];
      for (const row of accounts) {
        const usage = await creditConsumption(this.db, actor.tenantId, row.currency);
        balances.push({ currency: row.currency, grantedAmount: row.grantedAmount.toFixed(6), spentAmount: usage.spent.toFixed(6),
          heldAmount: usage.held.toFixed(6), availableAmount: Prisma.Decimal.max(0, row.grantedAmount.sub(usage.spent).sub(usage.held)).toFixed(6),
          revision: row.revision, allocations: Object.entries(creditAllocations(row.allocationsJson)).map(([workspaceId, amount]) => ({ workspaceId, amount })) });
      }
      await recheck(); return { currencies, balances, requests: requests.slice(0, 20).map(present), workspaces,
        requestHistoryComplete: requests.length <= 20 };
    });
  }
  async request(authorization: string | undefined, raw: unknown) {
    return this.call(authorization, false, async (actor, recheck) => {
      const input = applySchema.parse(structuredClone(raw)), requestHash = digest({ currency: input.currency, amount: input.amount.toFixed(6) });
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
    });
  }
  async receipt(authorization: string | undefined, raw: unknown) {
    return this.call(authorization, false, async actor => {
      const input = z.object({ operationKey: key }).strict().parse(raw);
      const row = await this.db.aiTenantAiCreditRequest.findUnique({ where: { tenantId_requestedBy_operationKey: {
        tenantId: actor.tenantId, requestedBy: actor.userId, operationKey: input.operationKey } }, include: requestInclude });
      return row ? { state: 'recorded' as const, request: present(row) } : { state: 'unknown' as const };
    });
  }
  async allocate(authorization: string | undefined, raw: unknown) {
    return this.call(authorization, false, async (actor, recheck) => {
      const input = allocationSchema.parse(structuredClone(raw));
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
    });
  }
  async allocationReceipt(authorization: string | undefined, raw: unknown) {
    return this.call(authorization, false, async actor => {
      const input = z.object({ currency, operationKey: key }).strict().parse(raw);
      const row = await this.db.operationLog.findUnique({ where: { id: allocationOperationId(actor.tenantId, actor.userId, input.currency, input.operationKey) } });
      if (!row) return { state: 'unknown' as const };
      const receipt = allocationReceipt.safeParse(row.detail);
      if (row.tenantId !== actor.tenantId || row.userId !== actor.userId || row.workspaceId !== null
        || row.action !== 'ai.credit.allocate' || !receipt.success || receipt.data.currency !== input.currency) fail('AI_RESOURCE_UNAVAILABLE', 503);
      return { state: 'recorded' as const, result: receipt.data.result };
    });
  }
  async platformRead(authorization: string | undefined, raw: unknown = {}) {
    return this.call(authorization, true, async () => {
      const input = z.object({ cursor: id.optional() }).strict().parse(raw);
      const rows = await this.db.aiTenantAiCreditRequest.findMany({ where: { state: 'pending' },
        include: requestInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
      return { requests: rows.slice(0, 50).map(present), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
  /** Tenant-admin metadata query, not a new task-data or credentials reader.
   * Supplier configuration, prompts, dispatch tokens and business inputs never
   * leave this projection. Missing usage is distinct from proven zero. */
  async calls(authorization: string | undefined, raw: unknown): Promise<AiTenantCallRecords> {
    return this.call(authorization, false, async (actor, recheck) => {
      const input = z.object({ since: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }),
        cursor: id.optional(), workspaceId: id.optional(), mode: z.enum(['platform_managed', 'tenant_managed']).optional() }).strict().parse(raw);
      const since = new Date(input.since), until = new Date(input.until);
      if (!Number.isFinite(since.getTime()) || !Number.isFinite(until.getTime()) || until <= since
        || until.getTime() - since.getTime() > 31 * 86400000 || until.getTime() > Date.now() + 60000) fail('AI_INVALID_INPUT', 400);
      const spaces = await this.db.businessWorkspace.findMany({ where: { tenantId: actor.tenantId,
        ...(input.workspaceId ? { id: input.workspaceId } : {}) }, select: { id: true, name: true }, take: 65 });
      if (spaces.length > 64) fail('AI_RESOURCE_UNAVAILABLE', 503);
      if (input.workspaceId && spaces.length !== 1) fail('AI_ACCESS_DENIED', 403);
      const scopes = await this.db.aiScope.findMany({ where: { tenantId: actor.tenantId, kind: 'WORKSPACE',
        workspaceId: { in: spaces.map(row => row.id) } }, select: { id: true, workspaceId: true }, take: 65 });
      if (scopes.length > 64) fail('AI_RESOURCE_UNAVAILABLE', 503);
      const where: Prisma.AiGatewayInvocationWhereInput = { scopeId: { in: scopes.map(row => row.id) },
        createdAt: { gte: since, lt: until }, ...(input.mode ? { configuration: { path: '$.serviceMode', equals: input.mode } } : {}) };
      // Cursor ownership is checked before pagination; a foreign cursor is not
      // used to probe another tenant's ordering or existence.
      if (input.cursor && !await this.db.aiGatewayInvocation.findFirst({ where: { ...where, id: input.cursor }, select: { id: true } })) fail('AI_ACCESS_DENIED', 403);
      const rows = await this.db.aiGatewayInvocation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), select: { id: true, scopeId: true, taskId: true,
          actorId: true, callId: true, sceneCode: true, createdAt: true, configuration: true, configurationHash: true,
          accountingReceipts: { take: 2, select: { id: true, scopeId: true, scopeKind: true, taskId: true, tenantId: true,
            workspaceId: true, invocationId: true, admissionId: true, reservationId: true, dispatchToken: true,
            requestHash: true, state: true, inputTokens: true, outputTokens: true, usageHash: true, usageDetails: true,
            reservation: { select: { status: true, actorId: true, callId: true, actualMoney: true, moneyCurrency: true } } } } } });
      const users = await this.db.user.findMany({ where: { tenantId: actor.tenantId, id: { in: rows.map(row => row.actorId) } },
        select: { id: true, displayName: true }, take: 51 });
      const records: AiTenantCallRecord[] = rows.slice(0, 50).map(row => {
        const scope = scopes.find(scope => scope.id === row.scopeId), space = spaces.find(space => space.id === scope?.workspaceId);
        if (!scope?.workspaceId || !space || row.accountingReceipts.length > 1) fail('AI_RESOURCE_UNAVAILABLE', 503);
        const config = row.configuration, known = isGatewayConfig(config) && requestFingerprint(config) === row.configurationHash;
        const mode = known && config.serviceMode === 'platform_managed' ? 'platform_managed' as const
          : known && config.serviceMode === 'tenant_managed' && 'tenantId' in config && config.tenantId === actor.tenantId ? 'tenant_managed' as const : 'unknown' as const;
        const receipt = row.accountingReceipts[0];
        if (receipt && (receipt.scopeKind !== 'WORKSPACE' || receipt.tenantId !== actor.tenantId || receipt.workspaceId !== space.id
          || receipt.scopeId !== row.scopeId || receipt.taskId !== row.taskId || receipt.invocationId !== row.id
          || receipt.reservation.actorId !== row.actorId || receipt.reservation.callId !== row.callId)) fail('AI_RESOURCE_UNAVAILABLE', 503);
        const usage = receipt?.inputTokens !== null && receipt?.inputTokens !== undefined
          && receipt.outputTokens !== null ? modelUsageSchema.safeParse({ inputTokens: Number(receipt.inputTokens),
            outputTokens: Number(receipt.outputTokens), ...(receipt.usageDetails ? { billingDetails: receipt.usageDetails } : {}) }) : null;
        const verified = !!receipt && !!usage?.success && requestFingerprint({ receiptId: receipt.id, invocationId: row.id,
          admissionId: receipt.admissionId, reservationId: receipt.reservationId, dispatchToken: receipt.dispatchToken,
          requestHash: receipt.requestHash, usage: usage.data }) === receipt.usageHash;
        const state = !receipt ? 'registered' : receipt.reservation.status === 'pending_reconciliation' ? 'unknown'
          : receipt.reservation.status === 'settled' ? 'settled' : receipt.state === 'cancelled' ? 'cancelled'
          : receipt.state === 'reserved' ? 'reserved' : receipt.state === 'dispatched' ? 'dispatched' : 'unknown';
        return { id: row.id, taskId: row.taskId, callId: row.callId, createdAt: row.createdAt.toISOString(), workspaceId: space.id,
          workspaceName: space.name, actorName: users.find(user => user.id === row.actorId)?.displayName ?? '其他授权主体',
          sceneCode: row.sceneCode, mode, modelLabel: mode === 'tenant_managed' && known ? config.model : mode === 'platform_managed' ? 'Rental OS AI' : '配置待核对',
          state, inputTokens: verified ? receipt!.inputTokens!.toString() : null, outputTokens: verified ? receipt!.outputTokens!.toString() : null,
          cachedInputTokens: verified && usage?.success && usage.data.billingDetails?.cachedInputTokens !== undefined
            ? String(usage.data.billingDetails.cachedInputTokens) : null,
          amount: mode === 'platform_managed' && state === 'settled' && verified ? receipt!.reservation.actualMoney?.toFixed(6) ?? null : null,
          currency: mode === 'platform_managed' && state === 'settled' && verified ? receipt!.reservation.moneyCurrency : null };
      });
      await recheck(); return { records, nextCursor: rows.length > 50 ? rows[49].id : null, observedAt: new Date().toISOString() };
    });
  }
  async platformReceipt(authorization: string | undefined, raw: unknown) {
    return this.call(authorization, true, async actor => {
      const input = z.object({ requestId: id, operationKey: key }).strict().parse(raw);
      const row = await this.db.aiTenantAiCreditRequest.findUnique({ where: { id: input.requestId }, include: requestInclude });
      return row ? { state: 'recorded' as const, request: present(row), originalDecision: row.state === 'pending' ? 'unknown' as const
        : row.decidedBy === actor.userId && row.decisionOperationKey === input.operationKey ? 'matched' as const : 'superseded' as const }
        : { state: 'unknown' as const };
    });
  }
  async platformDecide(authorization: string | undefined, raw: unknown) {
    return this.call(authorization, true, async (actor, recheck) => {
      const input = decisionSchema.parse(structuredClone(raw)), decisionHash = digest({ actorId: actor.userId, requestId: input.requestId,
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
    }, true);
  }
}
