/** Standard operator task observations, human decisions and explicit original
 * clarification/continuation. Current owner/action policies remain mandatory;
 * execution delegates to existing hosts, never another runner or ledger. */
import { hasEffectivePermission } from '../../common/permission-match';
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AI_TASK_CENTER_HTTP_DRAFT, AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TASK_STATUSES_DRAFT,
  AI_TASK_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, type AiTaskModelObservationDraft, type AiTaskClientVisibleReportDraft } from '@rental-os/shared';
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
import { readTaskCenterBusiness, type TaskCenterBusinessDependencies } from './task-center-business.reader';
import { continueTaskCenterOriginal, taskCenterContinueSchema, type TaskCenterContinuationDependencies } from './task-center-continuation.composition';
import { callAiTaskRunnerDependency, AiTaskRunnerError } from './runner/ai-task-runner.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { callTaskCenterInput, taskCenterInputQuery, taskCenterInputAnswer, taskCenterInputReceipt, type TaskCenterInputDependencies } from './task-center-input.composition';
import { recordTaskVisibleObservation, type TaskVisibleObservationDependencies } from './observability/task-visible-observation.service';
import { validateAiTaskObservation } from './task-contract-validation';
import { validateAiSceneSourceObservation } from './scenes/scene-observation-contracts';

