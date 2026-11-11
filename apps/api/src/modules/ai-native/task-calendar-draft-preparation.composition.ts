/** Human calendar edit -> linked original request -> existing R1 proposal.
 * Current calendar Guard, original task ownership and the persisted source
 * revision are revalidated. Unknown reads never resume or recreate a stage. */
import { hasEffectivePermission } from '../../common/permission-match';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION,
  aiTaskCalendarDraftPreparationInput, aiTaskCalendarDraftPreparationResponse, aiTaskCalendarDraftPreparationPreviewInput,
  aiTaskCalendarDraftPreparationPreviewResponse, aiTaskCalendarDraftPrepareInput, aiTaskCalendarDraftPreparationReference,
  aiTaskCalendarDraftPreparationOperationResponse, aiTaskCalendarDraftPreparationValues,
  type AiTaskCalendarDraftPreparationPreviewInput, type AiTaskCalendarDraftPreparationReference,
  type AiTaskCalendarDraftListResponse, type AiExecutionContext } from '@rental-os/shared';
import type { TaskCalendarDraftDependencies } from './task-calendar-draft.application';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { createCalendarOriginalRequests } from './task-calendar-original-source.composition';
import { calendarSourceEntryMarker, calendarSourceEntryOperationId } from './task-calendar-source-entry.composition';
import { createOriginalTaskStartAdmission } from './task-start-admission.composition';
import { originalIdentityHash } from './task-request/original-request.authority';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { AiOpeningVersionFieldSource } from './tools/opening-version-fields.source';
import { AiGuardedOpeningConfigurationSource } from './tools/opening-configuration.source';
import { AiOpeningSectionDifferenceService, verifyOpeningSectionMaterial } from './tools/opening-section-difference.service';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { composeOpeningProposalWorkflow } from './scenes/opening-proposal-workflow.composition';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { runWithRequestIdentity } from '../../common/request-identity';

type Request = { headers: { authorization?: unknown } };
type Dependencies = TaskCalendarDraftDependencies & {
  saved(request: Request, taskId: string, signal?: AbortSignal): Promise<AiTaskCalendarDraftListResponse>;
};
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const hash = z.string().regex(/^[a-f0-9]{64}$/u), id = z.string().min(1).max(36);
const marker = z.object({ kind: z.literal('calendar-linked-preparation-1'), taskId: id, operationKey: z.string().uuid(),
  commandHash: hash, originalInputRef: z.string().uuid(), originalHash: hash, reissuedInputRef: z.string().uuid(), material: z.unknown() }).strict();

