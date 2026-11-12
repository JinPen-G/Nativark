/** Registers one explicit operator model-control Run in the original Task.
 * The existing operation log is its immutable receipt. This repository never
 * dispatches models, renews old policies, changes inputs or resets resources. */
import type { PrismaClient, Prisma, AiTask, AiRun } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from './ai-task.repository';
import { aiTaskRunPlanSchema } from './runner/prisma-task-run-evidence.repository';
import type { AiTaskRunnerPlan } from './runner/ai-task-runner.ports';
import { taskStepChargesValid } from './runner/task-model-count-charge';
import { TASK_TEXT_MODEL_TOOL } from './model-input/task-model-input';
import { isGatewayResult } from './gateway-contract-validation';
import { readTaskModelRunOrigin } from './task-input/prisma-task-input.repository';
import type { WorkbenchModelControlPreparedSource } from './workbench-model-control.source';
import { WORKBENCH_MODEL_CONTROL_ACTION, WORKBENCH_MODEL_CONTROL_MARKER, WORKBENCH_MODEL_CONTROL_VERSION,
  workbenchModelControlReceiptSchema, type WorkbenchModelControlCommand, type WorkbenchModelControlReceipt,
  type WorkbenchModelControlReference, type WorkbenchModelControlOriginAccess, type WorkbenchModelControlOriginKey,
  type WorkbenchModelControlOriginTransaction, type WorkbenchModelControlOrigin,
  workbenchModelControlPreparationKeySchema, parseWorkbenchModelControl,
  type WorkbenchModelControlPreparationKey } from './workbench-model-control.contract';

export type WorkbenchModelControlDatabase = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep'
  | 'aiTaskRunPlan' | 'aiTaskRunPreparation' | 'aiTaskActionInput' | 'aiTaskResultArtifact' | 'aiTaskExecutionBudget'
  | 'aiTaskExecutionCharge' | 'aiTaskInputRequest' | 'aiTaskInputReceipt' | 'operationLog'>;
