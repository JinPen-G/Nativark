/** Same-owner recovery gateway for the existing original hosts. A read target
 * derives the host from stored plan/lineage; writes retain the reviewed CAS all
 * the way to the original lease repository. No new plan, quota or retry loop. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TASK_CENTER_RECOVERY_HTTP,
  AI_TASK_CENTER_RECOVERY_CONTRACTS, validateAiTaskCenterRecoveryValue,
  type AiTaskRecoveryTargetQueryDraft, type AiTaskRecoveryRunQueryDraft, type AiTaskRecoveryCommandDraft,
  type AiTaskRecoveryReceiptQueryDraft, type AiTaskRecoveryTargetDraft, type AiTaskRecoveryResultDraft,
  type AiTaskRecoveryReceiptDraft, type AiTaskRecoverySnapshotDraft, type AiTaskRecoveryHostDraft } from '@rental-os/shared';
import { hasEffectivePermission } from '../../common/permission-match';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composePersistedTaskCenter } from './task-center.composition';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { originalIdentityHash } from './task-request/original-request.authority';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { readTaskCenterRecoveryTarget, snapshotTaskCenterRecoveryFence,
  assertTaskCenterRecoveryFence, type TaskCenterRecoveryFence } from './task-center-recovery-target.reader';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { respondAiScene, validateAiModelRecoveryResponse } from './scenes/original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './scenes/request-abort';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { validateAiOrderReadResponse } from './scenes/scene-observation-contracts';

export const AI_TASK_CENTER_RECOVERY_REQUESTS = Symbol('AI_TASK_CENTER_RECOVERY_REQUESTS');
type Request = { headers: { authorization?: unknown }; body?: unknown } & AiRequestAbortSource;
type Action = keyof typeof AI_TASK_CENTER_RECOVERY_CONTRACTS;
type Host = { recover(request: Request, original: unknown, signal?: AbortSignal, exact?: Readonly<TaskCenterRecoveryFence>): Promise<unknown>;
  takeover(request: Request, original: unknown, signal?: AbortSignal, exact?: Readonly<TaskCenterRecoveryFence>): Promise<unknown> };
export interface TaskCenterRecoveryDependencies {
  db: PrismaClient;
  auth: Parameters<typeof composePersistedTaskCenter>[0]['auth'];
  original: { readRecoverySnapshot(request: Request, value: unknown): Promise<unknown>;
    readTakeoverReceipt(request: Request, value: unknown): Promise<unknown> };
  host(kind: AiTaskRecoveryHostDraft): Host | undefined;
  clock?: () => Date;
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);

export function composeTaskCenterRecoveryRequests(d: TaskCenterRecoveryDependencies) {
  const consume = async (request: Request, action: Action, value: unknown, signal?: AbortSignal) => {
    if (!Object.hasOwn(AI_TASK_CENTER_RECOVERY_CONTRACTS, action)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const contract = AI_TASK_CENTER_RECOVERY_CONTRACTS[action], command = structuredClone(value);
    if (!validateAiTaskCenterRecoveryValue(contract.request, command)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const header = request.headers?.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)) throw denied();
    const clock = d.clock ?? (() => new Date()), requestId = randomUUID(); let active = !signal?.aborted;
    const close = () => { active = false; }; signal?.addEventListener('abort', close, { once: true });
    const live = () => { if (!active || signal?.aborted) throw denied(); };
    try {
      return await runWithRequestIdentity({}, async () => {
        const credentials = { current: async () => { live(); return { authorization: header, audience: 'operator' as const, requestId }; } };
        const identity = new AiTaskCurrentIdentityAuthority(d.auth, credentials, clock), before = await identity.resolve(); live();
        if (before.audience !== 'operator' || before.actor.kind !== 'user' || before.scope.kind !== 'workspace'
          || !('access' in before) || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(code => hasEffectivePermission(before.access.permissions, code))) throw denied();
        const root = composePersistedTaskCenter({ db: d.db, auth: d.auth, credentials, clock });
        const read = <T>(work: () => Promise<T>) => waitForTaskApplicationDependency(async () => { live(); const result = await work(); live(); return result; }, false, signal);
        const locator = async (query: AiTaskRecoveryTargetQueryDraft) => {
          const access = await root.tasks.resolveAccess(query.taskId, 'read_step_terminal'); live();
          const task = await d.db.aiTask.findFirst({ where: access.where }); live();
          if (!task || task.id !== query.taskId || task.ownerKind !== 'USER' || task.ownerId !== before.actor.userId
            || task.audience !== 'OPERATOR') throw denied();
          const provenance = await readOriginalTaskModelProvenance(d.db, task); live();
          let runId = query.runId;
          if (!runId) {
            // Server-only newest candidate, followed by the original strict
            // plan/host/lineage reader. New writes bind this exact returned Run.
            const runs = await d.db.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id,
              actorKind: access.actorKind, actorId: access.actorId }, orderBy: { sequence: 'desc' }, take: 2 }); live();
            if (!runs[0] || runs[1]?.sequence === runs[0].sequence) throw unavailable();
            runId = runs[0].id;
          }
          const run = await d.db.aiRun.findFirst({ where: { id: runId, taskId: task.id, scopeId: task.scopeId,
            actorKind: access.actorKind, actorId: access.actorId } }); live();
          if (!run || run.id !== runId || run.taskId !== task.id || run.scopeId !== task.scopeId) throw denied();
          const verify = async () => {
            const current = await root.tasks.resolveAccess(task.id, 'read_step_terminal'); live();
            const latest = await d.db.aiTask.findFirst({ where: current.where }); live();
            if (!latest || current.bindingKey !== access.bindingKey || latest.revision !== task.revision
              || (await readOriginalTaskModelProvenance(d.db, latest)).bindingHash !== provenance.bindingHash) throw conflict();
            const latestRun = await d.db.aiRun.findFirst({ where: { id: run.id, taskId: task.id, scopeId: task.scopeId,
              actorKind: access.actorKind, actorId: access.actorId } }); live();
            if (!latestRun || latestRun.revision !== run.revision || latestRun.status !== run.status
              || !latestRun.fencingToken.equals(run.fencingToken)) throw conflict();
            live();
          };
          return { task, run, access, query: { taskId: task.id, runId },
            original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: provenance.inputRef }, verify };
        };
        let result: AiTaskRecoveryTargetDraft | AiTaskRecoveryResultDraft | AiTaskRecoveryReceiptDraft | AiTaskRecoverySnapshotDraft;
        if (action === 'target') {
          const found = await read(() => locator(command as AiTaskRecoveryTargetQueryDraft));
          const target = await read(() => readTaskCenterRecoveryTarget({ db: d.db, tasks: root.tasks, original: d.original, clock }, request, found.query, signal));
          await read(found.verify);
          const actions: Array<'recover' | 'takeover'> = [];
          if (target.status === 'available' && d.host(target.host)
            && ['running', 'waiting_external', 'cancel_requested'].includes(target.snapshot.task.status)) {
            for (const action of ['recover', 'takeover'] as const) {
              try { await root.tasks.resolveAccess(found.task.id, action === 'recover' ? 'claim_recovery_run' : 'takeover_run'); live(); actions.push(action); }
              catch (error) { if (!(error instanceof AiTaskRepositoryError) || error.code !== 'AI_ACCESS_DENIED') throw error; }
            }
          }
          await read(found.verify);
          if (target.status === 'available' && !d.host(target.host)) actions.length = 0;
          result = target.status === 'available' ? { ...target, actions } : target;
        } else if (action === 'snapshot' || action === 'receipt') {
          const found = await read(() => locator(command as AiTaskRecoveryRunQueryDraft));
          if (action === 'snapshot') {
            const value = await read(() => d.original.readRecoverySnapshot(request, { original: found.original, runId: found.run.id }));
            if (!validateAiTaskCenterRecoveryValue('AiSceneModelRecoverySnapshotReadResponse', value)
              || !same(value.original, found.original) || value.snapshot.task.taskId !== found.task.id || value.snapshot.run.runId !== found.run.id) throw unavailable();
            result = value;
          } else {
            const query = command as AiTaskRecoveryReceiptQueryDraft;
            const value = await read(() => d.original.readTakeoverReceipt(request, { original: found.original, runId: found.run.id,
              expectedTaskRevision: query.expectedTaskRevision, expectedRunRevision: query.expectedRunRevision, expectedFencingToken: query.expectedFencingToken }));
            if (!value || typeof value !== 'object' || !('receipt' in value) || !('original' in value) || !same(value.original, found.original)) throw unavailable();
            const packet = { ...found.query, original: found.original, receipt: value.receipt, execution: 'read_only_no_lease_or_dispatch' };
            if (!validateAiTaskCenterRecoveryValue('AiTaskRecoveryReceiptDraft', packet)
              || packet.receipt.taskId !== found.task.id || packet.receipt.runId !== found.run.id) throw unavailable();
            result = packet;
          }
          await read(found.verify);
        } else {
          const commandValue = command as AiTaskRecoveryCommandDraft, fence = snapshotTaskCenterRecoveryFence(commandValue);
          const target = await read(() => readTaskCenterRecoveryTarget({ db: d.db, tasks: root.tasks, original: d.original, clock }, request,
            { taskId: fence.taskId, runId: fence.runId }, signal));
          if (target.status !== 'available') throw unavailable();
          assertTaskCenterRecoveryFence(fence, target.snapshot);
          await root.tasks.resolveAccess(fence.taskId, action === 'recover' ? 'claim_recovery_run' : 'takeover_run'); live();
          const host = d.host(target.host); if (!host) throw unavailable();
          const original = action === 'recover' ? target.original : { original: target.original,
            expectedTaskRevision: fence.expectedTaskRevision, expectedRunRevision: fence.expectedRunRevision, expectedFencingToken: fence.expectedFencingToken };
          const returned = await host[action](request, original, signal, fence); live();
          let outcome: unknown = returned;
          if (target.host === 'order_read') {
            const observed = validateAiOrderReadResponse(action, returned, original);
            if (!('original' in observed) || observed.original.inputRef !== target.original.inputRef || !('outcome' in observed)) throw unavailable();
            outcome = observed.outcome;
            // The order host has its own read-only outcome envelope. Preserve
            // the original runner facts while exposing the common UI outcome.
            if (action === 'takeover' && outcome && typeof outcome === 'object' && 'kind' in outcome
              && outcome.kind === 'run_outcome' && 'outcome' in outcome) {
              outcome = { kind: 'run_outcome', outcome: outcome.outcome, takeover: 'same_owner_recovery_only',
                businessExecution: 'not_inferred_from_model_result' };
            }
          }
          const packet = { taskId: fence.taskId, runId: fence.runId,
            outcome: validateAiModelRecoveryResponse('AiSceneModelExecutionDraft', outcome, true),
            automaticRetry: false, businessExecution: 'read_original_receipt' };
          if (!validateAiTaskCenterRecoveryValue('AiTaskRecoveryResultDraft', packet)) throw unavailable();
          result = packet;
        }
        const after = await identity.resolve(); live();
        if (originalIdentityHash(before) !== originalIdentityHash(after)) throw denied();
        if (!validateAiTaskCenterRecoveryValue(contract.response, result)) throw unavailable();
        return result;
      });
    } finally { close(); signal?.removeEventListener('abort', close); }
  };
  return { consume };
}

@Controller(AI_TASK_CENTER_RECOVERY_HTTP.basePath)
export class AiTaskCenterRecoveryController {
  constructor(@Inject(AI_TASK_CENTER_RECOVERY_REQUESTS) private readonly requests: ReturnType<typeof composeTaskCenterRecoveryRequests>) {}
  private call(request: Request, action: Action, value: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.consume(request, action, request.body ?? value, signal),
      { maxWaitMs: AI_TASK_CENTER_RECOVERY_CONTRACTS[action].write ? 120000 : 15000 }), 'read_original_recovery');
  }
  @Post(AI_TASK_CENTER_RECOVERY_HTTP.target) @HttpCode(200) @Header('Cache-Control', 'no-store')
  target(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'target', value); }
  @Post(AI_TASK_CENTER_RECOVERY_HTTP.snapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  snapshot(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'snapshot', value); }
  @Post(AI_TASK_CENTER_RECOVERY_HTTP.recover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  recover(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'recover', value); }
  @Post(AI_TASK_CENTER_RECOVERY_HTTP.takeover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  takeover(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'takeover', value); }
  @Post(AI_TASK_CENTER_RECOVERY_HTTP.receipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'receipt', value); }
}
