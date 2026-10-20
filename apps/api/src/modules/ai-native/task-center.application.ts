/** Standard operator read-only host over the original task center. Current
 * Auth/owner/action policies are mandatory; no Gateway, runner or quota writes. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AI_TASK_CENTER_HTTP_DRAFT, AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TASK_STATUSES_DRAFT,
  AI_TASK_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, type AiTaskModelObservationDraft } from '@rental-os/shared';
import type { PrismaClient } from '@prisma/client';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composePersistedTaskCenter } from './task-center.composition';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { originalIdentityHash } from './task-request/original-request.authority';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { withRequestAbort } from './scenes/request-abort';
import { respondAiScene } from './scenes/original-scenes.controller';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { BudgetError } from './budget/budget.ports';
import type { TaskBudgetUsageDb } from './budget/task-budget-usage.reader';
import { PrismaTaskConfirmationHistoryReader } from './runner/prisma-task-confirmation-history.reader';
import { composeTaskCenterApproval, taskCenterReviewSchema, taskCenterDecisionSchema,
  type TaskCenterApprovalDependencies } from './task-center-approval.composition';

export const AI_NATIVE_TASK_CENTER_REQUESTS = Symbol('AI_NATIVE_TASK_CENTER_REQUESTS');
type Request = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Dependencies = Omit<Parameters<typeof composePersistedTaskCenter>[0], 'credentials' | 'usageDb' | 'performanceDb'> & {
  originalDb?: Pick<PrismaClient, 'aiTaskOriginalRequest'>;
  usageDb?: TaskBudgetUsageDb;
  originalResults?: { readModelResult(request: Request, value: unknown): Promise<unknown> };
  humanApprovals?: TaskCenterApprovalDependencies;
};
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const schemas = {
  list: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(512).optional(),
    status: z.enum(AI_TASK_STATUSES_DRAFT).optional(), sceneCode: id.optional() }).strict(),
  snapshot: z.object({ taskId: id }).strict(),
  events: z.object({ taskId: id, after: z.string().max(20).regex(/^(0|[1-9][0-9]*)$/u), limit: z.number().int().min(1).max(100) }).strict(),
  result: z.object({ taskId: id, resultId: id }).strict(),
  confirmation: z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36) }).strict(),
  review: taskCenterReviewSchema, decision: taskCenterDecisionSchema, decisionReceipt: taskCenterDecisionSchema,
  usage: z.object({ taskId: id.max(36), limit: z.number().int().min(1).max(20), after: id.max(36).optional() }).strict()
};
const modelObservation = z.object({ taskId: id, runId: id, resultId: id, sceneCode: z.enum(['order_explanation', 'opening_diagnosis', 'quote_clarification']),
  status: z.enum(['available', 'stale', 'unknown', 'failed']),
  text: z.object({ value: z.string().max(131072), trust: z.literal('unverified_model_text_not_execution_evidence') }).strict().nullable(),
  observedAt: z.string().datetime({ offset: true }), businessExecution: z.literal('not_inferred_from_model_result') }).passthrough();

export function composeRequestBoundTaskCenter(input: Dependencies) {
  const readOriginalResult = input.originalResults?.readModelResult.bind(input.originalResults);
  const call = async (request: Request, value: unknown, action: keyof typeof schemas, signal?: AbortSignal) => {
    const header = z.string().max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).safeParse(request?.headers?.authorization);
    if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let command: unknown;
    try { command = structuredClone(value); if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 8192) throw Error(); }
    catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
    if (!schemas[action].safeParse(command).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const requestId = randomUUID();
    let active = true;
    const close = () => { active = false; };
    const credentials = { current: async () => {
      if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization: header.data, requestId, audience: 'operator' as const };
    } };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        const identity = new AiTaskCurrentIdentityAuthority(input.auth, credentials, input.clock);
        const before = await identity.resolve();
        if (before.audience !== 'operator' || !('access' in before)
          || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(permission => before.access.permissions.includes(permission)))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const root = composePersistedTaskCenter({ ...input, credentials });
        const originalResult = async (): Promise<AiTaskModelObservationDraft> => {
          const query = schemas.result.parse(command);
          if (!input.originalDb || !readOriginalResult) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const access = await root.tasks.resolveAccess(query.taskId, 'read_step_terminal');
          const task = structuredClone(await input.db.aiTask.findFirst({ where: access.where }));
          if (!task || !['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(task.sceneCode))
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          // Task ID and result ID are lookup keys, not caller-selected original
          // input or permission. Use the stored immutable task provenance.
          const provenance = await readOriginalTaskModelProvenance(input.originalDb, task);
          const result = modelObservation.safeParse(structuredClone(await readOriginalResult(
            { headers: { authorization: header.data } }, { original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
              inputRef: provenance.inputRef }, resultId: query.resultId })));
          if (!result.success || result.data.taskId !== query.taskId || result.data.resultId !== query.resultId || result.data.sceneCode !== task.sceneCode
            || (result.data.status === 'available') !== (result.data.text !== null)
            || result.data.text && Buffer.byteLength(result.data.text.value, 'utf8') > 131072)
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const latestAccess = await root.tasks.resolveAccess(query.taskId, 'read_step_terminal');
          const latest = structuredClone(await input.db.aiTask.findFirst({ where: latestAccess.where }));
          if (!latest || task.revision !== latest.revision || access.bindingKey !== latestAccess.bindingKey
            || (await readOriginalTaskModelProvenance(input.originalDb, latest)).bindingHash !== provenance.bindingHash)
            throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          const r = result.data;
          return { contractVersion: AI_TASK_DRAFT_VERSION, taskId: r.taskId, runId: r.runId, resultId: r.resultId,
            sceneCode: r.sceneCode, status: r.status, text: r.text, observedAt: r.observedAt,
            businessExecution: r.businessExecution, execution: 'read_only_no_start_no_reconnect_side_effect' };
        };
        const approvalAction = async () => {
          if (!input.humanApprovals || input.humanApprovals.order.db !== input.db) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const approvals = composeTaskCenterApproval(input.humanApprovals, credentials, root.tasks);
          if (action === 'review') return approvals.review(command);
          if (action === 'decision') return approvals.decision(command);
          return approvals.decisionReceipt(command);
        };
        const result = ['review', 'decision', 'decisionReceipt'].includes(action) ? await approvalAction() : action === 'list' ? await root.list.readPage(command) : action === 'snapshot'
          ? await root.events.readSnapshot(command, true) : action === 'events' ? await root.events.readPage(command)
            : action === 'result' ? await originalResult() : action === 'confirmation'
              ? await new PrismaTaskConfirmationHistoryReader(input.db, root.tasks).read(command) : await (async () => {
              if (!root.usage) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
              try { return await root.usage.read(command); }
              catch (error) {
                if (!(error instanceof BudgetError)) throw error;
                throw new AiTaskRepositoryError(error.code === 'FORBIDDEN' ? 'AI_ACCESS_DENIED' : error.code === 'INVALID'
                  ? 'AI_INVALID_INPUT' : error.code === 'PENDING_RECONCILIATION' ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE');
              }
            })();
        if (!active || originalIdentityHash(await identity.resolve()) !== originalIdentityHash(before))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return structuredClone(result);
      }), action === 'decision', signal);
    } finally { close(); signal?.removeEventListener('abort', close); }
  };
  return Object.freeze({ list: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'list', signal),
    snapshot: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'snapshot', signal),
    events: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'events', signal),
    result: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'result', signal),
    usage: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'usage', signal),
    review: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'review', signal),
    decision: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'decision', signal),
    decisionReceipt: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'decisionReceipt', signal),
    confirmation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'confirmation', signal) });
}

@Controller(AI_TASK_CENTER_HTTP_DRAFT.basePath)
export class AiTaskCenterController {
  constructor(@Inject(AI_NATIVE_TASK_CENTER_REQUESTS) private readonly center: ReturnType<typeof composeRequestBoundTaskCenter>) {}
  private respond(request: Request, value: unknown, action: keyof typeof schemas) {
    return respondAiScene(() => withRequestAbort(request, signal => this.center[action](request, value, signal)),
      action === 'decision' || action === 'decisionReceipt' ? 'read_decision_receipt' : 'reconcile');
  }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'list'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.snapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  snapshot(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'snapshot'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.events) @HttpCode(200) @Header('Cache-Control', 'no-store')
  events(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'events'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.result) @HttpCode(200) @Header('Cache-Control', 'no-store')
  result(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'result'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.usage) @HttpCode(200) @Header('Cache-Control', 'no-store')
  usage(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'usage'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.confirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  confirmation(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'confirmation'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.review) @HttpCode(200) @Header('Cache-Control', 'no-store')
  review(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'review'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.decision) @HttpCode(200) @Header('Cache-Control', 'no-store')
  decision(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'decision'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.decisionReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  decisionReceipt(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'decisionReceipt'); }
}
