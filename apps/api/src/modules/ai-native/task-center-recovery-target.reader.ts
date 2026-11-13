/** Current-owner Task/Run locator for the existing original recovery hosts.
 * Saved plans, registered inputs and consumed answer lineage identify the host.
 * This reader acquires no lease and returns no recovery or dispatch grant. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, AI_TASK_DRAFT_VERSION,
  AI_TOOL_DRAFT_VERSION, type AiSceneRequestReadDraft, type AiSceneModelRecoverySnapshotReadResponse,
  type AiTaskRecoverySnapshot } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { aiStepActionId } from './ai-step-registration.repository';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import { parseTaskModelInput, taskModelFingerprint, taskModelIntent, taskModelMaterialSchema,
  TASK_TEXT_MODEL_TOOL } from './model-input/task-model-input';
import { withoutTaskModelDisplayMessages } from './model-input/task-model-display-witness';
import { aiTaskRunPlanSchema } from './runner/prisma-task-run-evidence.repository';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { continueOriginalSceneMaterial, readOriginalSceneEnvelope } from './scenes/original-scene-knowledge';
import { validateAiModelRecoveryResponse } from './scenes/original-scenes.controller';
import { isGatewayResult } from './gateway-contract-validation';
import { readTaskModelRunOrigin } from './task-input/prisma-task-input.repository';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { WORKBENCH_MODEL_CONTROL_ACTION } from './workbench-model-control.contract';

type Request = { headers: { authorization?: unknown } };
type Db = Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskOriginalRequest'
  | 'aiTaskRunPlan' | 'aiTaskActionInput' | 'aiTaskInputRequest' | 'aiTaskInputReceipt' | 'aiTaskEvent'
  | 'aiTaskResultArtifact' | 'aiTaskQuoteSelection' | 'operationLog'>;
export interface TaskCenterRecoveryTargetDependencies {
  db: Db;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  original: { readRecoverySnapshot(request: Request, value: unknown): Promise<unknown> };
  clock?: () => Date;
}
export type TaskCenterRecoveryHost = 'order_read' | 'opening_model' | 'quote_model' | 'opening_read';
type UnavailableReason = 'original_request_unavailable' | 'plan_unavailable' | 'host_unavailable'
  | 'specialized_host_required' | 'host_run_mismatch';
type Base = { taskId: string; runId: string; observedAt: string; execution: 'read_only_no_lease_or_dispatch' };
export type TaskCenterRecoveryTarget = Base & (
  | { status: 'available'; host: TaskCenterRecoveryHost; original: AiSceneRequestReadDraft; originRunId: string;
      planHash: string; snapshot: AiTaskRecoverySnapshot }
  | { status: 'unavailable'; reason: UnavailableReason }
);
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const querySchema = z.object({ taskId: id, runId: id }).strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const recoveryFenceSchema = querySchema.extend({ planHash: hash,
  expectedTaskRevision: z.number().int().min(1).max(4294967294),
  expectedRunRevision: z.number().int().min(1).max(4294967294),
  expectedFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict();
/** Internal server parameter. Public recovery bodies retain their old shape. */
export type TaskCenterRecoveryFence = z.infer<typeof recoveryFenceSchema>;
export function snapshotTaskCenterRecoveryFence(value: unknown): Readonly<TaskCenterRecoveryFence> {
  const parsed = recoveryFenceSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return Object.freeze(parsed.data);
}
export function assertTaskCenterRecoveryFence(fence: Readonly<TaskCenterRecoveryFence>, snapshot: AiTaskRecoverySnapshot) {
  if (!snapshot.plan || snapshot.task.taskId !== fence.taskId || snapshot.run.runId !== fence.runId
    || snapshot.plan.planHash !== fence.planHash || snapshot.task.revision !== fence.expectedTaskRevision
    || snapshot.run.revision !== fence.expectedRunRevision || snapshot.run.fencingToken !== fence.expectedFencingToken) throw conflict();
}
const runSelect = { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true, sequence: true,
  status: true, revision: true, inputReceiptId: true, resourceOriginRunId: true, fencingToken: true,
  leaseOwnerId: true, leaseExpiresAt: true } satisfies Prisma.AiRunSelect;
const stepSelect = { id: true, scopeId: true, taskId: true, runId: true, sequence: true, revision: true,
  actionId: true, toolCode: true, toolVersion: true, status: true, effect: true, inputRef: true,
  requestFingerprint: true, resultRef: true, errorCode: true } satisfies Prisma.AiStepSelect;