export const AI_NATIVE_TASK_CENTER_REQUESTS = Symbol('AI_NATIVE_TASK_CENTER_REQUESTS');
type Request = { headers: { authorization?: unknown }; body?: unknown } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Dependencies = Omit<Parameters<typeof composePersistedTaskCenter>[0], 'credentials' | 'usageDb'> & {
  originalDb?: Pick<PrismaClient, 'aiTaskOriginalRequest'>;
  usageDb?: TaskBudgetUsageDb;
  visibleDb?: TaskVisibleObservationDependencies['db'];
  originalResults?: { readModelResult(request: Request, value: unknown): Promise<unknown>;
    reopenModelSource?(request: Request, value: unknown): Promise<unknown> };
  humanApprovals?: TaskCenterApprovalDependencies;
  business?: TaskCenterBusinessDependencies;
  continuation?: TaskCenterContinuationDependencies;
  originalInputs?: TaskCenterInputDependencies;
};
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const schemas = {
  visibleReport: z.custom<AiTaskClientVisibleReportDraft>(value => { try { validateAiTaskObservation('AiTaskClientVisibleReportDraft', value); return true; } catch { return false; } }),
  performance: z.object({ taskId: id.max(36), usageLimit: z.number().int().min(1).max(20), usageAfter: id.max(36).optional(), includeTaskFinancial: z.boolean().optional() }).strict(),
  usageSummary: z.object({ taskId: id.max(36) }).strict(),
  outcomes: z.object({ taskIds: z.array(id.max(36)).min(1).max(50).refine(ids => new Set(ids).size === ids.length) }).strict(),
  list: z.object({ limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(512).optional(),
    status: z.enum(AI_TASK_STATUSES_DRAFT).optional(), sceneCode: id.optional() }).strict(),
  snapshot: z.object({ taskId: id }).strict(),
  events: z.object({ taskId: id, after: z.string().max(20).regex(/^(0|[1-9][0-9]*)$/u), limit: z.number().int().min(1).max(100) }).strict(),
  result: z.object({ taskId: id, resultId: id }).strict(),
  source: z.object({ taskId: id, resultId: id, source: z.object({ kind: z.enum(['order', 'knowledge']),
    index: z.number().int().min(0).max(4), referenceHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict() }).strict(),
  confirmation: z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36) }).strict(),
  review: taskCenterReviewSchema, business: taskCenterReviewSchema, decision: taskCenterDecisionSchema, decisionReceipt: taskCenterDecisionSchema,
  continue: taskCenterContinueSchema,
  input: taskCenterInputQuery, resumeInput: taskCenterInputAnswer, inputReceipt: taskCenterInputReceipt, continueInput: taskCenterInputReceipt,
  stop: z.object({ taskId: id, expectedRevision: z.number().int().min(1).max(4294967294) }).strict(),
  stopReceipt: z.object({ taskId: id, expectedRevision: z.number().int().min(1).max(4294967294) }).strict(),
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
    try {
      command = structuredClone(value);
      const limit = ['resumeInput', 'inputReceipt', 'continueInput'].includes(action) ? 65536 : 8192;
      if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > limit) throw Error();
    }
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
      const work = (activeSignal = signal) => runWithRequestIdentity({}, async () => {
        const identity = new AiTaskCurrentIdentityAuthority(input.auth, credentials, input.clock);
        const before = await identity.resolve();
        if (before.audience !== 'operator' || !('access' in before)
          || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(permission => hasEffectivePermission(before.access.permissions, permission)))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const root = composePersistedTaskCenter({ ...input, credentials, includeCancellation: action === 'stop' || action === 'stopReceipt' });
        const originalResult = async (query = schemas.result.parse(command)): Promise<AiTaskModelObservationDraft> => {
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
          const sources: AiTaskModelObservationDraft['sources'] = [];
          if (r.status === 'available') {
            const references = z.object({ sources: z.array(z.record(z.unknown())).max(5).optional(),
              knowledge: z.object({ material: z.object({ sources: z.array(z.object({ source: z.record(z.unknown()) }).passthrough()).max(4) }).passthrough() }).passthrough().optional() })
              .passthrough().safeParse(r);
            if (!references.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
            for (const [index, reference] of (references.data.sources ?? []).entries())
              sources.push({ kind: 'order', index, referenceHash: requestFingerprint(reference) });
            for (const [index, entry] of (references.data.knowledge?.material.sources ?? []).entries())
              sources.push({ kind: 'knowledge', index, referenceHash: requestFingerprint(entry.source) });
          }
          return { contractVersion: AI_TASK_DRAFT_VERSION, taskId: r.taskId, runId: r.runId, resultId: r.resultId,
            sceneCode: r.sceneCode, status: r.status, text: r.text, sources, observedAt: r.observedAt,
            businessExecution: r.businessExecution, execution: 'read_only_no_start_no_reconnect_side_effect' };
        };
        const originalSource = async () => {
          const query = schemas.source.parse(command), lookup = { taskId: query.taskId, resultId: query.resultId };
          const before = await originalResult(lookup), reference = query.source;
          const matches = (result: AiTaskModelObservationDraft) => result.status === 'available'
            && result.sources.some(source => source.kind === reference.kind && source.index === reference.index
              && source.referenceHash === reference.referenceHash);
          if (!matches(before)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          if (!input.originalDb || !input.originalResults?.reopenModelSource) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const access = await root.tasks.resolveAccess(query.taskId, 'read_step_terminal');
          const row = await input.db.aiTask.findFirst({ where: access.where });
          if (!row) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const original = await readOriginalTaskModelProvenance(input.originalDb, row);
          const sourceCommand = { original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: original.inputRef },
            resultId: query.resultId, sourceKind: reference.kind, sourceIndex: reference.index };
          const opened = validateAiSceneSourceObservation(await input.originalResults.reopenModelSource(
            { headers: { authorization: header.data } }, structuredClone(sourceCommand)), sourceCommand);
          if (opened.resultId !== query.resultId || opened.sourceIndex !== reference.index
            || requestFingerprint(opened.reference) !== reference.referenceHash) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          // Text/JSON are inert source data, never rich HTML, a route or tool instructions.
          const content = opened.sourceKind === 'knowledge'
            ? { format: 'text' as const, value: opened.source.text }
            : { format: 'json' as const, value: JSON.stringify(opened.source) };
          if (typeof content.value !== 'string' || Buffer.byteLength(content.value, 'utf8') > 65536)
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const after = await originalResult(lookup);
          if (!matches(after) || after.runId !== before.runId || after.text?.value !== before.text?.value)
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return { contractVersion: AI_TASK_DRAFT_VERSION, ...lookup, runId: after.runId, source: reference,
            observedAt: after.observedAt, content: { ...content, trust: 'source_data_not_instructions' as const },
            execution: 'read_only_no_start_no_reconnect_side_effect' as const };
        };
        const approvalAction = async () => {
          if (!input.humanApprovals || input.humanApprovals.order.db !== input.db) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const approvals = composeTaskCenterApproval(input.humanApprovals, credentials, root.tasks);
          if (action === 'review') return approvals.review(command);
          if (action === 'decision') return approvals.decision(command, activeSignal);
          return approvals.decisionReceipt(command);
        };
        const originalStop = async () => {
          const query = schemas.stop.parse(command);
          if (!root.cancellation) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const access = await root.tasks.resolveAccess(query.taskId, 'read_metadata');
          const task = await input.db.aiTask.findFirst({ where: access.where });
          if (!task) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          if (action === 'stop') {
            if (task.revision !== query.expectedRevision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
            // The original repository owns transition policy, task CAS, audit
            // event and cancellation state. No lease, remote cancel or refund.
            await root.cancellation.request(query);
          }
          try {
            const result = z.object({ taskId: id, expectedRevision: z.number().int(),
              status: z.enum(['observed', 'not_observed']), cancellation: z.literal('request_not_rollback'),
              automaticRetry: z.literal(false), remoteCancellation: z.literal('not_attested') }).passthrough()
              .safeParse(await root.cancellation.read(query));
            if (!result.success || result.data.taskId !== query.taskId || result.data.expectedRevision !== query.expectedRevision)
              throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
            if (action === 'stop' && result.data.status !== 'observed') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            const latest = await root.tasks.resolveAccess(query.taskId, 'read_metadata');
            if (access.bindingKey !== latest.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            return { ...query, status: result.data.status, cancellation: 'request_not_rollback' as const,
              automaticRetry: false as const, remoteCancellation: 'not_attested' as const, budgetRelease: 'not_attempted' as const };
          } catch (error) {
            if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
            if (action === 'stop') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            throw error;
          }
        };
        const business = () => {
          if (!input.business || input.business.db !== input.db) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return readTaskCenterBusiness(input.business, input.humanApprovals?.settings, credentials, root.tasks,
            { headers: { authorization: header.data } }, command, input.clock);
        };
        const continueOriginal = () => {
          if (!input.continuation || input.continuation.db !== input.db || !input.humanApprovals) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return continueTaskCenterOriginal(input.continuation, input.humanApprovals, credentials, root.tasks,
            { headers: { authorization: header.data } }, command, activeSignal);
        };
        const originalInput = () => {
          if (!input.originalDb || !input.originalInputs) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return callTaskCenterInput({ db: { aiTask: input.db.aiTask, aiTaskOriginalRequest: input.originalDb.aiTaskOriginalRequest },
            original: input.originalInputs, tasks: root.tasks, credentials }, { headers: { authorization: header.data } }, command,
            action as 'input' | 'resumeInput' | 'inputReceipt' | 'continueInput', activeSignal);
        };
        const clientVisibleSource = async (report: AiTaskClientVisibleReportDraft): Promise<string | null> => {
              const access = await root.tasks.resolveAccess(report.taskId, 'read_step_terminal');
              const task = await input.db.aiTask.findFirst({ where: access.where });
              if (!task) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
              if (report.trigger === 'original_model_start') {
                if (!input.originalDb || (await readOriginalTaskModelProvenance(input.originalDb, task)).inputRef !== report.originKey)
                  throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
              }
              if (report.source.kind === 'model_result') {
                const result = await originalResult({ taskId: report.taskId, resultId: report.source.resultId });
                if (result.status !== 'available' || result.runId !== report.runId || !result.text?.value.trim())
                  return null;
              } else {
                if (!input.humanApprovals || input.humanApprovals.order.db !== input.db) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
                const result = await composeTaskCenterApproval(input.humanApprovals, credentials, root.tasks).review({
                  taskId: report.taskId, runId: report.runId, stepId: report.source.stepId });
                if (result.review.proposal.payload.proposalId !== report.source.proposalId
                  || result.review.proposal.payload.revision !== report.source.proposalRevision
                  || !['pending_confirmation', 'confirmed'].includes(result.review.proposal.status))
                  return null;
              }
              return requestFingerprint({ taskId: report.taskId, runId: report.runId, source: report.source });
        };
        const result = action === 'visibleReport' ? await (async () => {
          if (!input.visibleDb || !Object.is(input.db, input.visibleDb)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return recordTaskVisibleObservation({ db: input.visibleDb, tasks: root.tasks, clock: input.clock,
            sourceBinding: clientVisibleSource
          }, command, activeSignal);
        })() : action === 'performance'  ? await (async () => {
          if (!root.performance) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return root.performance.read(schemas.performance.parse(command), clientVisibleSource);
        })() : action === 'outcomes' ? await (async () => {
          if (!root.performance) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return root.performance.sample(schemas.outcomes.parse(command));
        })() : ['input', 'resumeInput', 'inputReceipt', 'continueInput'].includes(action) ? await originalInput()
          : action === 'stop' || action === 'stopReceipt' ? await originalStop() : action === 'continue' ? await continueOriginal() : action === 'business' ? await business() : ['review', 'decision', 'decisionReceipt'].includes(action) ? await approvalAction() : action === 'list' ? await root.list.readPage(command) : action === 'snapshot'
          ? await root.events.readSnapshot(command, true) : action === 'events' ? await root.events.readPage(command)
            : action === 'result' ? await originalResult() : action === 'source' ? await originalSource() : action === 'confirmation'
              ? await new PrismaTaskConfirmationHistoryReader(input.db, root.tasks).read(command) : await (async () => {
              if (!root.usage) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
              try { return action === 'usageSummary' ? await root.usage.summary(command) : await root.usage.read(command); }
              catch (error) {
                if (!(error instanceof BudgetError)) throw error;
                throw new AiTaskRepositoryError(error.code === 'FORBIDDEN' ? 'AI_ACCESS_DENIED' : error.code === 'INVALID'
                  ? 'AI_INVALID_INPUT' : error.code === 'PENDING_RECONCILIATION' ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE');
              }
            })();
        if (!active || originalIdentityHash(await identity.resolve()) !== originalIdentityHash(before))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return structuredClone(result);
      });
      if (action === 'decision') {
        try { return await callAiTaskRunnerDependency(work, 20000, 'task_center_explicit_decision', signal); }
        catch (error) {
          if (error instanceof AiTaskRunnerError && ['AI_RESULT_UNKNOWN', 'AI_RUN_LIMIT'].includes(error.code))
            throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
          throw error;
        }
      }
      if (!['continue', 'resumeInput', 'continueInput'].includes(action)) return await waitForTaskApplicationDependency(work, action === 'stop' || action === 'visibleReport', signal);
      try { return await callAiTaskRunnerDependency(work, 120000, 'task_center_original_continue', signal); }
      catch (error) {
        if (error instanceof AiTaskRunnerError && ['AI_RESULT_UNKNOWN', 'AI_RUN_LIMIT'].includes(error.code))
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw error;
      }
    } finally { close(); signal?.removeEventListener('abort', close); }
  };
  return Object.freeze({ list: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'list', signal),
    snapshot: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'snapshot', signal),
    events: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'events', signal),
    result: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'result', signal),
    source: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'source', signal),
    stop: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'stop', signal),
    stopReceipt: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'stopReceipt', signal),
    usage: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'usage', signal),
    usageSummary: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'usageSummary', signal),
    visibleReport: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'visibleReport', signal),
    performance: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'performance', signal),
    outcomes: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'outcomes', signal),
    review: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'review', signal),
    decision: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'decision', signal),
    decisionReceipt: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'decisionReceipt', signal),
    business: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'business', signal),
    continue: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'continue', signal),
    input: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'input', signal),
    resumeInput: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'resumeInput', signal),
    inputReceipt: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'inputReceipt', signal),
    continueInput: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'continueInput', signal),
    confirmation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'confirmation', signal) });
}

