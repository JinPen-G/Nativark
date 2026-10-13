import { z } from 'zod';
import type { AiScopeRepository } from '../ai-scope.repository';
import type { AiTaskRepositoryAuthority } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { BudgetError } from './budget.ports';
import { AI_USAGE_DRAFT_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS, type AiExecutionContext, type AiTaskBudgetUsagePageDraft } from '@rental-os/shared';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$ref' && typeof child === 'string'
    ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:task-usage:') : refs(child)])) : value;
for (const [name, schema] of Object.entries({ ...AI_USAGE_DRAFT_SCHEMAS,
  AiTaskBudgetUsagePageDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiTaskBudgetUsagePageDraft })) {
  ajv.addSchema(refs(schema) as object, `urn:rental:task-usage:${name}`);
}
const checkedPage = ajv.getSchema<AiTaskBudgetUsagePageDraft>('urn:rental:task-usage:AiTaskBudgetUsagePageDraft')!;

const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const callId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const request = z.object({ taskId: id, limit: z.number().int().min(1).max(20), after: id.optional() }).strict();
export type TaskBudgetUsageDb = ConstructorParameters<typeof PrismaBudgetRepository>[0]
  & ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0];
const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return requestFingerprint(value);
};

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
  async read(value: unknown): Promise<AiTaskBudgetUsagePageDraft> {
    const parsed = request.safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const command = parsed.data, before = await this.current(command.taskId);
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
    for (const row of rows.slice(0, command.limit)) {
      const reservation = structuredClone(await this.db.aiBudgetReservation.findUnique({ where: {
        scopeId_scopeKind_callId: { scopeId: before.scopeId, scopeKind: 'WORKSPACE', callId: row.callId } },
        select: { id: true, scopeId: true, scopeKind: true, actorId: true, callId: true } }));
      if (!reservation) {
        items.push({ invocationId: row.id, callId: row.callId, accounting: 'not_recorded' as const });
        continue;
      }
      if (reservation.scopeId !== before.scopeId || reservation.scopeKind !== 'WORKSPACE'
        || reservation.actorId !== before.actorId || reservation.callId !== row.callId) throw new BudgetError('FORBIDDEN');
      const binding = structuredClone(await this.bindings.resolveForReservation(before.gateway, reservation.id));
      if (binding.actorId !== before.actorId || binding.association.requestId !== row.callId) throw new BudgetError('FORBIDDEN');
      const original = await this.db.aiGatewayInvocation.findFirst({ where: { ...where, id: row.id, callId: row.callId } });
      if (!original || original.id !== row.id || original.taskId !== command.taskId
        || original.runId !== binding.association.runId || original.stepId !== binding.association.stepId
        || original.actionId !== binding.association.actionId || original.priceVersion !== binding.association.priceVersion
        || original.configurationHash !== requestFingerprint(binding.association.config)) throw new BudgetError('FORBIDDEN');
      const record = structuredClone(await this.records.get(reservation.id, binding.association));
      if (!record || record.actorId !== before.actorId || record.scopeId !== before.scopeId
        || record.callId !== row.callId || (record.status === 'settled' && record.actual === null)) throw new BudgetError('UNAVAILABLE');
      observations.push({ record, fingerprint: requestFingerprint(record) });
      items.push({ invocationId: row.id, callId: row.callId, reservationId: record.id, accounting: 'recorded' as const,
        sceneCode: record.sceneCode, runId: record.association.runId, stepId: record.association.stepId,
        revision: record.revision, observedVersionAt: record.storageVersion.toISOString(), status: record.status,
        reserved: structuredClone(record.reserved), actual: structuredClone(record.actual), budgetDispatchMarked: record.dispatched,
        modelPolicy: record.association.config.serviceMode === 'platform_managed'
          ? { mode: 'platform_managed' as const, serviceName: 'Rental OS AI' as const }
          : { mode: 'tenant_managed' as const, model: record.association.config.model } });
    }
    // Fresh original record observations; neither expiry nor a changed model
    // config authorizes release, settlement, retry or a replacement call.
    for (const observation of observations) {
      const current = await this.records.get(observation.record.id, observation.record.association);
      if (!current || requestFingerprint(current) !== observation.fingerprint) throw new BudgetError('PENDING_RECONCILIATION');
    }
    const after = await this.current(command.taskId), now = this.clock();
    if (before.scopeId !== after.scopeId || identity(before.context) !== identity(after.context)) throw new BudgetError('FORBIDDEN');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('UNAVAILABLE');
    const page = { taskId: command.taskId, items, nextAfter: rows.length > command.limit ? rows[command.limit - 1].id : null,
      observedAt: now.toISOString(), coverage: 'page_not_total' as const, totals: 'not_computed' as const,
      consistency: 'revalidated_reads_not_atomic_snapshot' as const,
      absenceSemantics: 'no_record_is_not_proof_of_no_consumption' as const,
      businessExecution: 'not_inferred_from_usage' as const, admission: 'not_granted' as const };
    if (!checkedPage(page) || Buffer.byteLength(JSON.stringify(page), 'utf8') > 65536) throw new BudgetError('UNAVAILABLE');
    return page;
  }
}
