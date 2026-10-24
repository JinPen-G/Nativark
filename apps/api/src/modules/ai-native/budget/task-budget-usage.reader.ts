import { z } from 'zod';
import type { AiScopeRepository } from '../ai-scope.repository';
import { aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { countTokensCallId, countTokensSceneCode } from '../input-counting/input-count-tokens.receipt';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { BudgetError, type BudgetRecord } from './budget.ports';
import { AI_USAGE_DRAFT_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS, type AiExecutionContext, type AiTaskBudgetUsagePageDraft, type AiTaskBudgetUsageRecordDraft, type AiTaskBudgetUsageSummaryDraft, type AiUsageAssociationDraft } from '@rental-os/shared';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { isDeepStrictEqual } from 'node:util';
import { quantityAtoms, sameUnit } from './budget-quantity';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$ref' && typeof child === 'string'
    ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:task-usage:') : refs(child)])) : value;
for (const [name, schema] of Object.entries({ ...AI_USAGE_DRAFT_SCHEMAS,
  AiTaskBudgetUsageRecordDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiTaskBudgetUsageRecordDraft,
  AiTaskBudgetUsageSummaryDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiTaskBudgetUsageSummaryDraft,
  AiTaskBudgetUsagePageDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiTaskBudgetUsagePageDraft })) {
  ajv.addSchema(refs(schema) as object, `urn:rental:task-usage:${name}`);
}
const checkedPage = ajv.getSchema<AiTaskBudgetUsagePageDraft>('urn:rental:task-usage:AiTaskBudgetUsagePageDraft')!;
const checkedRecord = ajv.getSchema<AiTaskBudgetUsageRecordDraft>('urn:rental:task-usage:AiTaskBudgetUsageRecordDraft')!;
const checkedSummary = ajv.getSchema<AiTaskBudgetUsageSummaryDraft>('urn:rental:task-usage:AiTaskBudgetUsageSummaryDraft')!;

const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const callId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const request = z.object({ taskId: id, limit: z.number().int().min(1).max(20), after: id.optional() }).strict();
export type TaskBudgetUsageDb = ConstructorParameters<typeof PrismaBudgetRepository>[0]
  & ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0];
const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return requestFingerprint(value);
};

/** Safe shared projection of an already-authorized original record. Never
 * return the raw association, credential reference, hashes or dispatch token.
 * A counting admission is presented with its own reservation id and derived
 * count call id under the invocation's counting scene, so the count request
 * and the generation request stay separately positioned and never merge into
 * one charge. */
export function presentTaskBudgetUsageRecord(invocation: Readonly<{ id: string; callId: string }>,
  record: Readonly<BudgetRecord>, kind: 'generation' | 'count_request' = 'generation'): AiTaskBudgetUsageRecordDraft {
  const expectedCallId = kind === 'generation' ? invocation.callId : countTokensCallId(invocation.callId);
  if (record.callId !== expectedCallId || !(record.storageVersion instanceof Date)
    || !Number.isFinite(record.storageVersion.getTime()) || record.status === 'settled' && record.actual === null)
    throw new BudgetError('UNAVAILABLE');
  const projected = { invocationId: invocation.id, callId: record.callId, reservationId: record.id, accounting: 'recorded' as const,
    sceneCode: record.sceneCode, runId: record.association.runId, stepId: record.association.stepId,
    revision: record.revision, observedVersionAt: record.storageVersion.toISOString(), status: record.status,
    reserved: structuredClone(record.reserved), actual: structuredClone(record.actual), budgetDispatchMarked: record.dispatched,
    modelPolicy: record.association.config.serviceMode === 'platform_managed'
      ? { mode: 'platform_managed' as const, serviceName: 'Rental OS AI' as const }
      : { mode: 'tenant_managed' as const, model: record.association.config.model } };
  if (!checkedRecord(projected)) throw new BudgetError('UNAVAILABLE');
  return projected;
}

/** Owner-scoped original financial observations, not admission, a provider
 * request or business outcome. Current read_step_terminal remains required;
 * model availability/new-call allowance is deliberately not a history gate. */
