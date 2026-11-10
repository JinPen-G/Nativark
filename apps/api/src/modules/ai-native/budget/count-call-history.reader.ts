/** Projects original counting claims/receipts into tenant call metadata.
 * The enclosing credit service owns current tenant-admin authority and its
 * read transaction. No dispatch, settlement, price estimate or task body read.
 * A count is an endpoint request; its measured input is not consumed Tokens. */
import { Prisma } from '@prisma/client';
import type { AiTenantCallRecord } from '@rental-os/shared';
import { isGatewayConfig } from '../gateway-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { countTokensSupport } from '../input-counting/count-tokens.protocol';
import { countTokensDispatchClaimSchema, countTokensDispatchOperationId, countTokensOperationId,
  countTokensCallId, countTokensSceneCode, countTokensReceiptSchema, countTokensReceiptDocumentHash,
  type CountTokensReceipt } from '../input-counting/input-count-tokens.receipt';
import { ModelGatewayError } from '../model-gateway.ports';

const parentSelect = { id: true, scopeId: true, taskId: true, runId: true, stepId: true, actionId: true,
  actorId: true, callId: true, sceneCode: true, registrationHash: true, intentHash: true,
  configuration: true, configurationHash: true, priceVersion: true, maxOutputTokens: true } satisfies Prisma.AiGatewayInvocationSelect;
const reservationSelect = { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, actorId: true,
  callId: true, requestId: true, idempotencyKey: true, runId: true, stepId: true, actionId: true, sceneCode: true,
  configurationHash: true, configRevision: true, unitKind: true, reservedCalls: true, reservedTokens: true,
  reservedMoney: true, moneyCurrency: true, status: true, dispatchState: true, actualCalls: true,
  actualTokens: true, actualMoney: true, ledger: { where: { kind: { in: ['settle', 'reconcile', 'release'] } }, take: 2,
    select: { kind: true, reservationId: true, scopeId: true, scopeKind: true, tenantId: true,
      evidenceHash: true, reason: true, calls: true, inputTokens: true, outputTokens: true, moneyAmount: true, moneyCurrency: true } } } satisfies Prisma.AiBudgetReservationSelect;
type CountReservation = Prisma.AiBudgetReservationGetPayload<{ select: typeof reservationSelect }>;
type ClaimRow = { id: string; action: string; tenantId: string; workspaceId: string | null; userId: string | null;
  createdAt: Date; detail: unknown; invocationId: string | null; scopeId: string | null };
type Query = { tenantId: string; scopes: readonly { id: string; workspaceId: string | null }[];
  since: Date; until: Date; mode?: 'platform_managed' | 'tenant_managed' };
export type CallHistoryAnchor = { id: string; createdAt: Date; kind: 'model' | 'input_counting' };
export type CountCallHistoryEntry = { actorId: string; createdAt: Date; record: AiTenantCallRecord };
const unavailable = (): never => { throw new ModelGatewayError('CONFIG_INVALID'); };
const decoded = (value: unknown) => typeof value === 'string' ? JSON.parse(value) as unknown : value;

/** Same-time model rows precede counting rows; IDs compare only within their
 * own source. This keeps old model cursor ordering and avoids cross-table
 * collation assumptions or replacing stable claim IDs after a late receipt. */
