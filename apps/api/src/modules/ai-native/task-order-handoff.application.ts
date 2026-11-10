/** Current Task provenance -> original order Guard/Core -> manual reference.
 * This human read never constructs a Gateway/Runtime, leases a Run, executes
 * business tools or treats a directory entry as allowed-action authority. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AI_TASK_ORDER_HANDOFF_HTTP, AI_TASK_ORDER_HANDOFF_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION,
  aiTaskOrderHandoffQuery, aiTaskOrderHandoffResponse } from '@rental-os/shared';
import { composePersistedTaskAuthorization } from './task-authorization.composition';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { originalIdentityHash } from './task-request/original-request.authority';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { validateAiOrderReadResponse } from './scenes/scene-observation-contracts';
import { runWithRequestIdentity } from '../../common/request-identity';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';
import { AiTaskOrderHandoffQueryDto } from './task-order-handoff.dto';
export const AI_TASK_ORDER_HANDOFF_REQUESTS = Symbol('AI_TASK_ORDER_HANDOFF_REQUESTS');
type Request = { headers: { authorization?: unknown } };
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export function composeRequestBoundTaskOrderHandoff(d: Omit<AiOriginalSceneDependencies, 'credentials'>) {
  return Object.freeze({ async read(request: Request, value: unknown, signal?: AbortSignal) {
    const parsed = aiTaskOrderHandoffQuery.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const query = freezeOriginalInput(parsed.data), authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer \S+$/u.test(authorization)) throw denied();
    let active = !signal?.aborted;
    const close = () => { active = false; }; signal?.addEventListener('abort', close, { once: true });
    const clock = d.clock ?? (() => new Date()), requestId = randomUUID();
    const credentials = { current: async () => { if (!active) throw denied(); return { authorization, requestId, audience: 'operator' as const }; } };
    try { return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
      const input = { ...d, credentials }, auth = composePersistedTaskAuthorization(input), scenes = composeAiOriginalScenes(input);
      const context = await auth.authority.resolve(query.taskId, 'read_metadata');
      const access = await auth.tasks.resolveAccess(query.taskId, 'read_metadata');
      if (context.actor.kind !== 'user' || context.audience !== 'operator' || context.scope.kind !== 'workspace'
        || aiTaskAccessFromContext(context, query.taskId, clock()).bindingKey !== access.bindingKey) throw denied();
      const task = await d.db.aiTask.findFirst({ where: access.where });
      if (!task || task.id !== query.taskId || task.sceneCode !== 'order_explanation' || task.ownerKind !== 'USER'
        || task.ownerId !== context.actor.userId || task.archivedAt !== null || !task.inputRef) throw denied();
      const reference = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef };
      const original = await scenes.requests.readHistorical(reference), created = await scenes.readTaskReceipt(task.inputRef);
      if (original.request.sceneCode !== 'order_explanation' || original.receipt.state === 'revoked'
        || original.receipt.contentHash !== task.inputHash || original.receipt.sceneVersion !== task.sceneVersion
        || created.state !== 'observed' || created.taskId !== task.id || (query.runId !== undefined && query.runId !== created.runId)) throw denied();
      const run = await d.db.aiRun.findFirst({ where: { id: created.runId, scopeId: task.scopeId, taskId: task.id } });
      if (!run || run.id !== created.runId || run.taskId !== task.id || run.scopeId !== task.scopeId
        || run.actorKind !== 'USER' || run.actorId !== task.ownerId) throw denied();
      assertAiReadContextBinding(original.context, context);
      const verify = async () => {
        if (!active) throw denied();
        const current = await auth.tasks.resolveAccess(query.taskId, 'read_metadata');
        const latest = await d.db.aiTask.findFirst({ where: current.where });
        const receipt = await scenes.requests.readHistorical(reference), binding = await scenes.readTaskReceipt(task.inputRef!);
        if (current.bindingKey !== access.bindingKey || !latest || latest.id !== task.id || latest.ownerId !== task.ownerId
          || latest.archivedAt !== null || latest.inputRef !== task.inputRef || latest.inputHash !== task.inputHash
          || latest.sceneCode !== task.sceneCode || latest.sceneVersion !== task.sceneVersion
          || latest.scopeId !== task.scopeId || latest.scopeKind !== task.scopeKind
          || receipt.receipt.state === 'revoked' || receipt.receipt.contentHash !== original.receipt.contentHash
          || originalIdentityHash(receipt.context) !== originalIdentityHash(original.context)
          || binding.state !== 'observed' || binding.taskId !== task.id || binding.runId !== run.id) throw denied();
      };
      await verify();
      const orderId = original.request.input.orderId, reader = scenes.tools.order(orderId);
      const first = await reader.read(original.context);
      const next = await scenes.tools.orderNextSteps(orderId).read(original.context);
      const handoff = validateAiOrderReadResponse('readNextSteps', { original: original.receipt, next,
        execution: 'not_attempted', approval: 'not_granted' }, reference);
      const latest = await reader.read(original.context);
      if (first.audience !== 'operator' || latest.audience !== 'operator' || first.order.id !== orderId
        || next.orderId !== orderId || requestFingerprint(first.scope) !== requestFingerprint(context.scope)
        || requestFingerprint(next.scope) !== requestFingerprint(context.scope)
        || requestFingerprint(latest.order) !== requestFingerprint(first.order)
        || requestFingerprint(latest.scope) !== requestFingerprint(first.scope)) throw unavailable();
      await verify();
      return freezeOriginalInput(aiTaskOrderHandoffResponse.parse({ contractVersion: AI_TASK_ORDER_HANDOFF_VERSION,
        taskId: task.id, runId: run.id, scope: context.scope, origin: { draftVersion: original.receipt.draftVersion,
          inputRef: original.receipt.inputRef, contentHash: original.receipt.contentHash, sceneVersion: original.receipt.sceneVersion, requestKey: original.receipt.requestKey },
        order: { id: latest.order.id, orderNo: latest.order.orderNo, status: latest.order.status, version: latest.order.updatedAt, observedAt: latest.observedAt },
        next: { status: handoff.next.status, allowedActions: handoff.next.allowedActions,
          candidates: handoff.next.candidates.map(item => ({ code: item.code, version: item.version, kind: item.kind,
            executable: item.executable, permission: item.permission, requirements: item.requirements })), manual: handoff.next.manual },
        execution: handoff.execution, approval: handoff.approval, consistency: 'revalidated_reads_not_atomic_snapshot' }));
    }), false, signal); } finally { active = false; signal?.removeEventListener('abort', close); }
  } });
}
@Controller(AI_TASK_ORDER_HANDOFF_HTTP.basePath)
export class AiTaskOrderHandoffController {
  constructor(@Inject(AI_TASK_ORDER_HANDOFF_REQUESTS) private readonly requests: ReturnType<typeof composeRequestBoundTaskOrderHandoff>) {}
  @Post(AI_TASK_ORDER_HANDOFF_HTTP.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: IncomingMessage, @Body() _value: AiTaskOrderHandoffQueryDto) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.read(request, (request as IncomingMessage & { body?: unknown }).body, signal)), 'read_original_order_handoff');
  }
}