export class TaskBudgetUsageReader {
  private readonly bindings;
  private readonly records;
  constructor(private readonly db: TaskBudgetUsageDb,
    private readonly actions: Pick<AiTaskRepositoryAuthority, 'resolve'>,
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly clock: () => Date = () => new Date()) {
    this.bindings = new PrismaGatewayInvocationBindings(db, scopes, clock);
    this.records = new PrismaBudgetRepository(db);
  }
  private async current(taskId: string) {
    const context = structuredClone(await this.actions.resolve(taskId, 'read_step_terminal'));
    const current = structuredClone(await this.scopes.resolveCurrent());
    if (identity(context) !== identity(current.context) || context.actor.kind !== 'user'
      || context.scope.kind !== 'workspace' || current.scope.kind !== 'WORKSPACE'
      || !['operator', 'staff'].includes(context.audience)) throw new BudgetError('FORBIDDEN');
    return { context, scopeId: current.scope.id, actorId: context.actor.userId,
      gateway: { actorId: context.actor.userId, tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId } };
  }
  /** An explicit, bounded original-task read. Reuse the same per-call binding
   * and ledger projections as pagination, not a second accounting algorithm.
   * Oversized tasks return no total, and missing/unsettled records stay visible. */
  async summary(value: unknown): Promise<AiTaskBudgetUsageSummaryDraft> {
    const parsed = z.object({ taskId: id }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const { taskId } = parsed.data, before = await this.current(taskId);
    const access = aiTaskAccessFromContext(before.context, taskId, this.clock());
    const owned = structuredClone(await this.db.aiTask.findFirst({ where: access.where, select: { id: true } }));
    if (!owned || owned.id !== taskId) throw new BudgetError('FORBIDDEN');
    const window = async () => structuredClone(await this.db.aiGatewayInvocation.findMany({
      where: { scopeId: before.scopeId, taskId, run: { is: { scopeId: before.scopeId, taskId,
        task: { is: access.where } } } }, orderBy: { id: 'asc' }, take: 51,
      select: { id: true, scopeId: true, taskId: true, actorId: true, callId: true,
        configurationHash: true, priceVersion: true, runId: true, stepId: true, actionId: true } }));
    const rows = await window();
    if (!Array.isArray(rows) || rows.length > 51 || new Set(rows.map(row => row.id)).size !== rows.length
      || new Set(rows.map(row => row.callId)).size !== rows.length || rows.some((row, index) =>
        !id.safeParse(row.id).success || !callId.safeParse(row.callId).success || row.scopeId !== before.scopeId
        || row.taskId !== taskId || row.actorId !== before.actorId || index > 0 && row.id <= rows[index - 1].id)) throw new BudgetError('UNAVAILABLE');
    const pages: Array<{ command: { taskId: string; limit: number; after?: string }; page: AiTaskBudgetUsagePageDraft }> = [];
    if (rows.length <= 50) {
      let after: string | undefined;
      // At most three pages, then one revalidation per page. No open-ended
      // pagination, retries, per-scope scans or background collection.
      for (let offset = 0; offset < rows.length; offset += 20) {
        const command = { taskId, limit: 20, ...(after ? { after } : {}) }, page = await this.read(command);
        const expected = rows.slice(offset, offset + 20);
        // One invocation may carry up to two records (counting admission plus
        // generation); compare the distinct invocation sequence, not item count.
        const sequence = [...new Set(page.items.map(item => item.invocationId))];
        if (page.taskId !== taskId || !page.pageAmounts || sequence.length !== expected.length
          || sequence.some((invocationId, index) => invocationId !== expected[index].id)
          || page.nextAfter !== (offset + 20 < rows.length ? expected.at(-1)!.id : null)) throw new BudgetError('PENDING_RECONCILIATION');
        pages.push({ command, page });
        after = page.nextAfter ?? undefined;
      }
      for (const { command, page } of pages) {
        const { observedAt: _, ...original } = page;
        const { observedAt: __, ...current } = await this.read(command);
        if (!isDeepStrictEqual(current, original)) throw new BudgetError('PENDING_RECONCILIATION');
      }
    }
    if (!isDeepStrictEqual(await window(), rows)) throw new BudgetError('PENDING_RECONCILIATION');
    const current = await this.current(taskId), now = this.clock();
    if (current.scopeId !== before.scopeId || identity(current.context) !== identity(before.context)) throw new BudgetError('FORBIDDEN');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('UNAVAILABLE');
    const base = { taskId, observedAt: now.toISOString(), invocationLimit: 50 as const,
      consistency: 'revalidated_reads_not_atomic_snapshot' as const, execution: 'read_only_no_dispatch_or_release' as const,
      basis: 'persisted_budget_records_not_provider_invoice' as const,
      absenceSemantics: 'no_record_is_not_proof_of_no_consumption' as const,
      businessExecution: 'not_inferred_from_usage' as const, admission: 'not_granted' as const };
    if (rows.length > 50) return { ...base, state: 'limit_exceeded', coverage: 'not_computed' };
    const groups = new Map<string, NonNullable<AiTaskBudgetUsagePageDraft['pageAmounts']>['groups'][number]>();
    const fields = ['reservedAtoms', 'pendingAtoms', 'settledAtoms', 'releasedReservationAtoms', 'settledExcessAtoms'] as const;
    let recordedCount = 0, notRecordedCount = 0, unresolved = false;
    for (const { page } of pages) {
      recordedCount += page.pageAmounts!.recordedCount;
      notRecordedCount += page.pageAmounts!.notRecordedCount;
      unresolved ||= page.items.some(item => item.accounting === 'recorded' && !['settled', 'released'].includes(item.status));
      for (const entry of page.pageAmounts!.groups) {
        const key = JSON.stringify([entry.unit, entry.currency]), existing = groups.get(key);
        if (!existing) groups.set(key, structuredClone(entry));
        else for (const field of fields) existing[field] = (BigInt(existing[field]) + BigInt(entry[field])).toString();
      }
    }
    const summary = { ...base, state: 'observed' as const, coverage: 'all_registered_invocations' as const,
      invocationCount: rows.length, recordedCount, notRecordedCount, accountingComplete: notRecordedCount === 0 && !unresolved,
      groups: [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => group) };
    if (!checkedSummary(summary) || notRecordedCount > rows.length
      || recordedCount + notRecordedCount < rows.length || recordedCount > 2 * rows.length)
      throw new BudgetError('UNAVAILABLE');
    return summary;
  }
  async read(value: unknown): Promise<AiTaskBudgetUsagePageDraft> {
    const parsed = request.safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const command = parsed.data, before = await this.current(command.taskId);
    // A foreign or missing task is refused outright: an empty page must never
    // become an existence oracle or a misleading "no consumption" answer.
    const owned = structuredClone(await this.db.aiTask.findFirst({ where: aiTaskAccessFromContext(
      before.context, command.taskId, this.clock()).where, select: { id: true } }));
    if (!owned || owned.id !== command.taskId) throw new BudgetError('FORBIDDEN');
    const where = { scopeId: before.scopeId, taskId: command.taskId, actorId: before.actorId };
    if (command.after) {
      const cursor = await this.db.aiGatewayInvocation.findFirst({ where: { ...where, id: command.after }, select: { id: true } });
      if (!cursor || cursor.id !== command.after) throw new BudgetError('INVALID');
    }
    const rows = structuredClone(await this.db.aiGatewayInvocation.findMany({ where: { ...where,
      ...(command.after ? { id: { gt: command.after } } : {}) }, take: command.limit + 1,
      orderBy: { id: 'asc' }, select: { id: true, scopeId: true, taskId: true, actorId: true, callId: true } }));
    if (!Array.isArray(rows) || rows.length > command.limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length
      || rows.some(row => !id.safeParse(row.id).success || !callId.safeParse(row.callId).success || row.scopeId !== before.scopeId || row.taskId !== command.taskId
        || row.actorId !== before.actorId)) throw new BudgetError('UNAVAILABLE');
    const items = [];
    const observations = [];
    const absentCalls: string[] = [];
    const amounts = new Map<string, { unit: 'money' | 'tokens' | 'calls'; currency: string | null; scale: 0 | 6;
      reservedAtoms: bigint; pendingAtoms: bigint; settledAtoms: bigint; releasedReservationAtoms: bigint; settledExcessAtoms: bigint }>();
    const accumulate = (record: BudgetRecord) => {
      const held = quantityAtoms(record.reserved), actual = record.actual === null ? null : quantityAtoms(record.actual);
      if (record.actual !== null && !sameUnit(record.reserved, record.actual)
        || record.status !== 'settled' && actual !== null) throw new BudgetError('UNAVAILABLE');
      const currency = record.reserved.unit === 'money' ? record.reserved.currency : null;
      const key = JSON.stringify([record.reserved.unit, currency]);
      const group = amounts.get(key) ?? { unit: record.reserved.unit, currency, scale: record.reserved.unit === 'money' ? 6 as const : 0 as const,
        reservedAtoms: 0n, pendingAtoms: 0n, settledAtoms: 0n, releasedReservationAtoms: 0n, settledExcessAtoms: 0n };
      if (record.status === 'settled') {
        if (actual === null) throw new BudgetError('UNAVAILABLE');
        group.settledAtoms += actual;
        if (actual > held) group.settledExcessAtoms += actual - held;
      } else if (record.status === 'pending_reconciliation') group.pendingAtoms += held;
      else if (record.status === 'released') group.releasedReservationAtoms += held;
      else group.reservedAtoms += held;
      amounts.set(key, group);
    };
    for (const row of rows.slice(0, command.limit)) {
      const original = await this.db.aiGatewayInvocation.findFirst({ where: { ...where, id: row.id, callId: row.callId } });
      if (!original || original.id !== row.id || original.taskId !== command.taskId || original.callId !== row.callId
        || !isGatewayConfig(original.configuration) || requestFingerprint(original.configuration) !== original.configurationHash)
        throw new BudgetError('FORBIDDEN');
      // The counting admission precedes any text dispatch and is presented as
      // its own reservation: the count request and the generation request are
      // separately metered calls that never collapse into one charge. A scene
      // code too long to derive a counting scene can never have produced a
      // counting admission (admission itself would have failed), so the lookup
      // is skipped rather than poisoning the whole page.
      const countingScene = (() => { try { return countTokensSceneCode(original.sceneCode); } catch { return null; } })();
      const countCallId = countTokensCallId(row.callId);
      const counting = countingScene === null ? null : structuredClone(await this.db.aiBudgetReservation.findUnique({ where: {
        scopeId_scopeKind_callId: { scopeId: before.scopeId, scopeKind: 'WORKSPACE', callId: countCallId } },
        select: { id: true, scopeId: true, scopeKind: true, actorId: true, callId: true, priceVersion: true } }));
      if (counting) {
        if (counting.scopeId !== before.scopeId || counting.scopeKind !== 'WORKSPACE'
          || counting.actorId !== before.actorId || counting.callId !== countCallId
          || typeof counting.priceVersion !== 'string' || !counting.priceVersion.length) throw new BudgetError('FORBIDDEN');
        const association: AiUsageAssociationDraft = { requestId: countCallId, runId: original.runId, stepId: original.stepId,
          actionId: original.actionId, idempotencyKey: countCallId, scope: structuredClone(before.context.scope),
          config: structuredClone(original.configuration) as AiUsageAssociationDraft['config'],
          priceVersion: counting.priceVersion };
        const record = structuredClone(await this.records.get(counting.id, association));
        if (!record || record.actorId !== before.actorId || record.scopeId !== before.scopeId
          || record.callId !== countCallId || record.sceneCode !== countTokensSceneCode(original.sceneCode)
          || record.status === 'settled' && record.actual === null) throw new BudgetError('UNAVAILABLE');
        observations.push(structuredClone(record));
        accumulate(record);
        items.push(presentTaskBudgetUsageRecord(row, record, 'count_request'));
      }
      const reservation = structuredClone(await this.db.aiBudgetReservation.findUnique({ where: {
        scopeId_scopeKind_callId: { scopeId: before.scopeId, scopeKind: 'WORKSPACE', callId: row.callId } },
        select: { id: true, scopeId: true, scopeKind: true, actorId: true, callId: true } }));
      if (!reservation) {
        absentCalls.push(row.callId);
        items.push({ invocationId: row.id, callId: row.callId, accounting: 'not_recorded' as const });
        continue;
      }
      if (reservation.scopeId !== before.scopeId || reservation.scopeKind !== 'WORKSPACE'
        || reservation.actorId !== before.actorId || reservation.callId !== row.callId) throw new BudgetError('FORBIDDEN');
      const binding = structuredClone(await this.bindings.resolveForReservation(before.gateway, reservation.id));
      if (binding.actorId !== before.actorId || binding.association.requestId !== row.callId) throw new BudgetError('FORBIDDEN');
      if (original.runId !== binding.association.runId || original.stepId !== binding.association.stepId
        || original.actionId !== binding.association.actionId || original.priceVersion !== binding.association.priceVersion
        || original.configurationHash !== requestFingerprint(binding.association.config)) throw new BudgetError('FORBIDDEN');
      const record = structuredClone(await this.records.get(reservation.id, binding.association));
      if (!record || record.actorId !== before.actorId || record.scopeId !== before.scopeId
        || record.callId !== row.callId || (record.status === 'settled' && record.actual === null)) throw new BudgetError('UNAVAILABLE');
      observations.push(structuredClone(record));
      accumulate(record);
      items.push(presentTaskBudgetUsageRecord(row, record));
    }
    // Fresh original record observations; neither expiry nor a changed model
    // config authorizes release, settlement, retry or a replacement call.
    for (const observation of observations) {
      const current = await this.records.get(observation.id, observation.association);
      if (!current || !isDeepStrictEqual(current, observation)) throw new BudgetError('PENDING_RECONCILIATION');
    }
    // No record is not zero consumption. If an original reservation appeared
    // during this read, refuse a stale "not recorded" page rather than hide it.
    for (const originalCallId of absentCalls) {
      if (await this.db.aiBudgetReservation.findUnique({ where: { scopeId_scopeKind_callId: {
        scopeId: before.scopeId, scopeKind: 'WORKSPACE', callId: originalCallId } }, select: { id: true } }))
        throw new BudgetError('PENDING_RECONCILIATION');
    }
    const after = await this.current(command.taskId), now = this.clock();
    if (before.scopeId !== after.scopeId || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('UNAVAILABLE');
    const page = { taskId: command.taskId, items, nextAfter: rows.length > command.limit ? rows[command.limit - 1].id : null,
      observedAt: now.toISOString(), coverage: 'page_not_total' as const, totals: 'not_computed' as const,
      pageAmounts: { coverage: 'visible_page_only' as const, basis: 'persisted_budget_records_not_provider_invoice' as const,
        recordedCount: observations.length, notRecordedCount: absentCalls.length,
        groups: [...amounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => {
          const values = { reservedAtoms: group.reservedAtoms.toString(), pendingAtoms: group.pendingAtoms.toString(),
            settledAtoms: group.settledAtoms.toString(), releasedReservationAtoms: group.releasedReservationAtoms.toString(),
            settledExcessAtoms: group.settledExcessAtoms.toString() };
          if (group.unit === 'money') {
            if (typeof group.currency !== 'string') throw new BudgetError('UNAVAILABLE');
            return { ...values, unit: group.unit, currency: group.currency, scale: 6 as const };
          }
          return { ...values, unit: group.unit, currency: null, scale: 0 as const };
        }) },
      consistency: 'revalidated_reads_not_atomic_snapshot' as const,
      absenceSemantics: 'no_record_is_not_proof_of_no_consumption' as const,
      businessExecution: 'not_inferred_from_usage' as const, admission: 'not_granted' as const };
    if (!checkedPage(page) || Buffer.byteLength(JSON.stringify(page), 'utf8') > 65536) throw new BudgetError('UNAVAILABLE');
    return page;
  }
}