export class CountCallHistoryReader {
  constructor(private readonly tx: Pick<Prisma.TransactionClient, '$queryRaw' | 'aiGatewayInvocation' | 'aiBudgetReservation' | 'operationLog'>) {}
  private async query(input: Query, anchor?: CallHistoryAnchor, id?: string): Promise<ClaimRow[]> {
    const scopes = input.scopes.filter(scope => scope.workspaceId !== null);
    if (!scopes.length) return [];
    const scopeJoin = Prisma.join(scopes.map(scope => Prisma.sql`(g.scopeId = ${scope.id} AND c.workspaceId = ${scope.workspaceId})`), ' OR ');
    const position = id !== undefined ? Prisma.sql`AND c.id = ${id}` : !anchor ? Prisma.empty
      : anchor.kind === 'model' ? Prisma.sql`AND c.createdAt <= ${anchor.createdAt}`
        : Prisma.sql`AND (c.createdAt < ${anchor.createdAt} OR (c.createdAt = ${anchor.createdAt} AND c.id < ${anchor.id}))`;
    const mode = input.mode ? Prisma.sql`AND (g.id IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(g.configuration, '$.serviceMode')) = ${input.mode})` : Prisma.empty;
    const rows = await this.tx.$queryRaw<ClaimRow[]>(Prisma.sql`SELECT c.id, c.action, c.tenantId, c.workspaceId, c.userId,
      c.createdAt, c.detail, g.id AS invocationId, g.scopeId
      FROM OperationLog c LEFT JOIN ai_gateway_invocations g
      ON g.callId = JSON_UNQUOTE(JSON_EXTRACT(c.detail, '$.callId')) AND g.actorId = c.userId AND (${scopeJoin})
      WHERE c.action = 'ai.model.count_tokens.dispatch' AND c.tenantId = ${input.tenantId}
      AND c.workspaceId IN (${Prisma.join(scopes.map(scope => scope.workspaceId!))})
      AND c.createdAt >= ${input.since} AND c.createdAt < ${input.until} ${mode} ${position}
      ORDER BY c.createdAt DESC, c.id DESC LIMIT ${id !== undefined ? 1 : 51}`);
    if (rows.length > (id !== undefined ? 1 : 51) || new Set(rows.map(row => row.id)).size !== rows.length) return unavailable();
    return rows;
  }
  private claim(row: ClaimRow, input: Query) {
    const parsed = countTokensDispatchClaimSchema.safeParse(decoded(row.detail));
    if (!parsed.success || row.action !== 'ai.model.count_tokens.dispatch' || row.tenantId !== input.tenantId
      || row.tenantId !== parsed.data.tenantId || row.workspaceId !== parsed.data.workspaceId || row.userId !== parsed.data.actorId
      || row.id !== countTokensDispatchOperationId(parsed.data) || !row.invocationId
      || !input.scopes.some(scope => scope.id === row.scopeId && scope.workspaceId === row.workspaceId)
      || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
      || row.createdAt < input.since || row.createdAt >= input.until) return unavailable();
    return parsed.data;
  }
  async anchor(input: Query, id: string): Promise<CallHistoryAnchor | null> {
    const rows = await this.query(input, undefined, id);
    if (!rows.length) return null;
    this.claim(rows[0], input);
    return { id: rows[0].id, createdAt: rows[0].createdAt, kind: 'input_counting' };
  }
  async list(input: Query, anchor?: CallHistoryAnchor): Promise<CountCallHistoryEntry[]> {
    const rows = await this.query(input, anchor);
    if (!rows.length) return [];
    const claims = rows.map(row => this.claim(row, input));
    const scopeIds = input.scopes.map(scope => scope.id), receiptIds = claims.map(countTokensOperationId);
    const [parents, reservations, receipts] = await Promise.all([
      this.tx.aiGatewayInvocation.findMany({ where: { scopeId: { in: scopeIds }, id: { in: rows.map(row => row.invocationId!) } }, take: 51, select: parentSelect }),
      this.tx.aiBudgetReservation.findMany({ where: { tenantId: input.tenantId, scopeKind: 'WORKSPACE',
        scopeId: { in: scopeIds }, id: { in: claims.map(claim => claim.reservationId) } }, take: 51, select: reservationSelect }),
      this.tx.operationLog.findMany({ where: { id: { in: receiptIds }, tenantId: input.tenantId,
        action: 'ai.model.count_tokens' }, take: 51, select: { id: true, action: true, tenantId: true, workspaceId: true, userId: true, detail: true } })
    ]);
    if ([parents.length, reservations.length, receipts.length].some(count => count > 51)) return unavailable();
    return rows.map((row, index) => {
      const claim = claims[index], parent = parents.find(parent => parent.id === row.invocationId);
      if (!parent || parent.scopeId !== row.scopeId || parent.actorId !== claim.actorId || parent.callId !== claim.callId
        || parent.registrationHash !== claim.registrationHash || parent.intentHash !== claim.intentHash
        || parent.configurationHash !== claim.configurationHash) return unavailable();
      const configuration = parent.configuration, known = isGatewayConfig(configuration)
        && requestFingerprint(configuration) === parent.configurationHash && 'tenantId' in configuration
        && configuration.tenantId === input.tenantId && (configuration.configurationScope.kind === 'platform'
          || configuration.configurationScope.tenantId === input.tenantId);
      const mode: AiTenantCallRecord['mode'] = known ? configuration.serviceMode : 'unknown';
      const reservation = reservations.find(reservation => reservation.id === claim.reservationId);
      if (!reservation) return unavailable();
      if (reservation.scopeId !== parent.scopeId || reservation.scopeKind !== 'WORKSPACE'
        || reservation.tenantId !== claim.tenantId || reservation.workspaceId !== claim.workspaceId
        || reservation.actorId !== claim.actorId || reservation.callId !== countTokensCallId(parent.callId)
        || reservation.requestId !== reservation.callId || reservation.idempotencyKey !== reservation.callId
        || reservation.runId !== parent.runId || reservation.stepId !== parent.stepId || reservation.actionId !== parent.actionId
        || reservation.sceneCode !== countTokensSceneCode(parent.sceneCode) || reservation.configurationHash !== claim.configurationHash
        || known && reservation.configRevision !== configuration.configRevision || reservation.unitKind !== 'calls'
        || reservation.reservedCalls !== 1 || reservation.reservedTokens !== null || reservation.reservedMoney !== null
        || reservation.moneyCurrency !== null) return unavailable();
      const stored = receipts.find(receipt => receipt.id === receiptIds[index]);
      let receipt: CountTokensReceipt | undefined;
      if (stored) {
        const parsed = countTokensReceiptSchema.safeParse(decoded(stored.detail));
        if (!parsed.success || stored.action !== 'ai.model.count_tokens' || stored.id !== countTokensOperationId(parsed.data)
          || stored.tenantId !== claim.tenantId || stored.workspaceId !== claim.workspaceId || stored.userId !== claim.actorId) return unavailable();
        receipt = parsed.data;
        if (receipt.scopeId !== parent.scopeId || receipt.invocationId !== parent.id || receipt.actorId !== parent.actorId
          || receipt.callId !== parent.callId || receipt.countCallId !== countTokensCallId(parent.callId)
          || receipt.registrationHash !== claim.registrationHash || receipt.intentHash !== claim.intentHash
          || receipt.configurationHash !== claim.configurationHash || receipt.countRequestHash !== claim.countRequestHash
          || receipt.priceVersion !== parent.priceVersion || receipt.maxOutputTokens !== parent.maxOutputTokens
          || receipt.sceneCode !== parent.sceneCode || receipt.admission.reservationId !== claim.reservationId
          || receipt.admission.sceneCode !== countTokensSceneCode(parent.sceneCode)
          || known && (receipt.protocol !== configuration.protocol || receipt.model !== configuration.model)) return unavailable();
      }
      const responseKnown = !!(known && countTokensSupport(configuration.protocol).supported && reservation && receipt
        && ['observed', 'failed'].includes(receipt.state) && reservation.status !== 'released'
        && ['dispatched', 'completed', 'unknown'].includes(reservation.dispatchState));
      const settled = responseKnown && this.settled(reservation!, receipt!);
      const state: AiTenantCallRecord['state'] = !known || receipt?.state === 'unknown' ? 'unknown'
        : settled ? 'settled' : reservation.status === 'reserved' && reservation.dispatchState === 'not_dispatched' ? 'reserved'
          : reservation.status === 'reserved' && reservation.dispatchState === 'dispatched' ? 'dispatched' : 'unknown';
      const record = { id: row.id, taskId: parent.taskId, callId: countTokensCallId(parent.callId), createdAt: row.createdAt.toISOString(),
        workspaceId: claim.workspaceId, workspaceName: '', actorName: '', sceneCode: parent.sceneCode, mode,
        modelLabel: mode === 'tenant_managed' && known ? configuration.model : mode === 'platform_managed' ? 'Rental OS AI' : '配置待核对',
        operationKind: 'input_counting' as const, calls: responseKnown ? '1' : null,
        state, inputTokens: null, outputTokens: null, cachedInputTokens: null, amount: null, currency: null };
      return { actorId: claim.actorId, createdAt: row.createdAt, record };
    });
  }
  private settled(row: CountReservation, receipt: CountTokensReceipt) {
    if (row.status !== 'settled' || row.dispatchState !== 'completed' || row.actualCalls !== 1
      || row.actualTokens !== null || row.actualMoney !== null || row.ledger.length !== 1) return false;
    const event = row.ledger[0];
    return ['settle', 'reconcile'].includes(event.kind) && event.reservationId === row.id && event.scopeId === row.scopeId
      && event.scopeKind === row.scopeKind && event.tenantId === row.tenantId && event.calls === 1 && event.reason === null
      && event.inputTokens === null && event.outputTokens === null && event.moneyAmount === null && event.moneyCurrency === null
      && event.evidenceHash === countTokensReceiptDocumentHash(receipt);
  }
}
