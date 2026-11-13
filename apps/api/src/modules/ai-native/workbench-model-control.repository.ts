/** Registers one explicit operator model-control Run in the original Task.
 * The existing operation log is its immutable receipt. This repository never
 * dispatches models, renews old policies, changes inputs or resets resources. */
import type { PrismaClient, Prisma, AiTask, AiRun, AiStep, AiTaskActionInput } from '@prisma/client';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiConversationTurnObservationDraft,
  type AiSceneRequestReceiptDraft } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from './ai-task.repository';
import { aiTaskRunPlanSchema } from './runner/prisma-task-run-evidence.repository';
import type { AiTaskRunnerPlan } from './runner/ai-task-runner.ports';
import { taskStepChargesValid } from './runner/task-model-count-charge';
import { parseTaskModelInput, taskModelFingerprint, TASK_TEXT_MODEL_TOOL } from './model-input/task-model-input';
import { parseTaskModelDisplayWitness } from './model-input/task-model-display-witness';
import { isGatewayResult } from './gateway-contract-validation';
import { readTaskModelRunOrigin } from './task-input/prisma-task-input.repository';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { readOrderAnswerDisplayEnvelope, readOrderAnswerDisplayLineage,
  orderAnswerDisplayPolicy } from './order-answer-display.adapter';
import { aiStepActionId } from './ai-step-registration.repository';
import type { WorkbenchModelControlPreparedSource } from './workbench-model-control.source';
import { WORKBENCH_MODEL_CONTROL_ACTION, WORKBENCH_MODEL_CONTROL_MARKER, WORKBENCH_MODEL_CONTROL_VERSION,
  workbenchModelControlReceiptSchema, type WorkbenchModelControlCommand, type WorkbenchModelControlReceipt,
  type WorkbenchModelControlReference, type WorkbenchModelControlOriginAccess, type WorkbenchModelControlOriginKey,
  type WorkbenchModelControlOriginTransaction, type WorkbenchModelControlOrigin,
  workbenchModelControlPreparationKeySchema, parseWorkbenchModelControl,
  workbenchModelControlOrderAnswerOriginSchema,
  type WorkbenchModelControlPreparationKey, type WorkbenchModelControlOrderAnswerSource,
  type WorkbenchModelControlOrderAnswerOrigin } from './workbench-model-control.contract';

