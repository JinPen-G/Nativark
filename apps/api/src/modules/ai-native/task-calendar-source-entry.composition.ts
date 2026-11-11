/** Calendar page -> original request/task metadata. Calendar-edit is checked
 * now and source rows stay bound to the original date/version/revision. Reads
 * never create a request, task or R1 proposal after an uncertain acknowledgement. */
import { hasEffectivePermission } from '../../common/permission-match';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION,
  aiTaskCalendarDraftSourceInput, aiTaskCalendarDraftSourceResponse, aiTaskCalendarDraftEntryInput,
  aiTaskCalendarDraftEntryReference, aiTaskCalendarDraftEntryResponse, aiTaskCalendarDraftPreparationValues,
  type AiTaskCalendarDraftEntryReference, type AiExecutionContext } from '@rental-os/shared';
import type { TaskCalendarDraftDependencies } from './task-calendar-draft.application';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { AiOpeningVersionFieldSource } from './tools/opening-version-fields.source';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { createCalendarOriginalRequests } from './task-calendar-original-source.composition';
import { originalIdentityHash } from './task-request/original-request.authority';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
export const calendarSourceEntryMarker = z.object({ kind: z.literal('calendar-source-entry-1'), operationKey: z.string().uuid(), commandHash: z.string().regex(/^[a-f0-9]{64}$/u),
  inputRef: z.string().uuid(), target: z.object({ id: z.string(), year: z.number().int(), version: z.string(), revision: z.number().int(),
    date: z.string(), status: z.literal('draft') }).strict(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
type Request = { headers: { authorization?: unknown } };
export function calendarSourceEntryOperationId(context: AiExecutionContext, reference: AiTaskCalendarDraftEntryReference) {
  const key = requestFingerprint({ kind: 'calendar-source-entry-1', scope: context.scope, actor: context.actor, reference });
  return `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20, 32)}`;
}
export function composeTaskCalendarSourceEntry(d: TaskCalendarDraftDependencies) {
  const db = d.original.db, clock = d.original.clock ?? (() => new Date());
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw denied(); return value; };
  const bind = async (request: Request, signal?: AbortSignal) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer \S+$/u.test(authorization)) throw denied();
    const credentials = { current: async () => {
      if (signal?.aborted) throw denied(); return { authorization, audience: 'operator' as const, requestId: randomUUID() };
    } };
    const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(d.original.auth, credentials, clock), clock);
    const first = await scopes.resolveCurrent(), context = first.context;
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
      || !('access' in context) || !hasEffectivePermission(context.access.permissions, 'rental-os:calendar:edit')) throw denied();
    const verify = async () => {
      if (signal?.aborted) throw denied(); const latest = await scopes.resolveCurrent();
      if (latest.scope.id !== first.scope.id || originalIdentityHash(latest.context) !== originalIdentityHash(context)) throw denied();
    };
    return { context, verify, input: { ...d.original, credentials }, routes: new AiBusinessReadRouteAuthority(d.original.guard, credentials, clock) };
  };
  type Bound = Awaited<ReturnType<typeof bind>>;
  const operationId = (root: Bound, reference: AiTaskCalendarDraftEntryReference) => calendarSourceEntryOperationId(root.context, reference);
  const readTargets = async (root: Bound, date: string) => {
    const year = Number(date.slice(0, 4)), targets = [];
    const rows = await root.routes.withCalendarSourceRead({ year, date }, async context => {
      assertAiReadContextBinding(context, root.context); if (context.scope.kind !== 'workspace') throw denied();
      return db.rentalBusinessCalendar.findMany({ where: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
        year, status: 'draft' }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 21 });
    });
    const fields = new AiOpeningVersionFieldSource(db, root.routes);
    for (const row of rows.slice(0, 20)) {
      if (row.year !== year || row.status !== 'draft' || !Array.isArray(row.days)
        || row.days.filter(day => day && typeof day === 'object' && !Array.isArray(day) && day.date === date).length !== 1) continue;
      const source = await fields.read({ key: 'business_calendar', targetId: row.id, expectedVersion: row.version,
        expectedRevision: row.revision, date }, root.context);
      targets.push({ id: row.id, year, version: row.version, revision: row.revision, date, status: 'draft' as const,
        values: aiTaskCalendarDraftPreparationValues.parse({ name: source.fields.name,
          ...(source.fields.businessStatus !== undefined ? { businessStatus: source.fields.businessStatus } : {}) }),
        sourceHash: requestFingerprint(source.basis) });
    }
    await root.verify(); return { targets, hasMore: rows.length > 20 };
  };
  const observe = async (root: Bound, reference: AiTaskCalendarDraftEntryReference) => {
    const row = await db.operationLog.findUnique({ where: { id: operationId(root, reference) } });
    const base = { contractVersion: AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION, reference, scope: root.context.scope,
      observedAt: now().toISOString(), model: 'not_called' as const, execution: 'not_started' as const, retryable: false as const };
    if (!row) { await root.verify(); return aiTaskCalendarDraftEntryResponse.parse({ ...base, operation: { state: 'not_observed', retryable: false } }); }
    if (root.context.scope.kind !== 'workspace' || root.context.actor.kind !== 'user' || row.action !== 'ai-native.calendar.entry'
      || row.tenantId !== root.context.scope.tenantId || row.workspaceId !== root.context.scope.workspaceId
      || row.userId !== root.context.actor.userId) throw denied();
    const saved = calendarSourceEntryMarker.parse(row.detail); if (saved.operationKey !== reference.operationKey) throw denied();
    const requests = createCalendarOriginalRequests(root.input, { year: saved.target.year, date: saved.target.date });
    const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: saved.inputRef };
    const receipt = await requests.readHistorical(original), task = await requests.readTaskReceipt(original.inputRef);
    if (receipt.receipt.state === 'revoked' || receipt.receipt.requestKey !== `calendar-entry:${reference.operationKey}`
      || receipt.request.sceneCode !== 'opening_diagnosis' || receipt.request.input.sections.length !== 1
      || receipt.request.input.sections[0] !== 'business_calendar') throw denied();
    await root.verify(); return aiTaskCalendarDraftEntryResponse.parse({ ...base, operation: { state: 'original_request_recorded',
      original, target: saved.target, task: task.state === 'observed' ? { state: 'observed', taskId: task.taskId, runId: task.runId }
        : { state: 'not_observed' } } });
  };
  const call = async (request: Request, value: unknown, action: 'source' | 'entry' | 'entryOperation', signal?: AbortSignal) => {
    const schema = action === 'source' ? aiTaskCalendarDraftSourceInput : action === 'entry'
      ? aiTaskCalendarDraftEntryInput : aiTaskCalendarDraftEntryReference;
    const parsed = schema.safeParse(structuredClone(value)); if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
      const root = await bind(request, signal), command = parsed.data;
      if (action === 'entryOperation') return observe(root, aiTaskCalendarDraftEntryReference.parse(command));
      // A recorded key is reconciled before consulting today's calendar. A
      // later revision cannot turn an uncertain ACK into another creation.
      if (action === 'entry') {
        const input = aiTaskCalendarDraftEntryInput.parse(command), reference = { operationKey: input.operationKey };
        const previous = await db.operationLog.findUnique({ where: { id: operationId(root, reference) } });
        if (previous) {
          if (calendarSourceEntryMarker.parse(previous.detail).commandHash !== requestFingerprint(input)) throw changed();
          return observe(root, reference);
        }
      }
      const date = 'date' in command ? command.date : '', selected = await readTargets(root, date);
      if (action === 'source') return aiTaskCalendarDraftSourceResponse.parse({ contractVersion: AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION,
        scope: root.context.scope, date, observedAt: now().toISOString(), ...selected, source: 'original_draft_calendar_date', task: 'not_created' });
      const input = aiTaskCalendarDraftEntryInput.parse(command), reference = { operationKey: input.operationKey };
      const target = selected.targets.find(row => row.id === input.targetId && row.version === input.version && row.revision === input.revision);
      if (!target) throw changed();
      if (root.context.scope.kind !== 'workspace' || root.context.actor.kind !== 'user') throw denied();
      const scope = root.context.scope, actor = root.context.actor;
      const requests = createCalendarOriginalRequests(root.input, { year: target.year, date });
      try {
        const receipt = await requests.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: `calendar-entry:${reference.operationKey}`,
          sceneCode: 'opening_diagnosis', input: { sections: ['business_calendar'] } }, false, async (tx, receipt) => {
          await tx.operationLog.create({ data: { id: operationId(root, reference), action: 'ai-native.calendar.entry', tenantId: scope.tenantId,
            workspaceId: scope.workspaceId, userId: actor.userId, detail: { kind: 'calendar-source-entry-1', operationKey: reference.operationKey,
              commandHash: requestFingerprint(input), inputRef: receipt.inputRef, target: { id: target.id, year: target.year, date,
                version: target.version, revision: target.revision, status: 'draft' }, sourceHash: target.sourceHash } } });
        });
        await root.verify(); await requests.createTask({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: receipt.inputRef });
        return await observe(root, reference);
      } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
    }), action === 'entry', signal);
  };
  return Object.freeze({ source: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'source', signal),
    entry: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'entry', signal),
    entryOperation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'entryOperation', signal) });
}