type Run = Prisma.AiRunGetPayload<{ select: typeof runSelect }>;
type Plan = z.infer<typeof aiTaskRunPlanSchema>;
function runEvidence(run: Run) {
  const fencingToken = run.fencingToken.toFixed(0);
  if (!/^(0|[1-9][0-9]{0,19})$/u.test(fencingToken) || !run.fencingToken.equals(fencingToken)) throw unavailable();
  return { ...run, fencingToken, leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null };
}
function readPlan(row: Prisma.AiTaskRunPlanGetPayload<{}> | null, key: { scopeId: string; taskId: string; runId: string }) {
  if (!row) return null;
  const parsed = aiTaskRunPlanSchema.safeParse(row.payload);
  if (!parsed.success || row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId
    || parsed.data.taskId !== key.taskId || parsed.data.runId !== key.runId || requestFingerprint(parsed.data) !== row.planHash
    || !hash.safeParse(row.authorityHash).success || !row.policyVersion) throw unavailable();
  return parsed.data;
}
function stepDefinition(registrationRef: string, toolCode: string, operation: Plan['steps'][number]['operation']) {
  return { registrationRef, toolCode, toolVersion: AI_TOOL_DRAFT_VERSION, operation };
}
function hostFor(scene: string, inputRef: string, plan: Plan, registrationRef: string, origin: boolean): TaskCenterRecoveryHost | null {
  const expectedModel = [stepDefinition(registrationRef, TASK_TEXT_MODEL_TOOL, 'external_unknown')];
  if (scene === 'opening_diagnosis' && requestFingerprint(plan.steps) === requestFingerprint(expectedModel)) return 'opening_model';
  if (scene === 'quote_clarification' && requestFingerprint(plan.steps) === requestFingerprint(expectedModel)) return 'quote_model';
  if (!origin) return null;
  if (scene === 'opening_diagnosis' && requestFingerprint(plan.steps) === requestFingerprint([
    stepDefinition(`opening-read:${inputRef}`, 'tenant.opening.diagnose', 'readonly')])) return 'opening_read';
  const orderSteps = [stepDefinition(`scene-model:${inputRef}`, TASK_TEXT_MODEL_TOOL, 'external_unknown'),
    stepDefinition(`scene-order:${inputRef}`, 'rental.order.explain', 'readonly')];
  // The original order host supports its two-step history and the explicitly
  // configured third answer step. Neither becomes a single-model fallback.
  if (scene === 'order_explanation' && (requestFingerprint(plan.steps) === requestFingerprint(orderSteps)
    || requestFingerprint(plan.steps) === requestFingerprint([...orderSteps,
      stepDefinition(`scene-answer:${inputRef}`, TASK_TEXT_MODEL_TOOL, 'external_unknown')]))) return 'order_read';
  return null;
}

