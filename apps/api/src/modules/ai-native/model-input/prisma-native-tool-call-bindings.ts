/** Private original-call receipts, not a financial ledger or task result API.
 * Capture is one acknowledged write under the original task/dispatch identity;
 * native IDs/arguments are encrypted with the existing SecretBox. Reading a
 * receipt cannot grant execution, settle usage, retry a call or expose an SDK. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TEXT_MODEL_STEP_CODE, AI_TOOL_DRAFT_VERSION,
  type AiExecutionContext, type AiOrderExplainRequestDraft } from '@rental-os/shared';
import type { SecretBox } from '../../../common/secret-box';
import type { AiScopeRepository } from '../ai-scope.repository';
import { gatewayBudgetPrincipal } from '../budget/gateway-budget-principal';
import { isGatewayConfig, isGatewayOrderExplainRequest } from '../gateway-contract-validation';
import { ModelGatewayError, type GatewayContext, type ProtocolToolCall } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { nativeOrderToolCallSchema, type NativeToolCallBinding, type NativeToolCallBindingReader } from './native-tool-result.ports';

const id = z.string().min(1).max(191);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const rowSchema = z.object({ scopeId: id, taskId: id, invocationId: id, callIndex: z.number().int().min(0).max(7),
  runId: id, stepId: id, actionId: id, stepFingerprint: hash, actorId: id,
  configurationHash: hash, inputHash: hash, bindingHash: hash, encryptedPayload: z.string().min(1).max(65535),
  createdAt: z.date() }).strict();
type Row = z.infer<typeof rowSchema>;
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiStep' | 'aiRun' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt'>;
// The SDK delegate is isolated here; an old client genuinely lacks the table
// and must fail closed until its own migration/client is prepared, not fake it.
type BindingDelegate = { findMany(args: unknown): Promise<unknown[]>; createMany(args: unknown): Promise<{ count: number }> };
function delegate(db: unknown): BindingDelegate {
  const value = Reflect.get(db as object, 'aiGatewayToolCallBinding') as Partial<BindingDelegate> | undefined;
  if (typeof value?.findMany !== 'function' || typeof value.createMany !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  return value as BindingDelegate;
}
const denied = () => new ModelGatewayError('FORBIDDEN');
const identity = ({ authorizedAt: _at, requestId: _id, ...context }: AiExecutionContext) => requestFingerprint(context);

export class PrismaNativeToolCallBindings implements NativeToolCallBindingReader {
  private readonly resolve: AiScopeRepository['resolveCurrent'];
  constructor(private readonly db: Db, scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly secrets: Pick<SecretBox, 'encrypt' | 'decrypt'>, private readonly taskId: string,
    private readonly clock: () => Date = () => new Date()) {
    if (!id.max(36).safeParse(taskId).success || typeof scopes?.resolveCurrent !== 'function'
      || typeof db?.$transaction !== 'function' || typeof secrets?.encrypt !== 'function' || typeof secrets.decrypt !== 'function') {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    delegate(db);
    this.resolve = scopes.resolveCurrent.bind(scopes);
  }
  private async current(context: GatewayContext | AiExecutionContext) {
    const resolved = structuredClone(await this.resolve()), principal = gatewayBudgetPrincipal(resolved.context);
    if (resolved.scope.kind !== 'WORKSPACE' || principal.actorKind !== 'USER'
      || !['operator', 'staff'].includes(resolved.context.audience)) throw denied();
    if ('scope' in context) {
      if (identity(context) !== identity(resolved.context)) throw denied();
    } else if (!('tenantId' in context) || context.tenantId !== principal.tenantId
      || context.workspaceId !== principal.workspaceId || context.actorId !== principal.actorId) throw denied();
    return { resolved, principal, hash: requestFingerprint({ identity: identity(resolved.context), scope: resolved.scope }) };
  }
  private async source(db: Omit<Db, '$transaction'>, current: Awaited<ReturnType<PrismaNativeToolCallBindings['current']>>,
    selector: { callId: string } | { invocationId: string }, capture: boolean) {
    const { resolved, principal } = current;
    const task = await db.aiTask.findFirst({ where: { id: this.taskId, scopeId: resolved.scope.id,
      ownerKind: principal.actorKind, ownerId: principal.actorId, archivedAt: null } });
    const invocation = 'callId' in selector
      ? await db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: resolved.scope.id, callId: selector.callId } } })
      : await db.aiGatewayInvocation.findUnique({ where: { id: selector.invocationId } });
    const audience = resolved.context.audience === 'staff' ? 'STAFF' : 'OPERATOR';
    if (!task || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.scopeKind !== 'WORKSPACE' || task.audience !== audience
      || !invocation || invocation.scopeId !== resolved.scope.id || invocation.taskId !== task.id
      || invocation.actorId !== principal.actorId || invocation.mode !== 'invoke'
      || !isGatewayConfig(invocation.configuration) || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw denied();
    const step = await db.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id,
      runId: invocation.runId, id: invocation.stepId } });
    if (!step || step.toolCode !== AI_TEXT_MODEL_STEP_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.actionId !== invocation.actionId || step.requestFingerprint !== invocation.stepFingerprint
      || (capture ? step.status !== 'RUNNING' : step.status !== 'SUCCEEDED' || !step.resultRef)) throw denied();
    if (capture) {
      const run = await db.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: invocation.runId } });
      if (task.status !== 'RUNNING' || task.cancelRequestedAt !== null || !run || run.status !== 'RUNNING'
        || run.leaseOwnerId !== invocation.leaseOwnerId || run.fencingToken.toFixed(0) !== invocation.fencingToken.toFixed(0)
        || !run.leaseExpiresAt || run.leaseExpiresAt <= this.clock() || invocation.expiresAt <= this.clock()) throw denied();
      const receipt = await db.aiGatewayAccountingReceipt.findFirst({ where: { scopeId: task.scopeId,
        taskId: task.id, invocationId: invocation.id } });
      if (!receipt || receipt.state !== 'dispatched' || !receipt.dispatchToken
        || receipt.inputTokens === null || receipt.outputTokens === null || !receipt.usageHash
        // The accounting read also awaits SQL; its reply cannot freeze expiry.
        || run.leaseExpiresAt <= this.clock() || invocation.expiresAt <= this.clock()) throw denied();
    }
    return { scopeId: task.scopeId, taskId: task.id, invocationId: invocation.id, runId: invocation.runId,
      stepId: invocation.stepId, actionId: invocation.actionId, stepFingerprint: invocation.stepFingerprint,
      actorId: invocation.actorId, configurationHash: invocation.configurationHash,
      registrationHash: invocation.registrationHash, callId: invocation.callId };
  }
  private decode(row: Row) {
    let payload: unknown;
    try { payload = JSON.parse(this.secrets.decrypt(row.encryptedPayload).payload); } catch { throw denied(); }
    const call = nativeOrderToolCallSchema.parse(payload);
    if (requestFingerprint({ version: 'native-tool-call-binding-1', scopeId: row.scopeId, taskId: row.taskId,
      invocationId: row.invocationId, callIndex: row.callIndex, runId: row.runId, stepId: row.stepId,
      actionId: row.actionId, stepFingerprint: row.stepFingerprint, actorId: row.actorId,
      configurationHash: row.configurationHash, inputHash: row.inputHash, call }) !== row.bindingHash) throw denied();
    return call;
  }
  async capture(context: GatewayContext, callId: string, calls: readonly ProtocolToolCall[],
    candidates: readonly AiOrderExplainRequestDraft[], signal: AbortSignal) {
    context = structuredClone(context); calls = structuredClone(calls); candidates = structuredClone(candidates);
    if (!calls.length || calls.length > 8 || calls.length !== candidates.length
      || new Set(calls.map(call => call.id)).size !== calls.length) throw new ModelGatewayError('INVALID_RESPONSE');
    const parsed = calls.map((value, index) => {
      const call = nativeOrderToolCallSchema.parse(value); let args: unknown;
      try { args = JSON.parse(call.function.arguments); } catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
      if (!isGatewayOrderExplainRequest(candidates[index])
        || requestFingerprint(args) !== requestFingerprint(candidates[index].input)) throw new ModelGatewayError('INVALID_RESPONSE');
      return { call, inputHash: requestFingerprint(candidates[index]) };
    });
    let attempted = false;
    try {
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      const before = await this.current(context), original = await this.source(this.db, before, { callId }, true);
      const data = parsed.map(({ call, inputHash }, callIndex) => {
        const { registrationHash: _registration, callId: _callId, ...binding } = original;
        const bindingHash = requestFingerprint({ version: 'native-tool-call-binding-1', ...binding, callIndex, inputHash, call });
        return { ...binding, callIndex, inputHash, bindingHash, encryptedPayload: this.secrets.encrypt({ payload: JSON.stringify(call) }) };
      });
      const assertOriginalActive = async (db: Omit<Db, '$transaction'>) => {
        if (signal.aborted) throw new ModelGatewayError('CANCELLED');
        if ((await this.current(context)).hash !== before.hash
          || requestFingerprint(await this.source(db, before, { callId }, true)) !== requestFingerprint(original)) throw denied();
        if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      };
      await this.db.$transaction(async tx => {
        await assertOriginalActive(tx);
        const store = delegate(tx), previous = await store.findMany({ where: { scopeId: original.scopeId,
          taskId: original.taskId, invocationId: original.invocationId }, orderBy: { callIndex: 'asc' }, take: 9 });
        if (previous.length) {
          if (previous.length !== data.length) throw denied();
          previous.forEach((value, index) => {
            const row = rowSchema.parse(value); this.decode(row);
            if (row.callIndex !== index || row.bindingHash !== data[index].bindingHash) throw denied();
          });
          await assertOriginalActive(tx);
          return;
        }
        // Serializable storage does not freeze wall-clock expiry or an abort
        // signal while a receipt lookup/insert is awaiting its database reply.
        await assertOriginalActive(tx);
        attempted = true;
        if ((await store.createMany({ data })).count !== data.length) throw denied();
        await assertOriginalActive(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      // The transaction may have committed before delivery authority is lost.
      // Preserve that receipt and the original dispatch; never attest rollback.
      await assertOriginalActive(this.db);
    } catch (error) {
      // An attempted private receipt write cannot be retried or treated as proof
      // of rollback; the original model invocation is already dispatched.
      if (attempted) throw new ModelGatewayError('ACCOUNTING_PENDING');
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError('INVALID_RESPONSE');
    }
  }
  async readOriginal(context: AiExecutionContext, invocationId: string, callIndex: number): Promise<NativeToolCallBinding> {
    context = structuredClone(context);
    if (!id.max(36).safeParse(invocationId).success || !Number.isSafeInteger(callIndex) || callIndex < 0 || callIndex > 7) throw denied();
    const before = await this.current(context), original = await this.source(this.db, before, { invocationId }, false);
    const load = async () => {
      const rows = await delegate(this.db).findMany({ where: { scopeId: original.scopeId, taskId: original.taskId,
        invocationId, callIndex }, take: 2 });
      if (rows.length !== 1) throw denied();
      const row = rowSchema.parse(rows[0]);
      if (row.callIndex !== callIndex || Object.entries(original).some(([key, value]) =>
        key !== 'registrationHash' && key !== 'callId' && row[key as keyof Row] !== value)) throw denied();
      return row;
    };
    const row = await load(), call = this.decode(row);
    if ((await this.current(context)).hash !== before.hash
      || requestFingerprint(await this.source(this.db, before, { invocationId }, false)) !== requestFingerprint(original)
      || requestFingerprint(await load()) !== requestFingerprint(row)) throw denied();
    return { invocationId, callIndex, configurationHash: row.configurationHash, inputHash: row.inputHash,
      bindingHash: row.bindingHash, call: structuredClone(call) };
  }
}