type Transaction = Omit<WorkbenchModelControlDatabase, '$transaction'>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
function uuid(value: unknown) {
  const digest = requestFingerprint(value);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
function matchesTask(task: AiTask, receipt: WorkbenchModelControlReceipt) {
  return task.id === receipt.command.taskId && task.scopeId === receipt.scopeId && task.scopeKind === 'WORKSPACE'
    && task.ownerKind === 'USER' && task.ownerId === receipt.ownerId && task.audience === 'OPERATOR'
    && task.inputRef === receipt.inputRef && task.inputRevision === receipt.inputRevision && task.inputHash === receipt.inputHash
    && task.sceneCode === receipt.sceneCode && task.sceneVersion === receipt.sceneVersion;
}
function taskProvenance(task: AiTask) {
  return { id: task.id, scopeId: task.scopeId, scopeKind: task.scopeKind, ownerId: task.ownerId,
    ownerKind: task.ownerKind, audience: task.audience, inputRef: task.inputRef,
    inputRevision: task.inputRevision, inputHash: task.inputHash, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion };
}

export class WorkbenchModelControlRepository {
  constructor(private readonly db: WorkbenchModelControlDatabase, private readonly authority: AiTaskRepositoryAuthority,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db.operationLog?.findFirst !== 'function'
      || typeof db.aiTaskRunPreparation?.findMany !== 'function'
      || typeof authority?.resolve !== 'function') throw unavailable();
  }
  async current(taskId: string) {
    const context = structuredClone(await this.authority.resolve(taskId, 'read_metadata'));
    if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw denied();
    const access = aiTaskAccessFromContext(context, taskId, this.clock());
    const task = await this.db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== taskId || task.ownerId !== context.actor.userId || task.ownerKind !== 'USER'
      || task.audience !== 'OPERATOR' || task.scopeKind !== 'WORKSPACE' || task.archivedAt !== null) throw denied();
    return { context: { ...context, audience: 'operator' as const, actor: context.actor, scope: context.scope },
      access, task, identityHash: originalIdentityHash(context) };
  }
  operationId(current: Awaited<ReturnType<WorkbenchModelControlRepository['current']>>, value: WorkbenchModelControlReference) {
    return uuid({ version: WORKBENCH_MODEL_CONTROL_VERSION, scopeId: current.task.scopeId,
      tenantId: current.context.scope.tenantId, workspaceId: current.context.scope.kind === 'workspace' ? current.context.scope.workspaceId : '',
      ownerId: current.task.ownerId, taskId: value.taskId, operationId: value.operationId });
  }
  private async receipt(tx: Transaction, current: Awaited<ReturnType<WorkbenchModelControlRepository['current']>>, reference: WorkbenchModelControlReference) {
    if (current.context.scope.kind !== 'workspace') throw denied();
    const row = await tx.operationLog.findFirst({ where: { id: this.operationId(current, reference),
      tenantId: current.context.scope.tenantId, workspaceId: current.context.scope.workspaceId,
      userId: current.task.ownerId, action: WORKBENCH_MODEL_CONTROL_ACTION } });
    if (!row) return null;
    const detail = row.detail as Record<string, unknown>;
    const parsed = workbenchModelControlReceiptSchema.safeParse(detail?.[WORKBENCH_MODEL_CONTROL_MARKER]);
    if (!parsed.success || Object.keys(detail).length !== 1) throw unavailable();
    const receipt = parsed.data;
    if (receipt.operationLogId !== row.id || receipt.runId !== row.id || row.createdAt.toISOString() !== receipt.createdAt
      || receipt.tenantId !== row.tenantId || receipt.workspaceId !== row.workspaceId || receipt.ownerId !== row.userId
      || receipt.commandHash !== requestFingerprint(receipt.command) || !same(reference, { taskId: receipt.command.taskId, operationId: receipt.command.operationId })
      || receipt.identityHash !== current.identityHash || !matchesTask(current.task, receipt)) throw denied();
    return receipt;
  }
  async read(reference: WorkbenchModelControlReference) {
    const before = await this.current(reference.taskId), receipt = await this.receipt(this.db, before, reference);
    const after = await this.current(reference.taskId);
    if (before.identityHash !== after.identityHash || before.access.bindingKey !== after.access.bindingKey
      || !same(taskProvenance(before.task), taskProvenance(after.task))) throw denied();
    if (!receipt) return { current: after, receipt: null, run: null, step: null, resultId: null, uncertain: false, started: false };
    const run = await this.db.aiRun.findFirst({ where: { scopeId: receipt.scopeId, taskId: reference.taskId, id: receipt.runId } });
    if (!run || !this.matchesRun(run, receipt)) throw unavailable();
    const steps = await this.db.aiStep.findMany({ where: { scopeId: receipt.scopeId, taskId: reference.taskId, runId: receipt.runId }, take: 2 });
    if (steps.length > 1 || steps.some(step => step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION)) throw denied();
    const key = { scopeId: receipt.scopeId, taskId: reference.taskId, runId: receipt.runId };
    const preparations = await this.db.aiTaskRunPreparation.findMany({ where: key, take: 1001 });
    const charges = await this.db.aiTaskExecutionCharge.findMany({ where: key, take: 5001 });
    if (preparations.length > 1000 || charges.length > 5000) throw unavailable();
    // A recorded preparation can remain incomplete even without a model step.
    // Lease expiry or release cannot turn that original uncertainty into a
    // fresh registration or permission to repeat the operation.
    const uncertain = preparations.some(row => row.completedAt === null) || charges.some(row => row.status === 'UNKNOWN');
    const started = run.fencingToken.toFixed(0) !== '0' || preparations.length > 0 || charges.length > 0;
    const closing = await this.current(reference.taskId);
    if (closing.identityHash !== after.identityHash || closing.access.bindingKey !== after.access.bindingKey
      || !same(taskProvenance(closing.task), taskProvenance(after.task))) throw denied();
    return { current: closing, receipt, run, step: steps[0] ?? null, resultId: steps[0]?.resultRef ?? null, uncertain, started };
  }
  private matchesRun(run: AiRun, receipt: WorkbenchModelControlReceipt) {
    return run.id === receipt.runId && run.scopeId === receipt.scopeId && run.taskId === receipt.command.taskId
      && run.actorKind === 'USER' && run.actorId === receipt.ownerId && run.sequence === receipt.runSequence
      && run.inputReceiptId === null && run.resourceOriginRunId === receipt.resourceOriginRunId;
  }
  private async parent(tx: Transaction, task: AiTask, command: WorkbenchModelControlCommand, expected?: WorkbenchModelControlReceipt) {
    const key = { scopeId: task.scopeId, taskId: task.id, runId: command.sourceRunId };
    const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
    const artifact = await tx.aiTaskResultArtifact.findFirst({ where: { ...key, id: command.sourceResultId } });
    if (!run || run.actorKind !== 'USER' || run.actorId !== task.ownerId || run.status !== 'SUCCEEDED'
      || !Number.isSafeInteger(run.sequence) || run.sequence < 1 || run.sequence >= 4294967294
      || !artifact || artifact.outcome !== 'SUCCEEDED' || !artifact.completeMeasurement || artifact.errorCode !== null
      || artifact.contentHash !== requestFingerprint(artifact.payload)
      || artifact.outputBytes !== BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8'))
      || !isGatewayResult(artifact.payload) || artifact.payload.status !== 'completed'
      || artifact.payload.usage.kind !== 'reported' || artifact.payload.toolRequests.length) throw denied();
    const steps = await tx.aiStep.findMany({ where: key, take: 2 });
    const step = steps[0];
    const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    const plan = saved ? aiTaskRunPlanSchema.safeParse(saved.payload) : null;
    if (steps.length !== 1 || !step || step.status !== 'SUCCEEDED' || step.id !== artifact.stepId || step.resultRef !== artifact.id
      || step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.effect !== 'NONE' || !plan?.success || plan.data.steps.length !== 1
      || plan.data.taskId !== task.id || plan.data.runId !== run.id || saved!.planHash !== requestFingerprint(plan.data)
      || plan.data.steps[0].toolCode !== TASK_TEXT_MODEL_TOOL || plan.data.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
      || plan.data.steps[0].operation !== 'external_unknown') throw denied();
    const input = await tx.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef ?? '' } });
    const charges = await tx.aiTaskExecutionCharge.findMany({ where: { ...key, stepId: step.id }, take: 6 });
    if (!input || input.fingerprint !== step.requestFingerprint || input.registrationRef !== plan.data.steps[0].registrationRef
      || input.toolCode !== TASK_TEXT_MODEL_TOOL || input.toolVersion !== AI_TOOL_DRAFT_VERSION
      || artifact.actionId !== step.actionId || artifact.stepFingerprint !== input.fingerprint
      || !taskStepChargesValid(charges, true) || charges.some(charge => charge.status !== 'RECORDED'
        || charge.scopeId !== key.scopeId || charge.taskId !== key.taskId || charge.runId !== key.runId
        || charge.stepId !== step.id || charge.actionId !== step.actionId || charge.stepFingerprint !== input.fingerprint
        || charge.leaseOwnerId !== artifact.leaseOwnerId || charge.fencingToken.toFixed(0) !== artifact.fencingToken.toFixed(0))) throw denied();
    if (expected && (expected.sourceStepId !== step.id || expected.sourceInputId !== input.id
      || expected.sourceInputHash !== input.fingerprint || expected.sourceResultHash !== artifact.contentHash)) throw denied();
    return { run, input, artifact, step };
  }
  async register(command: WorkbenchModelControlCommand, source: WorkbenchModelControlPreparedSource) {
    const initial = await this.current(command.taskId), key = this.operationId(initial, command);
    if (source.scopeId !== initial.task.scopeId || source.identityHash !== initial.identityHash) throw denied();
    try {
      return await this.db.$transaction(async tx => {
        const existing = await this.receipt(tx, initial, { taskId: command.taskId, operationId: command.operationId });
        if (existing) { if (existing.commandHash !== requestFingerprint(command)) throw changed(); return { receipt: existing, created: false }; }
        const current = await this.current(command.taskId), task = current.task;
        if (current.identityHash !== initial.identityHash || current.access.bindingKey !== initial.access.bindingKey
          || task.revision !== command.expectedTaskRevision || task.status !== 'SUCCEEDED' || task.cancelRequestedAt !== null
          || task.inputRef === null || task.inputHash === null || task.inputRevision === null
          || command.expectedPresentationRevision !== source.presentationRevision) throw changed();
        const parent = await this.parent(tx, task, command);
        const successors = await tx.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id, sequence: { gt: parent.run.sequence } }, take: 1 });
        if (successors.length || parent.input.id !== source.sourceInputId || parent.input.fingerprint !== source.sourceInputHash
          || parent.artifact.contentHash !== source.sourceResultHash || parent.step.id !== source.sourceStepId) throw changed();
        const rootRun = await tx.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: source.resourceOriginRunId } });
        const rootSaved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
          scopeId: task.scopeId, taskId: task.id, runId: source.resourceOriginRunId } } });
        const rootPlan = rootSaved ? aiTaskRunPlanSchema.safeParse(rootSaved.payload) : null;
        if (!rootRun || rootRun.sequence !== 1 || rootRun.actorKind !== 'USER' || rootRun.actorId !== task.ownerId
          || rootRun.inputReceiptId !== null || rootRun.resourceOriginRunId !== null || !rootPlan?.success
          || rootPlan.data.steps.length !== 1 || rootPlan.data.steps[0].toolCode !== TASK_TEXT_MODEL_TOOL
          || rootSaved!.planHash !== requestFingerprint(rootPlan.data)) throw denied();
        const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: task.scopeId, taskId: task.id } } });
        if (!budget || [budget.reservedSteps, budget.reservedCalls, budget.reservedActiveMs, budget.reservedOutputBytes].some(value => value !== 0n)
          || budget.maxSteps <= budget.consumedSteps || budget.maxCalls <= budget.consumedCalls
          || budget.maxActiveMs <= budget.consumedActiveMs || budget.maxOutputBytes <= budget.consumedOutputBytes) throw unavailable();
        const now = this.clock();
        const receipt = workbenchModelControlReceiptSchema.parse({ version: WORKBENCH_MODEL_CONTROL_VERSION, command,
          commandHash: requestFingerprint(command), operationLogId: key, tenantId: current.context.scope.tenantId,
          workspaceId: current.context.scope.kind === 'workspace' ? current.context.scope.workspaceId : '', scopeId: task.scopeId,
          ownerId: task.ownerId, audience: 'OPERATOR', identityHash: current.identityHash,
          sceneCode: task.sceneCode, sceneVersion: task.sceneVersion, inputRef: task.inputRef, inputRevision: task.inputRevision, inputHash: task.inputHash,
          runId: key, runSequence: parent.run.sequence + 1, runTaskRevision: task.revision + 1,
          resourceOriginRunId: source.resourceOriginRunId, sourceStepId: parent.step.id, sourceInputId: parent.input.id,
          sourceInputHash: parent.input.fingerprint, sourceResultHash: parent.artifact.contentHash,
          materialHash: source.materialHash, fieldHash: source.fieldHash, presentationRevision: source.presentationRevision + 1,
          registrationRef: `workbench-control-${requestFingerprint({ key, command: requestFingerprint(command) })}`,
          resourceRegistrationRef: rootPlan.data.steps[0].registrationRef,
          budgetPolicyVersion: budget.policyVersion, budgetPolicyHash: budget.policyFingerprint, createdAt: now.toISOString() });
        const locked = await tx.aiTask.updateMany({ where: { ...current.access.where, revision: task.revision, status: 'SUCCEEDED',
          resultRef: task.resultRef, inputHash: task.inputHash, cancelRequestedAt: null, archivedAt: null },
          data: { status: 'RUNNING', revision: { increment: 1 } } });
        if (locked.count !== 1) throw changed();
        const budgetLocked = await tx.aiTaskExecutionBudget.updateMany({ where: { scopeId: task.scopeId, taskId: task.id,
          revision: budget.revision, reservedSteps: 0n, reservedCalls: 0n, reservedActiveMs: 0n, reservedOutputBytes: 0n },
          data: { revision: { increment: 1 } } });
        if (budgetLocked.count !== 1) throw changed();
        // Like the original input successor, this transaction activates the
        // Run alongside the aggregate CAS. It attests neither worker ownership
        // nor model dispatch; both still require the original held-Run gates.
        await tx.aiRun.create({ data: { id: key, scopeId: task.scopeId, taskId: task.id, actorKind: 'USER', actorId: task.ownerId,
          authorizedAt: now, sequence: receipt.runSequence, status: 'RUNNING', startedAt: now, revision: 1, fencingToken: '0',
          leaseOwnerId: null, leaseExpiresAt: null, inputReceiptId: null, resourceOriginRunId: receipt.resourceOriginRunId } });
        await tx.operationLog.create({ data: { id: key, tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, userId: receipt.ownerId,
          action: WORKBENCH_MODEL_CONTROL_ACTION, detail: { [WORKBENCH_MODEL_CONTROL_MARKER]: receipt } as Prisma.InputJsonValue, createdAt: now } });
        const closing = await this.current(command.taskId);
        if (closing.identityHash !== current.identityHash || closing.access.bindingKey !== current.access.bindingKey) throw denied();
        return { receipt, created: true };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      // A transaction reply can be lost after the Run and receipt committed.
      // Recovery observes that same key; it never earns another start token.
      const observed = await this.read({ taskId: command.taskId, operationId: command.operationId });
      if (observed.receipt) {
        if (observed.receipt.commandHash !== requestFingerprint(command)) throw changed();
        return { receipt: observed.receipt, created: false };
      }
      throw error;
    }
  }

  /** Resource provenance for this explicit control only. The entire original
   * saved plan is returned unchanged; its old authorization/TTL is not a new
   * dispatch grant. Preparation and execution still obtain their current grant. */
  async readPreparationOrigin(value: WorkbenchModelControlPreparationKey): Promise<AiTaskRunnerPlan> {
    const key = parseWorkbenchModelControl(workbenchModelControlPreparationKeySchema, value);
    const before = await this.current(key.taskId);
    if (before.task.scopeId !== key.scopeId) throw denied();
    const selected = await this.db.$transaction(async tx => {
      const row = await tx.operationLog.findFirst({ where: { id: key.runId, tenantId: before.context.scope.tenantId,
        workspaceId: before.context.scope.workspaceId, userId: before.task.ownerId, action: WORKBENCH_MODEL_CONTROL_ACTION } });
      const parsed = row && workbenchModelControlReceiptSchema.safeParse((row.detail as Record<string, unknown>)?.[WORKBENCH_MODEL_CONTROL_MARKER]);
      if (!parsed?.success) throw denied();
      const receipt = await this.receipt(tx, before, { taskId: key.taskId, operationId: parsed.data.command.operationId });
      if (!receipt || receipt.runId !== key.runId || receipt.resourceOriginRunId !== key.resourceOriginRunId) throw denied();
      const originKey = { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId,
        originRunId: key.resourceOriginRunId, registrationRef: receipt.registrationRef };
      const first = await this.readOrigin(tx as unknown as WorkbenchModelControlOriginTransaction, before.access, originKey);
      if (!first.control || first.control.operationLogId !== receipt.operationLogId) throw denied();
      const root = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.resourceOriginRunId } });
      const stored = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
        scopeId: key.scopeId, taskId: key.taskId, runId: key.resourceOriginRunId } } });
      if (!root || root.id !== key.resourceOriginRunId || root.scopeId !== key.scopeId || root.taskId !== key.taskId
        || root.actorKind !== 'USER' || root.actorId !== receipt.ownerId || root.sequence !== 1 || root.status !== 'SUCCEEDED'
        || root.inputReceiptId !== null || root.resourceOriginRunId !== null || !stored
        || stored.scopeId !== key.scopeId || stored.taskId !== key.taskId || stored.runId !== root.id
        || !/^[a-f0-9]{64}$/u.test(stored.authorityHash) || !stored.policyVersion
        || requestFingerprint(stored.payload) !== stored.planHash) throw denied();
      const plan = aiTaskRunPlanSchema.parse(structuredClone(stored.payload));
      if (plan.taskId !== key.taskId || plan.runId !== root.id || plan.steps.length !== 1
        || plan.steps[0].toolCode !== TASK_TEXT_MODEL_TOOL || plan.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
        || plan.steps[0].operation !== 'external_unknown' || plan.steps[0].registrationRef !== receipt.resourceRegistrationRef
        || requestFingerprint(plan) !== stored.planHash) throw denied();
      const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: key.scopeId, taskId: key.taskId } } });
      if (!budget || budget.policyVersion !== receipt.budgetPolicyVersion || budget.policyFingerprint !== receipt.budgetPolicyHash
        || budget.maxSteps !== BigInt(plan.limits.maxSteps) || budget.maxCalls !== BigInt(plan.limits.maxCalls)
        || budget.maxActiveMs !== BigInt(plan.limits.maxTotalMs) || budget.maxOutputBytes !== BigInt(plan.limits.maxOutputBytes)) throw denied();
      const current = await this.current(key.taskId);
      const latest = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
        scopeId: key.scopeId, taskId: key.taskId, runId: root.id } } });
      const closing = await this.readOrigin(tx as unknown as WorkbenchModelControlOriginTransaction, current.access, originKey);
      if (current.identityHash !== before.identityHash || current.access.bindingKey !== before.access.bindingKey
        || !same(taskProvenance(current.task), taskProvenance(before.task)) || !latest
        || latest.planHash !== stored.planHash || !same(latest.payload, stored.payload) || !same(first, closing)) throw denied();
      return plan;
    }, { isolationLevel: 'RepeatableRead' });
    const after = await this.current(key.taskId);
    if (after.identityHash !== before.identityHash || after.access.bindingKey !== before.access.bindingKey
      || !same(taskProvenance(after.task), taskProvenance(before.task))) throw denied();
    return structuredClone(selected);
  }

  /** Inject only into the operator workbench host and its result readers.
   * Ordinary/answer runs retain the original reader and its original rules. */
  async readOrigin(transaction: WorkbenchModelControlOriginTransaction, access: WorkbenchModelControlOriginAccess,
    key: WorkbenchModelControlOriginKey, visited = new Set<string>()): Promise<WorkbenchModelControlOrigin> {
    const tx = transaction as unknown as Transaction;
    if (access.audience !== 'OPERATOR' || access.actorKind !== 'USER' || typeof tx.operationLog?.findFirst !== 'function') throw denied();
    if (visited.has(key.runId) || visited.size >= 1000) throw denied();
    visited.add(key.runId);
    const row = await tx.operationLog.findFirst({ where: { id: key.runId, userId: access.actorId, action: WORKBENCH_MODEL_CONTROL_ACTION } });
    if (!row) return readTaskModelRunOrigin(transaction, access, key);
    const parsed = workbenchModelControlReceiptSchema.safeParse((row.detail as Record<string, unknown>)?.[WORKBENCH_MODEL_CONTROL_MARKER]);
    if (!parsed.success || Object.keys(row.detail as object).length !== 1) throw denied();
    const receipt = parsed.data;
    const task = await tx.aiTask.findFirst({ where: access.where });
    const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
    if (!task || !run || !matchesTask(task, receipt) || !this.matchesRun(run, receipt)
      || receipt.operationLogId !== row.id || receipt.runId !== key.runId || receipt.scopeId !== key.scopeId
      || receipt.command.taskId !== key.taskId || receipt.ownerId !== access.actorId
      || receipt.commandHash !== requestFingerprint(receipt.command) || row.tenantId !== receipt.tenantId
      || row.workspaceId !== receipt.workspaceId || row.createdAt.toISOString() !== receipt.createdAt
      || ![receipt.runId, receipt.resourceOriginRunId].includes(key.originRunId)) throw denied();
    const parent = await this.parent(tx, task, receipt.command, receipt);
    if (parent.run.sequence + 1 !== run.sequence) throw denied();
    const ownSaved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
      scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } } });
    if (ownSaved) {
      const ownPlan = aiTaskRunPlanSchema.safeParse(ownSaved.payload);
      if (!ownPlan.success || ownPlan.data.steps.length !== 1 || ownSaved.planHash !== requestFingerprint(ownPlan.data)
        || ownPlan.data.steps[0].toolCode !== TASK_TEXT_MODEL_TOOL || ownPlan.data.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
        || ownPlan.data.steps[0].operation !== 'external_unknown' || ownPlan.data.steps[0].registrationRef !== receipt.registrationRef) throw denied();
    }
    const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: key.scopeId, taskId: key.taskId } } });
    if (!budget || budget.policyVersion !== receipt.budgetPolicyVersion || budget.policyFingerprint !== receipt.budgetPolicyHash) throw denied();
    const parentOrigin = await this.readOrigin(transaction, access, { ...key, runId: parent.run.id,
      originRunId: receipt.resourceOriginRunId, registrationRef: parent.input.registrationRef }, visited);
    if (![receipt.registrationRef, parentOrigin.registrationRef, receipt.resourceRegistrationRef].includes(key.registrationRef)) throw denied();
    return { registrationRef: receipt.registrationRef, continuation: undefined, history: [],
      control: { operationLogId: receipt.operationLogId, presentationRevision: receipt.presentationRevision,
        sourceRunId: receipt.command.sourceRunId, sourceResultId: receipt.command.sourceResultId,
        resourceOriginRunId: receipt.resourceOriginRunId } };
  }
}