export async function readTaskCenterRecoveryTarget(d: TaskCenterRecoveryTargetDependencies, request: Request,
  value: unknown, signal?: AbortSignal): Promise<TaskCenterRecoveryTarget> {
  const parsed = querySchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  if (typeof d?.db?.$transaction !== 'function' || typeof d.tasks?.resolveAccess !== 'function'
    || typeof d.original?.readRecoverySnapshot !== 'function') throw unavailable();
  const query = parsed.data, clock = d.clock ?? (() => new Date());
  const live = () => { if (signal?.aborted) throw unavailable(); };
  const read = <T>(operation: () => Promise<T>) => { live(); return waitForTaskApplicationDependency(operation, false, signal); };
  const inspect = async () => {
    const access = await d.tasks.resolveAccess(query.taskId, 'read_step_terminal');
    if (access.actorKind !== 'USER' || access.audience !== 'OPERATOR' || access.scope.kind !== 'WORKSPACE') throw denied();
    const evidence = await d.db.$transaction(async tx => {
      live();
      const task = await tx.aiTask.findFirst({ where: access.where });
      if (!task) throw unavailable();
      if (task.id !== query.taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
        || task.audience !== access.audience || task.scopeKind !== access.scope.kind || task.archivedAt !== null) throw denied();
      if (task.contractVersion !== AI_TASK_DRAFT_VERSION) throw unavailable();
      const scope = await tx.aiScope.findFirst({ where: { id: task.scopeId, ...access.scope } });
      if (!scope || Object.entries(access.scope).some(([key, value]) => scope[key as keyof typeof scope] !== value)) throw denied();
      const key = { scopeId: task.scopeId, taskId: task.id, runId: query.runId };
      const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId,
        actorKind: access.actorKind, actorId: access.actorId }, select: runSelect });
      if (!run) throw unavailable();
      if (run.id !== key.runId || run.taskId !== key.taskId || run.scopeId !== key.scopeId
        || run.actorKind !== access.actorKind || run.actorId !== access.actorId) throw denied();
      const taskState = { taskId: task.id, revision: task.revision, status: task.status.toLowerCase(),
        cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null, eventCursor: task.eventCursor.toString() };
      const unavailableEvidence = (reason: UnavailableReason, basis: unknown = null) => ({ reason, host: null, original: null,
        originRunId: null, planHash: null, policyVersion: null, steps: [], taskState, runState: runEvidence(run),
        stamp: requestFingerprint({ taskState, run: runEvidence(run), inputRef: task.inputRef, basis }) });
      if (!task.inputRef || task.creationKey !== `scene-request:${task.inputRef}`) return unavailableEvidence('original_request_unavailable');
      const originalRow = await tx.aiTaskOriginalRequest.findFirst({ where: { id: task.inputRef, scopeId: task.scopeId,
        audience: task.audience, ownerKind: task.ownerKind, ownerId: task.ownerId } });
      if (!originalRow || originalRow.status !== 'STORED' || originalRow.erasedAt) return unavailableEvidence('original_request_unavailable');
      const original = await readOriginalTaskModelProvenance(tx, task);
      const control = await tx.operationLog.findFirst({ where: { id: run.id, userId: access.actorId, action: WORKBENCH_MODEL_CONTROL_ACTION }, select: { id: true } });
      const selection = await tx.aiTaskQuoteSelection.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId }, select: { id: true } });
      if (control || selection) return unavailableEvidence('specialized_host_required', { original, control, selection });
      const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
      const plan = readPlan(saved, key);
      if (!plan) return unavailableEvidence('plan_unavailable', original);
      const roots = await tx.aiRun.findMany({ where: { scopeId: key.scopeId, taskId: key.taskId, sequence: 1,
        actorKind: access.actorKind, actorId: access.actorId }, take: 2, select: runSelect });
      const root = roots[0];
      if (roots.length !== 1 || !root || root.sequence !== 1 || root.scopeId !== key.scopeId || root.taskId !== key.taskId
        || root.actorKind !== access.actorKind || root.actorId !== access.actorId || root.inputReceiptId != null || root.resourceOriginRunId != null) throw unavailable();
      const originKey = { ...key, runId: root.id }, originSaved = run.id === root.id ? saved
        : await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: originKey } });
      const originPlan = readPlan(originSaved, originKey);
      if (!originPlan) return unavailableEvidence('plan_unavailable', original);
      const registrationRef = `scene-model:${task.inputRef}`;
      const originHost = hostFor(task.sceneCode, task.inputRef, originPlan, registrationRef, true);
      if (!originHost) return unavailableEvidence('host_unavailable', { original, planHash: saved!.planHash, originPlanHash: originSaved!.planHash });
      // Match the Run the existing host would select. An arbitrary historical
      // Run cannot stand in for the active successor accepted by that host.
      const active = await tx.aiRun.findMany({ where: { scopeId: key.scopeId, taskId: key.taskId,
        actorKind: access.actorKind, actorId: access.actorId, status: { in: ['QUEUED', 'RUNNING'] } }, take: 2, select: runSelect });
      if (active.length > 1 || (active[0]?.id ?? root.id) !== query.runId)
        return unavailableEvidence('host_run_mismatch', { original, active: active.map(runEvidence) });
      const lineage = run.id === root.id ? await readTaskModelRunOrigin(tx, access, { ...key, originRunId: root.id, registrationRef })
        : await readTaskModelRunOrigin(tx, access, { ...key, originRunId: root.id, registrationRef, includeHistory: true });
      const host = hostFor(task.sceneCode, task.inputRef, plan, lineage.registrationRef, run.id === root.id);
      if (host !== originHost || plan.taskRevision > task.revision || originPlan.taskRevision > task.revision)
        return unavailableEvidence('host_unavailable', { original, planHash: saved!.planHash, lineage });
      const inputs = await tx.aiTaskActionInput.findMany({ where: key, take: plan.steps.length + 1 });
      const steps = await tx.aiStep.findMany({ where: key, select: stepSelect, orderBy: { sequence: 'asc' }, take: plan.steps.length + 1 });
      if (inputs.length !== plan.steps.length || new Set(inputs.map(input => input.registrationRef)).size !== inputs.length
        || new Set(inputs.map(input => input.id)).size !== inputs.length || steps.length > plan.steps.length) throw unavailable();
      for (const planned of plan.steps) {
        const input = inputs.find(input => input.registrationRef === planned.registrationRef);
        if (!input || input.scopeId !== key.scopeId || input.taskId !== key.taskId || input.runId !== key.runId
          || input.toolCode !== planned.toolCode || input.toolVersion !== planned.toolVersion || !hash.safeParse(input.fingerprint).success) throw unavailable();
        if (planned.toolCode === TASK_TEXT_MODEL_TOOL) {
          const raw = z.object({ intent: z.object({ messages: z.array(z.object({ content: z.array(z.object({ kind: z.string() }).passthrough()) }).passthrough()) }).passthrough() })
            .passthrough().parse(input.payload);
          const native = raw.intent.messages.some(message => message.content.some(part => part.kind === 'tool_result_reference'));
          // Old order answers used the same tools-enabled policy as the first
          // model. The original signed answer publisher uses its own text-only
          // policy, while the surrounding three-step order plan remains fixed.
          const signedOrderAnswer = host === 'order_read' && planned.registrationRef === `scene-answer:${task.inputRef}`
            && raw.displayWitness !== undefined;
          const orderToolPolicy = host === 'order_read' && !signedOrderAnswer;
          const policy = { sceneCode: task.sceneCode, maxOutputTokens: 32768,
            ...(orderToolPolicy ? { orderExplainTool: true, ...(native ? { nativeToolResults: true } : {}) } : {}) };
          const model = parseTaskModelInput(input.payload, policy);
          if (model.identityHash !== original.authorizationHash || taskModelFingerprint(model, policy) !== input.fingerprint
            || model.intent.requestId !== taskModelIntent(task.id, run.id, planned.registrationRef, task.sceneCode,
              taskModelMaterialSchema.parse({ messages: model.intent.messages, maxOutputTokens: model.intent.maxOutputTokens }),
              undefined, orderToolPolicy).requestId) throw unavailable();
          if (planned.registrationRef === lineage.registrationRef) {
            const envelope = readOriginalSceneEnvelope(model), frozen = z.record(z.unknown()).parse(envelope.original);
            const { state: _state, ...receipt } = frozen;
            const expected = { draftVersion: originalRow.contractVersion, inputRef: originalRow.id, revision: originalRow.revision,
              contentHash: originalRow.contentHash, sceneCode: originalRow.sceneCode, sceneVersion: originalRow.sceneVersion,
              requestKey: originalRow.requestKey, previousInputRef: originalRow.previousRequestId,
              expiresAt: originalRow.expiresAt.toISOString(), createdAt: originalRow.createdAt.toISOString() };
            if (requestFingerprint(receipt) !== requestFingerprint(expected) || requestFingerprint(envelope.facts) !== envelope.materialHash) throw unavailable();
            if (lineage.continuation) {
              const prior = parseTaskModelInput(lineage.continuation.input, policy), result = lineage.continuation.result;
              if (taskModelFingerprint(prior, policy) !== lineage.continuation.inputHash || !isGatewayResult(result)
                || result.status !== 'completed' || result.usage.kind !== 'reported'
                || requestFingerprint(withoutTaskModelDisplayMessages(model.intent.messages)) !== requestFingerprint(continueOriginalSceneMaterial(prior,
                  { ...lineage.continuation, result }, lineage.continuation.questionRevision > 1 ? envelope : undefined).messages)) throw unavailable();
            } else if (envelope.clarifications) throw unavailable();
          }
        } else if (planned.toolCode === 'rental.order.explain') {
          const body = z.object({ orderId: z.string() }).passthrough().parse(originalRow.payload);
          const expected = { contractVersion: AI_CONTRACT_DRAFT_VERSION, toolCode: planned.toolCode,
            toolVersion: planned.toolVersion, input: { orderId: body.orderId } };
          if (requestFingerprint(input.payload) !== requestFingerprint(expected) || input.fingerprint !== requestFingerprint(expected)) throw unavailable();
        } else if (planned.toolCode === 'tenant.opening.diagnose') {
          const body = z.object({ sections: z.array(z.string()) }).strict().parse(originalRow.payload);
          const expected = { limit: 50, sections: body.sections };
          if (requestFingerprint(input.payload) !== requestFingerprint(expected) || input.fingerprint !== requestFingerprint(expected)) throw unavailable();
        }
      }
      for (const [index, step] of steps.entries()) {
        const planned = plan.steps[index], input = inputs.find(input => input.registrationRef === planned.registrationRef);
        if (!input || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId || step.sequence !== index + 1
          || step.toolCode !== planned.toolCode || step.toolVersion !== planned.toolVersion
          || step.actionId !== aiStepActionId(access.scope, task.id, planned.registrationRef)
          || step.inputRef !== input.id || step.requestFingerprint !== input.fingerprint) throw unavailable();
      }
      return { reason: null, host, original, originRunId: root.id, planHash: saved!.planHash, taskState, runState: runEvidence(run),
        policyVersion: saved!.policyVersion, steps,
        stamp: requestFingerprint({ taskState, taskBinding: { scopeId: task.scopeId, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion,
          inputRef: task.inputRef, inputHash: task.inputHash, inputRevision: task.inputRevision }, original, scope: access.scope,
          run: runEvidence(run), root: runEvidence(root), active: active.map(runEvidence),
          plan, authorityHash: saved!.authorityHash, policyVersion: saved!.policyVersion,
          originPlan, originAuthorityHash: originSaved!.authorityHash, inputs: inputs.map(input => ({ id: input.id,
            registrationRef: input.registrationRef, fingerprint: input.fingerprint, payloadHash: requestFingerprint(input.payload),
            policyRevision: input.policyRevision, expiresAt: input.expiresAt.toISOString() })), steps, lineage }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 }).catch(error => {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    });
    const current = await d.tasks.resolveAccess(query.taskId, 'read_step_terminal');
    if (current.bindingKey !== access.bindingKey) throw denied();
    live();
    return { ...evidence, bindingKey: access.bindingKey };
  };
  const before = await read(inspect);
  const original = before.original ? { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: before.original.inputRef } : null;
  let observed: AiSceneModelRecoverySnapshotReadResponse | null = null;
  if (before.host && original) {
    observed = validateAiModelRecoveryResponse('AiSceneModelRecoverySnapshotReadResponse',
      await read(() => d.original.readRecoverySnapshot(request, { original, runId: query.runId }))) as AiSceneModelRecoverySnapshotReadResponse;
    const snapshot = observed.snapshot;
    if (requestFingerprint(observed.original) !== requestFingerprint(original)
      || requestFingerprint(snapshot.task) !== requestFingerprint(before.taskState)
      || snapshot.run.runId !== query.runId || snapshot.run.revision !== before.runState.revision
      || snapshot.run.status !== before.runState.status.toLowerCase() || snapshot.run.fencingToken !== before.runState.fencingToken
      || snapshot.plan?.planHash !== before.planHash || snapshot.plan.policyVersion !== before.policyVersion
      || snapshot.steps.length !== before.steps?.length || snapshot.steps.some((step, index) => {
        const saved = before.steps![index];
        return step.stepId !== saved.id || step.sequence !== saved.sequence || step.revision !== saved.revision
          || step.actionId !== saved.actionId || step.inputRef !== saved.inputRef || step.fingerprint !== saved.requestFingerprint
          || step.toolCode !== saved.toolCode || step.toolVersion !== saved.toolVersion || step.status !== saved.status.toLowerCase()
          || step.effect !== saved.effect.toLowerCase() || step.resultRef !== saved.resultRef || step.errorCode !== saved.errorCode;
      })) throw conflict();
  }
  const after = await read(inspect);
  if (after.bindingKey !== before.bindingKey) throw denied();
  if (after.stamp !== before.stamp) throw conflict();
  live();
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
  const base: Base = { ...query, observedAt: now.toISOString(), execution: 'read_only_no_lease_or_dispatch' };
  if (!before.host || !original || !observed || !before.originRunId || !before.planHash)
    return { ...base, status: 'unavailable', reason: before.reason ?? 'host_unavailable' };
  return { ...base, status: 'available', host: before.host, original, originRunId: before.originRunId,
    planHash: before.planHash, snapshot: observed.snapshot };
}
