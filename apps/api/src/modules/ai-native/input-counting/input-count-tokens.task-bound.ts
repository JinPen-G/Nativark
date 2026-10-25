/** The in-task counting chain: count the frozen input of one registered
 * original call under that call's own transition_task permission, then
 * publish the trusted input bound the recorded reservation requires —
 * before the budget reserve, never instead of it. The management counting
 * entry and its settings_write publication stay untouched; this chain adds
 * no route, timer, second ledger or settings grant. The counting admission
 * is a separate real call (derived id, calls unit, counting price version)
 * in the SAME original account; the generation keeps its own reservation. */
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { BudgetError } from '../budget/budget.ports';
import { GatewayDeadline } from '../gateway-deadline';
import type { AiScopeRepository } from '../ai-scope.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { PrismaGatewayInvocationBindings } from '../budget/prisma-gateway-invocation-bindings';
import { GatewayInputBoundNotFoundError, PrismaGatewayPricingRecords, gatewayPricingInvocationSelect } from '../budget/prisma-gateway-pricing-records';
import { AiTaskExecutionBudgetError } from '../task-execution-budget.ports';
import type { CountTokensReceiptDb } from './input-count-tokens.receipt';
import type { CountTokensResult } from './input-count-tokens.service';
import { countTokensOperationId, countTokensReference } from './input-count-tokens.receipt';

const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return hash(value);
};
const publishCommand = z.object({
  callId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u).optional(),
  invocationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u).optional()
}).strict().refine(item => (item.callId !== undefined) !== (item.invocationId !== undefined));

export interface TaskCountingGateSource {
  authorize(taskId: string): Promise<AiExecutionContext>;
}

type TaskDb = CountTokensReceiptDb & Pick<PrismaClient, 'aiGatewayInvocation' | 'aiProviderProfile' | 'aiScope'
  | 'aiGatewayPriceRecord' | 'aiGatewayInputBoundRecord' | 'aiBudgetPolicy' | 'aiBudgetReservation' | 'aiTask'
  | 'aiRun' | 'aiStep' | '$transaction'>;

/** Publishes the input bound of one registered invocation from its persisted
 * provider count receipt, under the original task's transition_task
 * permission. Mirrors the management publication's evidence semantics and
 * idempotent record row without consulting settings authority: the price
 * record, invocation binding, receipt binding and evidence hash are all
 * server-persisted facts re-checked here. */