export function composeTaskCalendarDraftPreparation(d: Dependencies) {
  const db = d.original.db, clock = d.original.clock ?? (() => new Date());
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const owner = async (request: Request, taskId: string, signal?: AbortSignal) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer \S+$/u.test(header)) throw denied();
    const credentials = { current: async () => {
      if (signal?.aborted) throw denied(); return { authorization: header, audience: 'operator' as const, requestId: randomUUID() };
    } };
    const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(d.original.auth, credentials, clock), clock);
    const first = await scopes.resolveCurrent(), context = first.context;
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
      || !('access' in context) || !hasEffectivePermission(context.access.permissions, 'rental-os:calendar:edit')) throw denied();
    const access = aiTaskAccessFromContext(context, taskId, now());
    const task = await db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: first.scope.id }] } });
    if (!task || task.id !== taskId || task.scopeId !== first.scope.id || task.scopeKind !== 'WORKSPACE'
      || task.ownerKind !== 'USER' || task.ownerId !== context.actor.userId || task.audience !== 'OPERATOR'
      || task.archivedAt !== null || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.sceneCode !== 'opening_diagnosis'
      || !z.string().uuid().safeParse(task.inputRef).success || !hash.safeParse(task.inputHash).success) throw denied();
    const verify = async () => {
      if (signal?.aborted) throw denied(); const current = await scopes.resolveCurrent();
      if (current.scope.id !== first.scope.id || originalIdentityHash(current.context) !== originalIdentityHash(context)) throw denied();
      const row = await db.aiTask.findFirst({ where: { AND: [aiTaskAccessFromContext(current.context, taskId, now()).where, { scopeId: first.scope.id }] } });
      if (!row || row.inputRef !== task.inputRef || row.inputHash !== task.inputHash || row.ownerId !== task.ownerId
        || row.sceneCode !== task.sceneCode || row.sceneVersion !== task.sceneVersion || row.archivedAt !== null) throw denied();
    };
    return { context, task, credentials, verify, routes: new AiBusinessReadRouteAuthority(d.original.guard, credentials, clock) };
  };
  type Owner = Awaited<ReturnType<typeof owner>>;
  const operationId = (context: AiExecutionContext, reference: AiTaskCalendarDraftPreparationReference) => {
    const key = requestFingerprint({ kind: 'calendar-linked-preparation-1', scope: context.scope, actor: context.actor, reference });
    return `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20, 32)}`;
  };
  const bind = async (selected: Owner, date: string) => {
    const target = { year: Number(date.slice(0, 4)), date }, input = { ...d.original, credentials: selected.credentials };
    const requests = createCalendarOriginalRequests(input, target), original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: selected.task.inputRef! };
    const first = await requests.readHistorical(original), created = await requests.readTaskReceipt(original.inputRef);
    if (first.receipt.state === 'revoked' || first.receipt.contentHash !== selected.task.inputHash
      || first.receipt.sceneVersion !== selected.task.sceneVersion || created.state !== 'observed' || created.taskId !== selected.task.id) throw denied();
    let entry: z.infer<typeof calendarSourceEntryMarker> | undefined;
    if (first.receipt.requestKey.startsWith('calendar-entry:')) {
      const reference = { operationKey: z.string().uuid().parse(first.receipt.requestKey.slice('calendar-entry:'.length)) };
      const row = await db.operationLog.findUnique({ where: { id: calendarSourceEntryOperationId(selected.context, reference) } });
      if (!row || selected.context.scope.kind !== 'workspace' || selected.context.actor.kind !== 'user'
        || row.action !== 'ai-native.calendar.entry' || row.tenantId !== selected.context.scope.tenantId
        || row.workspaceId !== selected.context.scope.workspaceId || row.userId !== selected.context.actor.userId) throw denied();
      entry = calendarSourceEntryMarker.parse(row.detail);
      if (entry.inputRef !== original.inputRef || entry.operationKey !== reference.operationKey || entry.target.date !== date
        || entry.target.year !== target.year) throw denied();
    }
    const verify = async () => {
      await selected.verify(); const latest = await requests.readHistorical(original), receipt = await requests.readTaskReceipt(original.inputRef);
      if (latest.receipt.state === 'revoked' || latest.receipt.contentHash !== first.receipt.contentHash
        || originalIdentityHash(latest.context) !== originalIdentityHash(first.context) || receipt.state !== 'observed'
        || receipt.taskId !== created.taskId || receipt.runId !== created.runId) throw denied();
    };
    return { ...selected, input, requests, original: first, created, target, entry, verify,
      fields: new AiOpeningVersionFieldSource(db, selected.routes), differences: new AiOpeningSectionDifferenceService(
        new AiGuardedOpeningConfigurationSource(d.original.core, selected.routes), selected.routes, clock,
        new AiOpeningVersionFieldSource(db, selected.routes), true) };
  };
  type Bound = Awaited<ReturnType<typeof bind>>;
  const values = (fields: Record<string, unknown>) => aiTaskCalendarDraftPreparationValues.parse({ name: fields.name,
    ...(fields.businessStatus !== undefined ? { businessStatus: fields.businessStatus } : {}) });
  const envelope = (root: Bound) => ({ contractVersion: AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION, taskId: root.task.id,
    runId: root.created.runId, scope: root.context.scope, original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
      inputRef: root.original.receipt.inputRef, contentHash: root.original.receipt.contentHash, sceneVersion: root.original.receipt.sceneVersion }, observedAt: now().toISOString() });
  const targetRow = async (root: Bound, command: AiTaskCalendarDraftPreparationPreviewInput) => {
    if (root.entry && (root.entry.target.id !== command.targetId || root.entry.target.version !== command.version
      || root.entry.target.revision !== command.revision || root.entry.target.date !== command.date)) throw changed();
    const row = await root.routes.withCalendarSourceRead(root.target, async context => {
      assertAiReadContextBinding(context, root.context);
      if (context.scope.kind !== 'workspace') throw denied();
      return db.rentalBusinessCalendar.findFirst({ where: { id: command.targetId, tenantId: context.scope.tenantId,
        workspaceId: context.scope.workspaceId, year: root.target.year, version: command.version, status: 'draft' } });
    });
    if (!row || row.id !== command.targetId || row.year !== root.target.year || row.version !== command.version
      || row.status !== 'draft' || row.revision !== command.revision || !Array.isArray(row.days)) throw changed();
    const fields = await root.fields.read({ key: 'business_calendar', targetId: row.id, expectedVersion: row.version,
      expectedRevision: row.revision, date: command.date }, root.context);
    if (root.entry && root.entry.sourceHash !== requestFingerprint(fields.basis)) throw changed();
    return { row, fields };
  };
  const preview = async (root: Bound, command: AiTaskCalendarDraftPreparationPreviewInput, deadline?: string) => {
    const selected = await targetRow(root, command), publication = await db.aiTaskPlanPolicy.findFirst({ where: {
      scopeId: root.task.scopeId, sceneCode: 'opening_diagnosis', sceneVersion: root.task.sceneVersion } });
    const tools = aiPersistedPlanToolsSchema.safeParse(publication?.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(publication?.limits);
    if (!publication?.enabled || !tools.success || !limits.success || !tools.data.some(tool => tool.code === 'tenant.config.propose')
      || !(publication.expiresAt instanceof Date) || publication.expiresAt <= now()) throw unavailable();
    const expiresAt = deadline ?? new Date(Math.min(now().getTime() + 120000, publication.expiresAt.getTime())).toISOString();
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now().getTime()
      || Date.parse(expiresAt) > publication.expiresAt.getTime() || Date.parse(expiresAt) > now().getTime() + 120000) throw changed();
    const section = { key: 'business_calendar' as const, targetId: command.targetId, expectedVersion: command.version,
      expectedRevision: command.revision, date: command.date,
      changes: Object.entries(command.values).filter(([, value]) => value !== undefined).map(([field, value]) => ({ field, value })) };
    const material = await root.differences.prepare(section, root.context); await root.verify();
    const reviewHash = requestFingerprint({ kind: AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION, taskId: root.task.id,
      originalHash: root.original.receipt.contentHash, section, materialHash: material.materialHash,
      policy: { revision: publication.revision, tools: tools.data, limits: limits.data, expiresAt: publication.expiresAt.toISOString() }, expiresAt });
    return { selected, section, material, reviewHash, expiresAt };
  };
  const observe = async (request: Request, selected: Owner, reference: AiTaskCalendarDraftPreparationReference) => {
    const row = await db.operationLog.findUnique({ where: { id: operationId(selected.context, reference) } });
    const base = { contractVersion: AI_TASK_CALENDAR_DRAFT_PREPARATION_VERSION, reference, scope: selected.context.scope,
      observedAt: now().toISOString(), model: 'not_called' as const, businessDraft: 'not_created' as const,
      publication: 'not_attempted' as const, retryable: false as const };
    if (!row) { await selected.verify(); return aiTaskCalendarDraftPreparationOperationResponse.parse({ ...base, operation: { state: 'not_observed', retryable: false } }); }
    if (selected.context.scope.kind !== 'workspace' || selected.context.actor.kind !== 'user' || row.action !== 'ai-native.calendar.prepare'
      || row.tenantId !== selected.context.scope.tenantId || row.workspaceId !== selected.context.scope.workspaceId
      || row.userId !== selected.context.actor.userId) throw denied();
    const saved = marker.parse(row.detail), material = verifyOpeningSectionMaterial(saved.material);
    if (saved.taskId !== selected.task.id || saved.operationKey !== reference.operationKey || saved.originalInputRef !== selected.task.inputRef
      || saved.originalHash !== selected.task.inputHash || material.key !== 'business_calendar' || !material.date) throw denied();
    const root = await bind(selected, material.date), original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: saved.reissuedInputRef };
    const linked = await root.requests.readHistorical(original), task = await root.requests.readTaskReceipt(original.inputRef);
    if (linked.receipt.previousInputRef !== saved.originalInputRef || linked.receipt.requestKey !== `calendar-prep:${reference.operationKey}`
      || linked.receipt.state === 'revoked' || linked.request.sceneCode !== 'opening_diagnosis'
      || linked.request.input.sections.length !== 1 || linked.request.input.sections[0] !== 'business_calendar') throw denied();
    if (task.state === 'observed' && await db.aiTaskRunPlan.findFirst({ where: { scopeId: root.task.scopeId, taskId: task.taskId, runId: task.runId } })) {
      const items = await d.saved(request, task.taskId), proposal = items.items.find(item => item.reference.runId === task.runId
        && item.target.id === material.targetId && item.target.version === material.expectedVersion && item.target.date === material.date
        && requestFingerprint(item.changes) === requestFingerprint(material.changes));
      if (proposal) { await root.verify(); return aiTaskCalendarDraftPreparationOperationResponse.parse({ ...base,
        operation: { state: 'ai_proposal_saved', original, task: { state: 'observed', taskId: task.taskId, runId: task.runId }, proposal } }); }
    }
    await root.verify(); return aiTaskCalendarDraftPreparationOperationResponse.parse({ ...base, operation: {
      state: 'linked_request_recorded', original, task: task.state === 'observed' ? { state: 'observed', taskId: task.taskId, runId: task.runId }
        : { state: 'not_observed' }, proposal: 'not_observed', admission: 'unknown' } });
  };
  const call = async (request: Request, value: unknown, action: 'preparation' | 'previewPreparation' | 'prepare' | 'preparationOperation', signal?: AbortSignal) => {
    const schema = action === 'preparation' ? aiTaskCalendarDraftPreparationInput : action === 'previewPreparation'
      ? aiTaskCalendarDraftPreparationPreviewInput : action === 'prepare' ? aiTaskCalendarDraftPrepareInput : aiTaskCalendarDraftPreparationReference;
    const parsed = schema.safeParse(structuredClone(value)); if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), body = { headers: { authorization: request.headers.authorization } };
    return waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
      const selected = await owner(body, command.taskId, signal);
      if (action === 'preparationOperation') return observe(body, selected, aiTaskCalendarDraftPreparationReference.parse(command));
      const date = 'date' in command ? command.date : ''; const root = await bind(selected, date);
      if (action === 'preparation') {
        const rows = await root.routes.withCalendarSourceRead(root.target, async context => {
          assertAiReadContextBinding(context, root.context); if (context.scope.kind !== 'workspace') throw denied();
          return db.rentalBusinessCalendar.findMany({ where: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
            year: root.target.year, status: 'draft' }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 21 });
        });
        const targets = [];
        for (const row of rows.slice(0, 20)) {
          if (root.entry && (root.entry.target.id !== row.id || root.entry.target.version !== row.version
            || root.entry.target.revision !== row.revision)) continue;
          if (!Array.isArray(row.days) || row.days.filter(day => day && typeof day === 'object' && !Array.isArray(day) && day.date === date).length !== 1) continue;
          const fields = await root.fields.read({ key: 'business_calendar', targetId: row.id, expectedVersion: row.version, expectedRevision: row.revision, date }, root.context);
          if (root.entry && root.entry.sourceHash !== requestFingerprint(fields.basis)) throw changed();
          targets.push({ id: row.id, year: row.year, version: row.version, revision: row.revision, date, status: 'draft' as const,
            values: values(fields.fields), sourceHash: requestFingerprint(fields.basis) });
        }
        await root.verify(); return aiTaskCalendarDraftPreparationResponse.parse({ ...envelope(root), date, targets, hasMore: rows.length > 20,
          coverage: 'latest_20_draft_calendars_for_selected_date', preparation: 'new_linked_opening_request', businessDraft: 'not_created', publication: 'not_attempted' });
      }
      const previewInput = aiTaskCalendarDraftPreparationPreviewInput.parse({ taskId: command.taskId, date,
        targetId: 'targetId' in command ? command.targetId : undefined, version: 'version' in command ? command.version : undefined,
        revision: 'revision' in command ? command.revision : undefined, values: 'values' in command ? command.values : undefined });
      if (action === 'prepare') {
        const prepare = aiTaskCalendarDraftPrepareInput.parse(command), reference = { taskId: prepare.taskId, operationKey: prepare.operationKey };
        const existing = await db.operationLog.findUnique({ where: { id: operationId(root.context, reference) } });
        if (existing) { if (marker.parse(existing.detail).commandHash !== requestFingerprint(prepare)) throw changed(); return observe(body, selected, reference); }
      }
      const checked = await preview(root, previewInput, action === 'prepare' ? aiTaskCalendarDraftPrepareInput.parse(command).expiresAt : undefined);
      if (action === 'previewPreparation') return aiTaskCalendarDraftPreparationPreviewResponse.parse({ ...envelope(root),
        target: { id: checked.selected.row.id, year: checked.selected.row.year, version: checked.selected.row.version,
          revision: checked.selected.row.revision, date, status: 'draft' }, values: previewInput.values,
        before: values(checked.selected.fields.fields), changes: checked.material.changes, status: checked.material.status,
        materialHash: checked.material.materialHash, reviewHash: checked.reviewHash, expiresAt: checked.expiresAt,
        preparation: 'ai_proposal_only', businessDraft: 'not_created', publication: 'not_attempted' });
      const prepare = aiTaskCalendarDraftPrepareInput.parse(command), reference = { taskId: prepare.taskId, operationKey: prepare.operationKey };
      if (checked.material.status !== 'difference_ready' || checked.reviewHash !== prepare.reviewHash) throw changed();
      if (root.context.scope.kind !== 'workspace' || root.context.actor.kind !== 'user') throw denied();
      const tenantId = root.context.scope.tenantId, workspaceId = root.context.scope.workspaceId, userId = root.context.actor.userId;
      let entered = false;
      try {
        entered = true;
        const receipt = await root.requests.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: `calendar-prep:${reference.operationKey}`,
          previousInputRef: root.task.inputRef!, sceneCode: 'opening_diagnosis', input: { sections: ['business_calendar'] } }, true,
          async (tx, receipt) => { await tx.operationLog.create({ data: { id: operationId(root.context, reference), action: 'ai-native.calendar.prepare',
            tenantId, workspaceId, userId, detail: { kind: 'calendar-linked-preparation-1', taskId: root.task.id, operationKey: reference.operationKey,
              commandHash: requestFingerprint(prepare), originalInputRef: root.task.inputRef!, originalHash: root.original.receipt.contentHash,
              reissuedInputRef: receipt.inputRef, material: JSON.parse(JSON.stringify(checked.material)) } } }); });
        const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: receipt.inputRef };
        await root.verify(); await root.requests.createTask(original);
        await createOriginalTaskStartAdmission(d.original, 'opening_diagnosis')(body, original,
          { kind: 'business_calendar', targetId: prepare.targetId, version: prepare.version, year: root.target.year, date, revision: prepare.revision }, signal);
        const requests = createCalendarOriginalRequests(root.input, root.target, prepare.expiresAt);
        await composeOpeningProposalWorkflow(root.input, d.host, undefined, { requests }).start({ original, section: checked.section }, signal, checked.material.materialHash);
        return await observe(body, selected, reference);
      } catch (error) { if (entered) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); throw error; }
    }), action === 'prepare', signal);
  };
  return Object.freeze({ preparation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'preparation', signal),
    previewPreparation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'previewPreparation', signal),
    prepare: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'prepare', signal),
    preparationOperation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'preparationOperation', signal) });
}
