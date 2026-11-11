/** Current read permission and original receipt lineage only. Construction
 * does not require an execution-enabled model, Gateway, price or plan policy.
 * Model bodies are consumed only inside the original result reader and never
 * returned by this locator endpoint. */
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_TEXT_MODEL_STEP_CODE,
  type AiInspectionTaskResultReferenceObservation } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepository, AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskResultRepository } from '../runner/ai-task-result.repository';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL } from '../model-input/task-model-input';
import type { composeStaffInspectionTaskReceiptReader } from '../staff-inspection-task-receipt.composition';
import { InspectionActionAuthority } from './inspection-action.authority';
import { inspectionTargetSchema, inspectionId } from './inspection-assist.validation';

type Db = Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskResultArtifact'
  | 'aiTaskRunPlan' | 'aiTaskInputRequest' | 'aiTaskInputReceipt' | 'aiTaskActionInput' | 'aiTaskEvent'>;
type Request = { headers: { authorization?: unknown } };
export interface InspectionTaskResultReferenceDependencies {
  db: Db; auth: Pick<AuthService, 'resolveAccessContext'>; guard: Pick<ApiAuthGuard, 'canActivate'>;
  readCreation: ReturnType<typeof composeStaffInspectionTaskReceiptReader>['readCreation'];
  scenes: readonly { kind: 'image' | 'audio'; code: string; version: string }[]; clock?: () => Date;
}
const referenceSchema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
  inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export function createInspectionTaskResultReferenceReader(dependencies: InspectionTaskResultReferenceDependencies) {
  if (typeof dependencies.db?.$transaction !== 'function' || typeof dependencies.readCreation !== 'function'
    || typeof dependencies.auth?.resolveAccessContext !== 'function' || typeof dependencies.guard?.canActivate !== 'function') throw unavailable();
  const selected = z.array(z.object({ kind: z.enum(['image','audio']), code: inspectionId, version: inspectionId }).strict())
    .min(1).max(2).parse(structuredClone(dependencies.scenes));
  const server = { ...dependencies, scenes: selected };
  return Object.freeze({
    /** Current owner/order read -> exact original Run lineage -> proven saved
     * result locator. No execution plan, admission, recovery lease or model call
     * is acquired here; the original result reader authorizes candidate access. */
    async readResultReference(request: Request, value: unknown, signal?: AbortSignal): Promise<AiInspectionTaskResultReferenceObservation> {
      const parsed = referenceSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const reference = parsed.data, model = server;
      const header = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).safeParse(request?.headers?.authorization);
      if (!header.success) throw denied();
      const original = await server.readCreation(request, reference, signal);
      const empty = (task: AiInspectionTaskResultReferenceObservation['task']): AiInspectionTaskResultReferenceObservation => ({
        contractVersion: AI_TASK_DRAFT_VERSION, task, state: 'not_observed', reference: null,
        execution: 'read_only_no_lease_or_dispatch', retryable: false, nextAction: 'read_original_task' });
      if (original.state !== 'observed') return empty(null);
      const taskId = original.task.taskId, originRunId = original.task.runId, clock = model.clock ?? (() => new Date());
      const registrationRef = `inspection-model:${requestFingerprint({ inputId: reference.inputId })}`;
      let active = true;
      const requestId = randomUUID(), credentials: AiTaskCredentialSource = { current: async () => {
        if (!active || signal?.aborted) throw denied();
        return { authorization: header.data, requestId, audience: 'staff' };
      } };
      const close = () => { active = false; };
      signal?.addEventListener('abort', close, { once: true });
      try {
        return await runWithRequestIdentity({}, async () => {
          const scopes = new AiScopeRepository(model.db, new AiTaskCurrentIdentityAuthority(model.auth, credentials, clock), clock);
          const resource = new InspectionActionAuthority(model.guard, credentials);
          const tasks = new AiTaskRepository(model.db, { resolve: async (requested, operation) => {
            if (requested !== taskId || !['read_metadata', 'read_events', 'read_step_terminal'].includes(operation)) throw denied();
            const before = await scopes.resolveCurrent(), context = before.context;
            if (!active || signal?.aborted || context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || context.audience !== 'staff') throw denied();
            const receipt = await server.readCreation(request, reference, signal);
            if (receipt.state !== 'observed' || receipt.task.taskId !== taskId || receipt.task.runId !== originRunId) throw denied();
            await resource.withAction({ orderId: reference.orderId, allocationId: reference.allocationId,
              templateId: reference.templateId, stage: reference.stage }, 'read', async owner => {
              if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
                || owner.tenantId !== context.scope.tenantId || owner.workspaceId !== context.scope.workspaceId
                || owner.ownerId !== context.actor.userId || owner.audience !== context.audience) throw denied();
            });
            const after = await scopes.resolveCurrent();
            if (!active || signal?.aborted || after.scope.id !== before.scope.id
              || originalIdentityHash(after.context) !== originalIdentityHash(context)) throw denied();
            return after.context;
          } }, clock);
          const results = new AiTaskResultRepository(model.db, tasks, clock);
          const lineage = async () => {
            const access = await tasks.resolveAccess(taskId, 'read_step_terminal');
            const selected = await model.db.$transaction(async tx => {
              const task = await tx.aiTask.findFirst({ where: access.where, select: { id: true, scopeId: true,
                sceneCode: true, sceneVersion: true, inputRef: true, inputRevision: true } });
              if (!task || task.id !== taskId || task.inputRef !== reference.inputId || task.inputRevision !== reference.expectedRevision) throw denied();
              const scene = server.scenes.find(row => row.code === task.sceneCode && row.version === task.sceneVersion);
              if (!scene) throw denied();
              const tool = scene.kind === 'audio' ? TASK_AUDIO_MODEL_TOOL : TASK_IMAGE_MODEL_TOOL;
              const runs = await tx.aiRun.findMany({ where: { scopeId: task.scopeId, taskId },
                select: { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true,
                  sequence: true, inputReceiptId: true, resourceOriginRunId: true }, orderBy: { sequence: 'asc' }, take: 1001 });
              if (!runs.length || runs.length > 1000 || new Set(runs.map(run => run.id)).size !== runs.length
                || runs.some(run => run.scopeId !== task.scopeId || run.taskId !== taskId
                  || run.actorKind !== access.actorKind || run.actorId !== access.actorId)) throw denied();
              const origin = runs.find(run => run.id === originRunId);
              if (!origin || origin.sequence !== 1 || origin.inputReceiptId !== null || origin.resourceOriginRunId !== null) throw denied();
              const receiptIds = runs.filter(run => run.id !== originRunId).map(run => {
                if (!run.inputReceiptId || run.resourceOriginRunId !== originRunId || run.sequence < 2) throw denied();
                return run.inputReceiptId;
              });
              const receipts = receiptIds.length ? await tx.aiTaskInputReceipt.findMany({
                where: { scopeId: task.scopeId, taskId, id: { in: receiptIds } },
                select: { id: true, requestId: true, scopeId: true, taskId: true, actorKind: true, actorId: true, audience: true },
                orderBy: { id: 'asc' } }) : [];
              if (receipts.length !== receiptIds.length || receipts.some(receipt => receipt.scopeId !== task.scopeId
                || receipt.taskId !== taskId || receipt.actorKind !== access.actorKind || receipt.actorId !== access.actorId
                || receipt.audience !== access.audience)) throw denied();
              const requests = receipts.length ? await tx.aiTaskInputRequest.findMany({
                where: { scopeId: task.scopeId, taskId, id: { in: receipts.map(receipt => receipt.requestId) } },
                select: { id: true, runId: true, scopeId: true, taskId: true }, orderBy: { id: 'asc' } }) : [];
              if (requests.length !== receipts.length || requests.some(row => row.scopeId !== task.scopeId || row.taskId !== taskId)) throw denied();
              // Follow receipt -> original question -> parent Run. Sequence and
              // resource origin corroborate this link; neither selects a latest ID.
              let current = origin;
              const visited = new Set([originRunId]);
              while (visited.size <= runs.length) {
                const children = runs.filter(run => run.inputReceiptId && receipts.some(receipt => receipt.id === run.inputReceiptId
                  && requests.some(question => question.id === receipt.requestId && question.runId === current.id)));
                if (children.length > 1) throw denied();
                if (!children.length) break;
                const next = children[0];
                if (visited.has(next.id) || next.sequence !== current.sequence + 1) throw denied();
                // The existing reader validates hashes, original model input,
                // immutable answer, refreshed question history and parent result.
                await readTaskModelRunOrigin(tx, access, { scopeId: task.scopeId, taskId, runId: next.id,
                  originRunId, registrationRef });
                visited.add(next.id); current = next;
              }
              if (visited.size !== runs.length) throw denied();
              await readTaskModelRunOrigin(tx, access, { scopeId: task.scopeId, taskId, runId: current.id,
                originRunId, registrationRef });
              return { runId: current.id, tool, binding: requestFingerprint({ task, runs, receipts, requests }) };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
            if ((await tasks.resolveAccess(taskId, 'read_step_terminal')).bindingKey !== access.bindingKey) throw denied();
            return selected;
          };
          const initial = await lineage();
          const observed = await results.readRunResults({ taskId, runId: initial.runId, limit: 50 });
          if (observed.hasMore) throw unavailable();
          const modelSteps = observed.items.filter(item => [TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, AI_TEXT_MODEL_STEP_CODE]
            .some(tool => tool === item.toolCode));
          if (modelSteps.length > 1 || modelSteps.some(item => item.toolCode !== initial.tool)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
          const result = modelSteps[0]?.observation === 'terminal_result' ? modelSteps[0].result : null;
          const after = await lineage();
          if (after.runId !== initial.runId || after.binding !== initial.binding) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          const receipt = await server.readCreation(request, reference, signal);
          if (!active || signal?.aborted || receipt.state !== 'observed' || receipt.task.taskId !== taskId
            || receipt.task.runId !== originRunId || receipt.task.revision !== observed.taskRevision) throw denied();
          const task = { ...receipt.task, status: z.enum(AI_TASK_STATUSES_DRAFT).parse(receipt.task.status) };
          if (!result || result.status === 'unknown' || !result.completeMeasurement) return empty(task);
          return { contractVersion: AI_TASK_DRAFT_VERSION, task, state: 'observed',
            reference: { ...reference, taskId, resultId: result.resultId },
            execution: 'read_only_no_lease_or_dispatch', retryable: false, nextAction: 'read_original_result' };
        });
      } catch (error) {
        if (error instanceof AiTaskRepositoryError) throw error;
        throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
      } finally { signal?.removeEventListener('abort', close); close(); }
    }
  });
}