export class TaskInputBoundPublisher {
  private readonly records;
  private readonly bindings;
  private readonly clock;
  private readonly timeoutMs;
  constructor(private readonly input: {
    db: TaskDb;
    scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
    taskExecution: TaskCountingGateSource;
    evidence: { readInputBound(reference: string, context: Readonly<AiExecutionContext>, binding: Readonly<{
      invocationId: string; scopeId: string; registrationHash: string; intentHash: string;
      configurationHash: string; priceVersion: string; priceHash: string; maxOutputTokens: number;
    }>): Promise<unknown> };
    timeoutMs?: number;
    clock?: () => Date;
  }) {
    if (!input?.db || typeof input.scopes?.resolveCurrent !== 'function' || typeof input.taskExecution?.authorize !== 'function'
      || typeof input.evidence?.readInputBound !== 'function'
      || input.clock !== undefined && typeof input.clock !== 'function') throw new BudgetError('UNAVAILABLE');
    this.records = new PrismaGatewayPricingRecords(input.db);
    this.bindings = new PrismaGatewayInvocationBindings(input.db, input.scopes, input.clock ?? (() => new Date()));
    this.clock = input.clock ?? (() => new Date());
    this.timeoutMs = input.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 30000) throw new BudgetError('UNAVAILABLE');
  }
  private async current() {
    const current = structuredClone(await this.input.scopes.resolveCurrent());
    const workspaceId = current.scope.workspaceId, tenantId = current.scope.tenantId;
    if (current.context.actor.kind !== 'user' || !['operator', 'staff'].includes(current.context.audience)
      || current.scope.kind !== 'WORKSPACE' || typeof workspaceId !== 'string' || typeof tenantId !== 'string')
      throw new BudgetError('FORBIDDEN');
    return { ...current, actorId: current.context.actor.userId, tenantId, workspaceId };
  }
  /** The same in-task gate the counting entry uses: the original invocation
   * row plus the transition_task permission, re-checked around the reads. */
  private async taskGate(command: { callId?: string; invocationId?: string }) {
    const current = await this.current();
    const invocation = command.invocationId !== undefined
      ? await this.input.db.aiGatewayInvocation.findUnique({ where: { id: command.invocationId } })
      : await this.input.db.aiGatewayInvocation.findUnique({
        where: { scopeId_callId: { scopeId: current.scope.id, callId: command.callId! } } });
    if (!invocation || invocation.scopeId !== current.scope.id || invocation.actorId !== current.actorId
      || command.callId !== undefined && invocation.callId !== command.callId
      || command.invocationId !== undefined && invocation.id !== command.invocationId
      || !isGatewayConfig(invocation.configuration)
      || hash(invocation.configuration) !== invocation.configurationHash) throw new BudgetError('FORBIDDEN');
    const before = structuredClone(await this.input.taskExecution.authorize(invocation.taskId));
    if (identity(before) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    const after = structuredClone(await this.input.taskExecution.authorize(invocation.taskId));
    if (identity(after) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    return { current, invocation,
      recheck: async () => {
        const latest = await this.current();
        if (latest.scope.id !== current.scope.id || identity(latest.context) !== identity(current.context)
          || identity(await this.input.taskExecution.authorize(invocation.taskId)) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
      } };
  }
  /** Idempotent publication keyed by (scope, invocation): the stored bound is
   * returned when the receipt still proves the same payload; a differing
   * bound is a conflict, never a silent overwrite. A lost create reply
   * reports pending reconciliation instead of re-publishing. */
  async publish(value: unknown, signal?: AbortSignal): Promise<{ state: 'recorded'; id: string; payloadHash: string;
    callId: string; executionPermission: false }> {
    const parsed = publishCommand.safeParse(value);
    if (!parsed.success) throw new BudgetError('INVALID');
    const life = new GatewayDeadline(this.timeoutMs, signal);
    try {
      const gate = await life.wait(() => this.taskGate(parsed.data));
      const row = await life.wait(() => this.input.db.aiGatewayInvocation.findUnique({
        where: { id: gate.invocation.id }, select: gatewayPricingInvocationSelect }));
      if (!row || row.id !== gate.invocation.id || !isGatewayConfig(row.configuration)
        || hash(row.configuration) !== row.configurationHash) throw new BudgetError('FORBIDDEN');
      const binding = structuredClone(await life.wait(() => this.bindings.resolveForReserve({
        actorId: gate.current.actorId, tenantId: gate.current.tenantId,
        workspaceId: gate.current.workspaceId }, {
        callId: row.callId, model: (row.configuration as { model: string }).model,
        maxOutputTokens: row.maxOutputTokens, intentHash: row.intentHash })));
      if (binding.association.requestId !== row.callId) throw new BudgetError('FORBIDDEN');
      const price = await life.wait(() => this.records.price(row.scopeId, row.configurationHash, row.priceVersion));
      const bound = { invocationId: row.id, scopeId: row.scopeId, registrationHash: row.registrationHash,
        intentHash: row.intentHash, configurationHash: row.configurationHash, priceVersion: row.priceVersion,
        priceHash: price.hash, maxOutputTokens: row.maxOutputTokens };
      const reference = countTokensReference(countTokensOperationId({ tenantId: gate.current.tenantId,
        workspaceId: gate.current.workspaceId, actorId: gate.current.actorId, callId: row.callId }));
      const evidence = await life.wait(() => this.input.evidence.readInputBound(reference,
        structuredClone(gate.current.context), bound));
      await life.wait(() => gate.recheck());
      const payloadHash = hash(evidence);
      const id = this.records.boundId(row.scopeId, row.id);
      let existing: { id: string; hash: string } | null = null;
      try { existing = await life.wait(() => this.records.bound(row.scopeId, row.id)); }
      catch (error) {
        if (!(error instanceof GatewayInputBoundNotFoundError)) throw error;
      }
      if (existing) {
        // The stored bound must equal the payload the receipt still proves; a
        // differing bound is a conflict, never a silent overwrite.
        if (existing.hash !== payloadHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
        await life.wait(() => gate.recheck());
        return { state: 'recorded' as const, id: existing.id, payloadHash: existing.hash, callId: row.callId,
          executionPermission: false as const };
      }
      try {
        await life.wait(() => this.input.db.aiGatewayInputBoundRecord.create({ data: { id, scopeId: row.scopeId,
          invocationId: row.id, priceRecordId: price.id, payloadHash,
          payload: JSON.parse(JSON.stringify(evidence)) as Prisma.InputJsonValue } }));
      } catch (error) {
        // A lost create reply or a unique-key loser is pending reconciliation:
        // the stored row is the truth, never a second publish with new evidence.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw new BudgetError('PENDING_RECONCILIATION');
      }
      const stored = await life.wait(() => this.records.bound(row.scopeId, row.id));
      if (!stored || stored.hash !== payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
      await life.wait(() => gate.recheck());
      return { state: 'recorded' as const, id: stored.id, payloadHash: stored.hash, callId: row.callId,
        executionPermission: false as const };
    } finally { life.close(); }
  }
}

/** The runner-facing consumer: after the server-owned invocation row is
 * registered and before the budget reserve, count the frozen input and
 * publish the trusted bound the recorded reservation requires. A definite
 * count failure fails the preparation; an unknown count keeps the runner's
 * own unknown semantics (never a redispatch); the original-key receipt
 * replay and the idempotent bound row make any retry observe instead of
 * re-send. The generation's own admission is untouched by this decorator. */
export class CountingTaskModelInvocationPreparation {
  constructor(private readonly inner: { prepare(step: unknown, lease: unknown): Promise<{ invocationId: string }> },
    private readonly chain: { taskCount(command: unknown, signal?: AbortSignal): Promise<CountTokensResult>;
      publish: (command: unknown, signal?: AbortSignal) => Promise<unknown> }) {
    if (typeof inner?.prepare !== 'function' || typeof chain?.taskCount !== 'function'
      || typeof chain?.publish !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  async prepare(step: unknown, lease: unknown): Promise<{ invocationId: string }> {
    const registered = await this.inner.prepare(step, lease);
    const counted = await this.chain.taskCount({ invocationId: registered.invocationId });
    // 'failed' is a settled real call (provider refusal): the step cannot
    // proceed and a retry observes the same receipt. 'unknown' stays unknown.
    if (counted.state === 'unknown') throw new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
    if (counted.state !== 'observed') throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
    await this.chain.publish({ invocationId: registered.invocationId });
    return registered;
  }
}