@Controller(AI_TASK_CENTER_HTTP_DRAFT.basePath)
export class AiTaskCenterController {
  constructor(@Inject(AI_NATIVE_TASK_CENTER_REQUESTS) private readonly center: ReturnType<typeof composeRequestBoundTaskCenter>) {}
  private respond(request: Request, value: unknown, action: keyof typeof schemas) {
    return respondAiScene(() => withRequestAbort(request, async signal => {
      const result = await this.center[action](request, value, signal);
      if (action === 'list') return validateAiTaskObservation('AiTaskMetadataPageDraft', result);
      if (action === 'snapshot') return validateAiTaskObservation('AiTaskSnapshotDraft', result);
      if (action === 'events') return validateAiTaskObservation('AiTaskEventsObservationDraft', result);
      if (action === 'usageSummary') return validateAiTaskObservation('AiTaskBudgetUsageSummaryDraft', result);
      if (action === 'visibleReport') return validateAiTaskObservation('AiTaskClientVisibleReceiptDraft', result);
      if (action === 'performance') return validateAiTaskObservation('AiTaskPerformanceObservationDraft', result);
      if (action === 'outcomes') return validateAiTaskObservation('AiTaskOutcomeSampleDraft', result);
      return result;
    }),
      action === 'decision' || action === 'decisionReceipt' ? 'read_decision_receipt' : action === 'stop' ? 'read_stop_receipt' : action === 'continue' ? 'read_original_business' : 'reconcile');
  }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'list'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.snapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  snapshot(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'snapshot'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.events) @HttpCode(200) @Header('Cache-Control', 'no-store')
  events(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'events'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.result) @HttpCode(200) @Header('Cache-Control', 'no-store')
  result(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'result'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.source) @HttpCode(200) @Header('Cache-Control', 'no-store')
  source(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'source'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.stop) @HttpCode(200) @Header('Cache-Control', 'no-store')
  stop(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'stop'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.stopReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  stopReceipt(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'stopReceipt'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.usage) @HttpCode(200) @Header('Cache-Control', 'no-store')
  usage(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'usage'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.usageSummary) @HttpCode(200) @Header('Cache-Control', 'no-store')
  usageSummary(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'usageSummary'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.visibleReport) @HttpCode(200) @Header('Cache-Control', 'no-store')
  visibleReport(@Req() request: Request, @Body() _value: unknown) { return this.respond(request, request.body, 'visibleReport'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.performance) @HttpCode(200) @Header('Cache-Control', 'no-store')
  performance(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'performance'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.outcomes) @HttpCode(200) @Header('Cache-Control', 'no-store')
  outcomes(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'outcomes'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.confirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  confirmation(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'confirmation'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.review) @HttpCode(200) @Header('Cache-Control', 'no-store')
  review(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'review'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.decision) @HttpCode(200) @Header('Cache-Control', 'no-store')
  decision(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'decision'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.decisionReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  decisionReceipt(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'decisionReceipt'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.business) @HttpCode(200) @Header('Cache-Control', 'no-store')
  business(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'business'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.continue) @HttpCode(200) @Header('Cache-Control', 'no-store')
  continue(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'continue'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.input) @HttpCode(200) @Header('Cache-Control', 'no-store')
  input(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'input'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.resumeInput) @HttpCode(200) @Header('Cache-Control', 'no-store')
  resumeInput(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'resumeInput'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.inputReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  inputReceipt(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'inputReceipt'); }
  @Post(AI_TASK_CENTER_HTTP_DRAFT.continueInput) @HttpCode(200) @Header('Cache-Control', 'no-store')
  continueInput(@Req() request: Request, @Body() value: unknown) { return this.respond(request, value, 'continueInput'); }
}