export type WorkbenchModelControlDatabase = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep'
  | 'aiTaskRunPlan' | 'aiTaskRunPreparation' | 'aiTaskActionInput' | 'aiTaskResultArtifact' | 'aiTaskExecutionBudget'
  | 'aiTaskExecutionCharge' | 'aiTaskInputRequest' | 'aiTaskInputReceipt' | 'operationLog'>
  & Partial<Pick<PrismaClient, 'aiTaskOriginalRequest' | 'aiConversationTurn' | 'aiConversation'>>;
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
    private readonly clock: () => Date = () => new Date(),
    private readonly assertRegistrationCurrent?: (sceneCode: string) => void,
    private readonly orderAnswer?: WorkbenchModelControlOrderAnswerSource) {
    if (typeof db?.$transaction !== 'function' || typeof db.operationLog?.findFirst !== 'function'
      || typeof db.aiTaskRunPreparation?.findMany !== 'function'
      || typeof authority?.resolve !== 'function'
      || assertRegistrationCurrent !== undefined && typeof assertRegistrationCurrent !== 'function'
      || orderAnswer !== undefined && typeof orderAnswer.readOriginal !== 'function') throw unavailable();
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
  private async measuredStep(tx: Transaction, key: { scopeId: string; taskId: string; runId: string },
    step: AiStep, input: AiTaskActionInput, model: boolean) {
    const artifact = await tx.aiTaskResultArtifact.findFirst({ where: { ...key, stepId: step.id, id: step.resultRef ?? '' } });
    const charges = await tx.aiTaskExecutionCharge.findMany({ where: { ...key, stepId: step.id }, take: 6 });
    if (step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId
      || step.status !== 'SUCCEEDED' || step.effect !== 'NONE' || step.inputRef !== input.id
      || step.requestFingerprint !== input.fingerprint || !artifact || artifact.scopeId !== key.scopeId
      || artifact.taskId !== key.taskId || artifact.runId !== key.runId || artifact.stepId !== step.id
      || artifact.id !== step.resultRef || artifact.actionId !== step.actionId || artifact.stepFingerprint !== input.fingerprint
      || artifact.outcome !== 'SUCCEEDED' || !artifact.completeMeasurement || artifact.errorCode !== null
      || artifact.contentHash !== requestFingerprint(artifact.payload)
      || artifact.outputBytes !== BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8'))
      || !taskStepChargesValid(charges, model) || !model && charges.length !== 3
      || charges.some(charge => charge.status !== 'RECORDED' || charge.scopeId !== key.scopeId
        || charge.taskId !== key.taskId || charge.runId !== key.runId || charge.stepId !== step.id
        || charge.actionId !== step.actionId || charge.stepFingerprint !== input.fingerprint
        || charge.leaseOwnerId !== artifact.leaseOwnerId || !charge.fencingToken.equals(artifact.fencingToken)
        || charge.actualAmount === null || charge.actualAmount > charge.amount
        || charge.actualAmount !== (charge.resource === 'ACTIVE_MS' ? artifact.activeMs
          : charge.resource === 'OUTPUT_BYTES' ? artifact.outputBytes : 1n))) throw denied();
    return { artifact, charges };
  }
  private async orderAnswerRoot(tx: Transaction, task: AiTask, access: WorkbenchModelControlOriginAccess,
    runId: string, reference?: { inputId: string; stepId: string; resultId: string }) {
    if (!this.orderAnswer || !task.inputRef || task.sceneCode !== 'order_explanation'
      || task.creationKey !== `scene-request:${task.inputRef}` || !tx.aiTaskOriginalRequest
      || !tx.aiConversationTurn || !tx.aiConversation) throw unavailable();
    const key = { scopeId: task.scopeId, taskId: task.id, runId };
    const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: runId } });
    if (!run || run.id !== runId || run.taskId !== task.id || run.scopeId !== task.scopeId
      || run.actorKind !== access.actorKind || run.actorId !== access.actorId || run.sequence !== 1
      || run.status !== 'SUCCEEDED' || run.inputReceiptId !== null || run.resourceOriginRunId !== null) throw denied();
    const provenance = await readOriginalTaskModelProvenance({ aiTaskOriginalRequest: tx.aiTaskOriginalRequest }, task);
    const originalRow = await tx.aiTaskOriginalRequest.findFirst({ where: { scopeId: task.scopeId,
      id: provenance.inputRef, ownerKind: task.ownerKind, ownerId: task.ownerId, audience: task.audience } });
    if (!originalRow || originalRow.sceneCode !== 'order_explanation' || originalRow.status !== 'STORED'
      || originalRow.erasedAt || originalRow.id !== provenance.inputRef || originalRow.contentHash !== provenance.contentHash) throw denied();
    const turns = await tx.aiConversationTurn.findMany({ where: { scopeId: task.scopeId,
      ownerId: task.ownerId, originalRequestId: provenance.inputRef }, take: 2 });
    const turnRow = turns[0];
    if (turns.length !== 1 || !turnRow || turnRow.scopeId !== task.scopeId || turnRow.ownerId !== task.ownerId
      || turnRow.originalRequestId !== provenance.inputRef || turnRow.originalRequestKey !== originalRow.requestKey
      || turnRow.capabilityCode !== task.sceneCode || turnRow.capabilityVersion !== task.sceneVersion
      || turnRow.inputHash !== requestFingerprint({ sceneCode: originalRow.sceneCode, input: originalRow.payload })) throw denied();
    const conversation = await tx.aiConversation.findFirst({ where: { scopeId: task.scopeId,
      ownerId: task.ownerId, id: turnRow.conversationId, deletedAt: null } });
    if (!conversation || conversation.id !== turnRow.conversationId || conversation.scopeId !== task.scopeId
      || conversation.ownerId !== task.ownerId || conversation.capabilityCode !== task.sceneCode
      || conversation.deletedAt !== null || !['active', 'archived'].includes(conversation.status)) throw denied();
    const original: AiSceneRequestReceiptDraft = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
      inputRef: originalRow.id, revision: originalRow.revision, contentHash: originalRow.contentHash,
      sceneCode: 'order_explanation', sceneVersion: originalRow.sceneVersion, requestKey: originalRow.requestKey,
      previousInputRef: originalRow.previousRequestId, expiresAt: originalRow.expiresAt.toISOString(),
      createdAt: originalRow.createdAt.toISOString(), state: originalRow.expiresAt <= this.clock() ? 'expired' : 'stored' };
    const turn: AiConversationTurnObservationDraft = { admissionKey: turnRow.admissionKey, turnId: turnRow.id,
      originalRequestKey: turnRow.originalRequestKey, requestHash: turnRow.inputHash, capabilityCode: 'order_explanation',
      capabilityVersion: turnRow.capabilityVersion, createdAt: turnRow.createdAt.toISOString(), automaticRetry: false,
      status: 'original_bound', original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: originalRow.id },
      execution: 'not_inferred_from_association', material: 'retained', task: { taskId: task.id, runId } };
    const inputs = await tx.aiTaskActionInput.findMany({ where: key, take: 4 });
    const steps = await tx.aiStep.findMany({ where: key, orderBy: { sequence: 'asc' }, take: 4 });
    const input = inputs.find(input => input.registrationRef === `scene-answer:${original.inputRef}`);
    const step = input && steps.find(step => step.inputRef === input.id && step.sequence === 3);
    if (inputs.length !== 3 || steps.length !== 3 || !input || !step || !step.resultRef
      || reference && (reference.inputId !== input.id || reference.stepId !== step.id || reference.resultId !== step.resultRef)) throw denied();
    const modelInput = parseTaskModelInput(input.payload, orderAnswerDisplayPolicy(32768));
    const proof = await readOrderAnswerDisplayLineage(tx as Prisma.TransactionClient,
      { task, access, turn, original, inputId: input.id, stepId: step.id, resultId: step.resultRef, modelInput });
    const envelope = readOrderAnswerDisplayEnvelope(modelInput, original);
    const witness = parseTaskModelDisplayWitness(modelInput.displayWitness);
    if (modelInput.identityHash !== provenance.authorizationHash || !same(witness.binding.original, turn.original)
      || witness.binding.conversationId !== turnRow.conversationId || witness.binding.turnId !== turnRow.id
      || witness.binding.taskId !== task.id || witness.presentationRevision !== run.sequence
      || !same(witness.context.scope, { kind: 'workspace', tenantId: access.scope.tenantId, workspaceId: access.scope.workspaceId })
      || witness.binding.materialHash !== envelope.materialHash || witness.binding.inputFingerprint !== task.inputHash) throw denied();
    const evidence = [];
    for (const [index, originalStep] of steps.entries()) {
      const originalInput = inputs.find(input => input.id === originalStep.inputRef);
      if (!originalInput || originalStep.actionId !== aiStepActionId(access.scope, task.id, originalInput.registrationRef)) throw denied();
      const measured = await this.measuredStep(tx, key, originalStep, originalInput, index !== 1);
      if (index === 1) {
        const facts = measured.artifact.payload as Record<string, unknown>;
        if (!facts || !same({ audience: facts.audience, scope: facts.scope, order: facts.order,
          paymentEvidence: facts.paymentEvidence, historicalFeeEvidence: facts.historicalFeeEvidence }, envelope.facts.facts)) throw denied();
      } else {
        const model = parseTaskModelInput(originalInput.payload, index === 0
          ? { sceneCode: 'order_explanation', maxOutputTokens: 32768, orderExplainTool: true } : orderAnswerDisplayPolicy(32768));
        const result = measured.artifact.payload;
        if (!isGatewayResult(result) || result.status !== 'completed' || result.usage.kind !== 'reported'
          || result.requestId !== model.intent.requestId || !same(result.actual, model.configuration)
          || taskModelFingerprint(model, index === 0
            ? { sceneCode: 'order_explanation', maxOutputTokens: 32768, orderExplainTool: true } : orderAnswerDisplayPolicy(32768)) !== originalInput.fingerprint
          || (index === 0 ? result.toolRequests.length !== 1 || !same(result.toolRequests[0], inputs.find(input => input.registrationRef === `scene-order:${original.inputRef}`)?.payload)
            : result.toolRequests.length !== 0)) throw denied();
      }
      evidence.push({ stepId: originalStep.id, artifactId: measured.artifact.id,
        contentHash: measured.artifact.contentHash, activeMs: measured.artifact.activeMs.toString(),
        outputBytes: measured.artifact.outputBytes.toString(), holderId: measured.artifact.leaseOwnerId,
        fencingToken: measured.artifact.fencingToken.toFixed(0), charges: measured.charges.map(charge => ({
          id: charge.chargeId, revision: charge.revision, resource: charge.resource, amount: charge.amount.toString(),
          actualAmount: charge.actualAmount!.toString(), evidenceRef: charge.evidenceRef,
          gatewayInvocationId: charge.gatewayInvocationId, holderId: charge.leaseOwnerId,
          fencingToken: charge.fencingToken.toFixed(0) })).sort((left, right) => left.id.localeCompare(right.id)) });
    }
    const origin = workbenchModelControlOrderAnswerOriginSchema.parse({ ...proof.orderAnswer,
      rootRunId: run.id, evidenceHash: requestFingerprint(evidence) });
    return { run, input, step, artifact: (await this.measuredStep(tx, key, step, input, true)).artifact,
      origin, proof, modelInput, original };
  }
  /** Current original Core/model reader stays outside the native transaction.
   * Native lineage then rechecks the same immutable input/result and evidence. */
  async readOrderAnswerOrigin(reference: { taskId: string; runId: string; inputId: string; stepId: string; resultId: string }) {
    if (!this.orderAnswer) throw unavailable();
    const before = await this.current(reference.taskId);
    const original = await this.orderAnswer.readOriginal(reference);
    if (original.task.taskId !== reference.taskId || original.task.originRunId !== reference.runId
      || original.model.inputRef !== reference.inputId || original.model.step.id !== reference.stepId
      || original.model.step.runId !== reference.runId || original.model.result.id !== reference.resultId
      || originalIdentityHash(original.context) !== before.identityHash) throw denied();
    const found = await this.db.$transaction(tx => this.orderAnswerRoot(tx, before.task, before.access, reference.runId, reference),
      { isolationLevel: 'RepeatableRead' });
    if (original.model.inputFingerprint !== found.input.fingerprint || original.model.result.contentHash !== found.artifact.contentHash
      || !same(original.model.input, found.modelInput) || !same(original.envelope, readOrderAnswerDisplayEnvelope(found.modelInput, found.original))) throw denied();
    const after = await this.current(reference.taskId);
    if (after.identityHash !== before.identityHash || after.access.bindingKey !== before.access.bindingKey
      || !same(taskProvenance(after.task), taskProvenance(before.task))) throw denied();
    return found.origin;
  }
  private async parent(tx: Transaction, task: AiTask, command: WorkbenchModelControlCommand, expected?: WorkbenchModelControlReceipt,
    access?: WorkbenchModelControlOriginAccess) {
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
    const steps = await tx.aiStep.findMany({ where: key, orderBy: { sequence: 'asc' }, take: 4 });
    const step = steps[0];
    const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    const plan = saved ? aiTaskRunPlanSchema.safeParse(saved.payload) : null;
    if (plan?.success && plan.data.steps.length === 3) {
      const order = await this.orderAnswerRoot(tx, task, access ?? (await this.current(task.id)).access, run.id,
        { inputId: steps.find(step => step.id === artifact.stepId)?.inputRef ?? '', stepId: artifact.stepId, resultId: artifact.id });
      if (expected && (expected.sourceStepId !== order.step.id || expected.sourceInputId !== order.input.id
        || expected.sourceInputHash !== order.input.fingerprint || expected.sourceResultHash !== order.artifact.contentHash)) throw denied();
      return { ...order, orderAnswerOrigin: order.origin };
    }
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
    return { run, input, artifact, step, orderAnswerOrigin: undefined as WorkbenchModelControlOrderAnswerOrigin | undefined };
  }
  async register(command: WorkbenchModelControlCommand, source: WorkbenchModelControlPreparedSource) {
    const initial = await this.current(command.taskId), key = this.operationId(initial, command);
    if (source.scopeId !== initial.task.scopeId || source.identityHash !== initial.identityHash) throw denied();
    try {
      return await this.db.$transaction(async tx => {
        const existing = await this.receipt(tx, initial, { taskId: command.taskId, operationId: command.operationId });
        if (existing) { if (existing.commandHash !== requestFingerprint(command)) throw changed(); return { receipt: existing, created: false }; }
        const current = await this.current(command.taskId), task = current.task;
        this.assertRegistrationCurrent?.(task.sceneCode);
        if (current.identityHash !== initial.identityHash || current.access.bindingKey !== initial.access.bindingKey
          || task.revision !== command.expectedTaskRevision || task.status !== 'SUCCEEDED' || task.cancelRequestedAt !== null
          || task.inputRef === null || task.inputHash === null || task.inputRevision === null
          || command.expectedPresentationRevision !== source.presentationRevision) throw changed();
        const parent = await this.parent(tx, task, command, undefined, current.access);
        const successors = await tx.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id, sequence: { gt: parent.run.sequence } }, take: 1 });
        if (successors.length || parent.input.id !== source.sourceInputId || parent.input.fingerprint !== source.sourceInputHash
          || parent.artifact.contentHash !== source.sourceResultHash || parent.step.id !== source.sourceStepId) throw changed();
        const rootRun = await tx.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: source.resourceOriginRunId } });
        const rootSaved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
          scopeId: task.scopeId, taskId: task.id, runId: source.resourceOriginRunId } } });
        const rootPlan = rootSaved ? aiTaskRunPlanSchema.safeParse(rootSaved.payload) : null;
        if (!rootRun || rootRun.id !== source.resourceOriginRunId || rootRun.scopeId !== task.scopeId || rootRun.taskId !== task.id
          || rootRun.sequence !== 1 || rootRun.actorKind !== 'USER' || rootRun.actorId !== task.ownerId
          || rootRun.inputReceiptId !== null || rootRun.resourceOriginRunId !== null || !rootPlan?.success
          || rootPlan.data.taskId !== task.id || rootPlan.data.runId !== rootRun.id
          || rootSaved!.planHash !== requestFingerprint(rootPlan.data)) throw denied();
        let orderAnswerOrigin: WorkbenchModelControlOrderAnswerOrigin | undefined;
        let resourceRegistrationRef: string;
        if (rootPlan.data.steps.length === 3) {
          const order = await this.orderAnswerRoot(tx, task, current.access, rootRun.id);
          const ancestry = parent.orderAnswerOrigin ?? (await this.readOrigin(tx as unknown as WorkbenchModelControlOriginTransaction,
            current.access, { scopeId: task.scopeId, taskId: task.id, runId: parent.run.id, originRunId: rootRun.id,
              registrationRef: parent.input.registrationRef })).orderAnswerOrigin;
          if (!source.orderAnswerOrigin || !same(source.orderAnswerOrigin, order.origin) || !same(ancestry, order.origin)) throw denied();
          orderAnswerOrigin = order.origin;
          resourceRegistrationRef = order.input.registrationRef;
        } else {
          if (source.orderAnswerOrigin || rootPlan.data.steps.length !== 1
            || rootPlan.data.steps[0].toolCode !== TASK_TEXT_MODEL_TOOL || rootPlan.data.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
            || rootPlan.data.steps[0].operation !== 'external_unknown') throw denied();
          resourceRegistrationRef = rootPlan.data.steps[0].registrationRef;
        }
        const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: task.scopeId, taskId: task.id } } });
        if (!budget || [budget.reservedSteps, budget.reservedCalls, budget.reservedActiveMs, budget.reservedOutputBytes].some(value => value !== 0n)
          || budget.maxSteps <= budget.consumedSteps || budget.maxCalls <= budget.consumedCalls
          || budget.maxActiveMs <= budget.consumedActiveMs || budget.maxOutputBytes <= budget.consumedOutputBytes) throw unavailable();
        const resourcePolicy = { version: 'saved-plan-resource-1', taskId: task.id, runId: rootRun.id,
          steps: rootPlan.data.steps, limits: rootPlan.data.limits };
        if (budget.policyVersion !== resourcePolicy.version || budget.policyFingerprint !== requestFingerprint(resourcePolicy)
          || budget.maxSteps !== BigInt(rootPlan.data.limits.maxSteps) || budget.maxCalls !== BigInt(rootPlan.data.limits.maxCalls)
          || budget.maxActiveMs !== BigInt(rootPlan.data.limits.maxTotalMs)
          || budget.maxOutputBytes !== BigInt(rootPlan.data.limits.maxOutputBytes)) throw denied();
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
          resourceRegistrationRef, ...(orderAnswerOrigin ? { orderAnswerOrigin } : {}),
          budgetPolicyVersion: budget.policyVersion, budgetPolicyHash: budget.policyFingerprint, createdAt: now.toISOString() });
        this.assertRegistrationCurrent?.(task.sceneCode);
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
        // Registration waits on persisted parents and CAS writes. Recheck in
        // this same transaction so late withdrawal rolls back the new Run.
        this.assertRegistrationCurrent?.(task.sceneCode);
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
      if (plan.taskId !== key.taskId || plan.runId !== root.id || requestFingerprint(plan) !== stored.planHash) throw denied();
      if (plan.steps.length === 3) {
        const order = await this.orderAnswerRoot(tx, before.task, before.access, root.id);
        if (!receipt.orderAnswerOrigin || !same(receipt.orderAnswerOrigin, order.origin)
          || !same(first.orderAnswerOrigin, order.origin) || receipt.resourceRegistrationRef !== order.input.registrationRef) throw denied();
      } else if (receipt.orderAnswerOrigin || plan.steps.length !== 1
        || plan.steps[0].toolCode !== TASK_TEXT_MODEL_TOOL || plan.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
        || plan.steps[0].operation !== 'external_unknown' || plan.steps[0].registrationRef !== receipt.resourceRegistrationRef) throw denied();
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
    if (!row) {
      // Ordinary readers still ask for the original scene-model registration.
      // Only the explicit final-answer adapter may enter the three-step proof.
      if (!this.orderAnswer || !key.registrationRef.startsWith('scene-answer:'))
        return readTaskModelRunOrigin(transaction, access, key);
      const task = await tx.aiTask.findFirst({ where: access.where });
      if (!task || task.id !== key.taskId || task.scopeId !== key.scopeId || key.originRunId !== key.runId
        || key.registrationRef !== `scene-answer:${task.inputRef}`) throw denied();
      const order = await this.orderAnswerRoot(tx, task, access, key.runId);
      return { ...order.proof, orderAnswerOrigin: order.origin };
    }
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
    const parent = await this.parent(tx, task, receipt.command, receipt, access);
    if (parent.run.sequence + 1 !== run.sequence) throw denied();
    const ownSaved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
      scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } } });
    if (ownSaved) {
      const ownPlan = aiTaskRunPlanSchema.safeParse(ownSaved.payload);
      if (!ownPlan.success || ownPlan.data.steps.length !== 1 || ownSaved.planHash !== requestFingerprint(ownPlan.data)
        || ownSaved.scopeId !== key.scopeId || ownSaved.taskId !== key.taskId || ownSaved.runId !== key.runId
        || ownPlan.data.taskId !== key.taskId || ownPlan.data.runId !== key.runId
        || ownPlan.data.steps[0].toolCode !== TASK_TEXT_MODEL_TOOL || ownPlan.data.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION
        || ownPlan.data.steps[0].operation !== 'external_unknown' || ownPlan.data.steps[0].registrationRef !== receipt.registrationRef) throw denied();
    }
    const budget = await tx.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId: key.scopeId, taskId: key.taskId } } });
    if (!budget || budget.policyVersion !== receipt.budgetPolicyVersion || budget.policyFingerprint !== receipt.budgetPolicyHash) throw denied();
    const parentOrigin = await this.readOrigin(transaction, access, { ...key, runId: parent.run.id,
      originRunId: receipt.resourceOriginRunId, registrationRef: parent.input.registrationRef }, visited);
    if (!same(receipt.orderAnswerOrigin ?? null, parentOrigin.orderAnswerOrigin ?? null)) throw denied();
    // Generic original-result readers retain their scene-model lookup. Only a
    // control with the verified fixed order root may resolve that lookup to its
    // final answer; the saved control registration still binds the returned Run.
    const originalOrderRegistration = receipt.orderAnswerOrigin ? `scene-model:${receipt.inputRef}` : undefined;
    if (![receipt.registrationRef, parentOrigin.registrationRef, receipt.resourceRegistrationRef, originalOrderRegistration]
      .includes(key.registrationRef)) throw denied();
    return { registrationRef: receipt.registrationRef, continuation: undefined, history: parentOrigin.history,
      ...(parentOrigin.orderAnswerOrigin ? { orderAnswerOrigin: parentOrigin.orderAnswerOrigin } : {}),
      control: { operationLogId: receipt.operationLogId, presentationRevision: receipt.presentationRevision,
        sourceRunId: receipt.command.sourceRunId, sourceResultId: receipt.command.sourceResultId,
        resourceOriginRunId: receipt.resourceOriginRunId } };
  }
}
