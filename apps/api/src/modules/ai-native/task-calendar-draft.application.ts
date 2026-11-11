/** Current owned Task/Step -> original saved calendar proposal -> human Core draft.
 * Locates immutable registration/proposal references on the server. Reads do
 * not prepare/execute; save never publishes. Original operation evidence supplies
 * its own reason/hash for recovery, so a client retains only Task/Step ids. */
import { hasEffectivePermission } from '../../common/permission-match';
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AI_TASK_CALENDAR_DRAFT_VERSION, AI_TASK_CALENDAR_DRAFT_HTTP, AI_SCENE_REQUEST_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION,
  aiTaskCalendarDraftListInput, aiTaskCalendarDraftReference, aiTaskCalendarDraftReviewInput, aiTaskCalendarDraftSaveInput,
  aiTaskCalendarDraftListResponse, aiTaskCalendarDraftReviewResponse, aiTaskCalendarDraftOperationResponse,
  AI_TASK_DRAFT_VERSION, AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS,
  type AiTaskCalendarDraftReference, type AiProposalPayloadDraft } from '@rental-os/shared';
import { AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP } from '@rental-os/shared';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { originalIdentityHash } from './task-request/original-request.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { aiStepActionId } from './ai-step-registration.repository';
import { fingerprintAiProposalDraft } from './proposal-binding-draft';
import { verifyOpeningSectionMaterial } from './tools/opening-section-difference.service';
import { composeRequestBoundOpeningCalendarDraftSave } from './scenes/request-bound-scenes.application';
import type { AiTaskApplicationHost } from './runner/prisma-task-application';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';
import { AiTaskCalendarDraftListDto, AiTaskCalendarDraftReferenceDto, AiTaskCalendarDraftReviewDto, AiTaskCalendarDraftSaveDto } from './task-calendar-draft.dto';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { composeTaskCalendarDraftPreparation } from './task-calendar-draft-preparation.composition';
import { composeTaskCalendarSourceEntry } from './task-calendar-source-entry.composition';
import { createCalendarOriginalReadRequests } from './task-calendar-original-source.composition';
import { composeOpeningCalendarDraftSave } from './scenes/opening-calendar-draft.composition';
import { AiOpeningSectionProposalService } from './tools/opening-section-proposal.service';
import { AiOpeningSectionDifferenceService } from './tools/opening-section-difference.service';
import { AiGuardedOpeningConfigurationSource } from './tools/opening-configuration.source';
import { AiOpeningVersionFieldSource } from './tools/opening-version-fields.source';
import { AiTaskCalendarDraftPreparationDto, AiTaskCalendarDraftPreparationPreviewDto, AiTaskCalendarDraftPrepareDto,
  AiTaskCalendarDraftPreparationReferenceDto, AiTaskCalendarDraftSourceDto, AiTaskCalendarDraftEntryDto,
  AiTaskCalendarDraftEntryReferenceDto } from './task-calendar-draft.dto';

export const AI_TASK_CALENDAR_DRAFT_REQUESTS = Symbol('AI_TASK_CALENDAR_DRAFT_REQUESTS');
export type TaskCalendarDraftDependencies = { original: Parameters<typeof composeRequestBoundOpeningCalendarDraftSave>[0];
  host: AiTaskApplicationHost; saveEnabled: boolean };
type Request = { headers: { authorization?: unknown } };
const canonical = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => {
  const result = schema.safeParse(structuredClone(value)); if (!result.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(result.data);
};

export function composeRequestBoundTaskCalendarDraft(d: TaskCalendarDraftDependencies) {
  const { db } = d.original, clock = d.original.clock ?? (() => new Date());
  const calendars = composeRequestBoundOpeningCalendarDraftSave(d.original, { enabled: true, audience: 'operator', host: d.host });
  const source = async (request: Request, taskId: string, signal?: AbortSignal) => {
    const header = z.string().regex(/^Bearer \S+$/u).max(8192).safeParse(request.headers.authorization);
    if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const credential = Object.freeze({ authorization: header.data, audience: 'operator' as const, requestId: randomUUID() });
    const credentials = { current: async () => {
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); return credential;
    } };
    // Human calendar reads have their own current business permission. An
    // expired R1 execution admission does not revoke original Core receipts.
    const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(d.original.auth, credentials, clock), clock);
    const first = await scopes.resolveCurrent(), context = first.context;
    if (context.actor.kind !== 'user' || context.audience !== 'operator' || context.scope.kind !== 'workspace' || !('access' in context)
      || !AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS.some(permission => 'access' in context && hasEffectivePermission(context.access.permissions, permission)))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const access = aiTaskAccessFromContext(context, taskId, clock());
    const task = await db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: first.scope.id }] } });
    if (!task || task.id !== taskId || task.scopeId !== first.scope.id || task.scopeKind !== 'WORKSPACE'
      || task.ownerKind !== 'USER' || task.ownerId !== context.actor.userId || task.audience !== 'OPERATOR'
      || task.sceneCode !== 'opening_diagnosis' || task.contractVersion !== AI_TASK_DRAFT_VERSION
      || task.archivedAt !== null || !task.inputRef || !task.inputHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const verify = async () => {
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const current = await scopes.resolveCurrent(), currentAccess = aiTaskAccessFromContext(current.context, taskId, clock());
      const latest = await db.aiTask.findFirst({ where: { AND: [currentAccess.where, { scopeId: first.scope.id }] } });
      if (current.scope.id !== first.scope.id || originalIdentityHash(current.context) !== originalIdentityHash(context)
        || currentAccess.bindingKey !== access.bindingKey || !latest || latest.id !== task.id || latest.inputRef !== task.inputRef
        || latest.inputHash !== task.inputHash || latest.sceneCode !== task.sceneCode || latest.sceneVersion !== task.sceneVersion
        || latest.ownerId !== task.ownerId || latest.archivedAt !== null) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    await verify();
    return { context, access, task, verify, credentials, calendarRoutes: new AiBusinessReadRouteAuthority(d.original.guard, credentials, clock),
      original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef } };
  };
  const locate = async (bound: Awaited<ReturnType<typeof source>>, reference: AiTaskCalendarDraftReference) => {
    const where = { scopeId: bound.task.scopeId, taskId: bound.task.id, runId: reference.runId };
    const run = await db.aiRun.findFirst({ where: { id: reference.runId, scopeId: where.scopeId, taskId: where.taskId } });
    const step = await db.aiStep.findFirst({ where: { ...where, id: reference.stepId, toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION } });
    const input = step?.inputRef ? await db.aiTaskActionInput.findFirst({ where: { ...where, id: step.inputRef } }) : null;
    if (!run || run.id !== reference.runId || run.scopeId !== where.scopeId || run.taskId !== where.taskId
      || run.actorKind !== 'USER' || run.actorId !== bound.task.ownerId || !step || step.id !== reference.stepId
      || step.scopeId !== where.scopeId || step.taskId !== where.taskId || !input || input.id !== step.inputRef
      || input.scopeId !== where.scopeId || input.taskId !== where.taskId || input.runId !== where.runId
      || step.runId !== run.id || step.requestFingerprint !== input.fingerprint || input.toolCode !== step.toolCode || input.toolVersion !== step.toolVersion)
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const material = verifyOpeningSectionMaterial(input.payload);
    if (material.key !== 'business_calendar' || material.date === undefined || material.baseRevision === undefined || material.status !== 'difference_ready' || material.scope.tenantId !== bound.access.scope.tenantId
      || material.scope.workspaceId !== bound.access.scope.workspaceId || material.materialHash !== input.fingerprint
      || input.registrationRef !== `opening-section:${material.key}:${material.materialHash}`
      || step.actionId !== aiStepActionId(bound.access.scope, bound.task.id, input.registrationRef)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const originals = createCalendarOriginalReadRequests({ ...d.original, credentials: bound.credentials }, {
      year: Number(material.date.slice(0, 4)), date: material.date, version: material.expectedVersion });
    const original = await originals.readHistorical(bound.original), creation = await originals.readTaskReceipt(bound.original.inputRef);
    if (original.receipt.state === 'revoked' || original.receipt.contentHash !== bound.task.inputHash
      || original.receipt.sceneVersion !== bound.task.sceneVersion || creation.state !== 'observed'
      || creation.taskId !== bound.task.id || creation.runId !== run.id) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const proposalId = `oc-${material.materialHash.slice(0, 32)}`;
    const version = await db.aiProposalVersion.findFirst({ where: { scopeId: where.scopeId, taskId: where.taskId, proposalId, revision: 1 } });
    if (!version) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    // The original fingerprint validator checks the full closed proposal before
    // any payload property is consumed; the cast follows that validation.
    const payloadHash = fingerprintAiProposalDraft(version.payload);
    const payload = version.payload as unknown as AiProposalPayloadDraft, action = payload.actions[0];
    if (payload.taskId !== bound.task.id || payload.proposalId !== proposalId || payload.revision !== 1 || payload.actions.length !== 1
      || payload.audience !== bound.context.audience || requestFingerprint(payload.scope) !== requestFingerprint(bound.context.scope)
      || version.payloadHash !== payloadHash || action.actionId !== step.actionId || action.toolCode !== step.toolCode
      || action.input.recordId !== input.id || action.input.contentHash !== material.materialHash
      || action.target.resourceId !== material.targetId || action.target.version !== material.expectedVersion) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const currentDay = await bound.calendarRoutes.withRead('calendar_version', { year: Number(material.date.slice(0, 4)), version: material.expectedVersion }, async context => {
      assertAiReadContextBinding(context, bound.context);
      const row = await db.rentalBusinessCalendar.findFirst({ where: { id: material.targetId, tenantId: material.scope.tenantId,
        workspaceId: material.scope.workspaceId, year: Number(material.date!.slice(0, 4)), version: material.expectedVersion } });
      if (!row || !Array.isArray(row.days)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const days = row.days.filter(day => day && typeof day === 'object' && !Array.isArray(day) && day.date === material.date);
      if (days.length !== 1) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return days[0] as { source?: string };
    });
    await bound.verify();
    const command = { original: bound.original, registrationRef: input.registrationRef };
    const bindingHash = requestFingerprint({ ...command, materialHash: material.materialHash, payloadHash: version.payloadHash });
    const actor = { tenantId: material.scope.tenantId, workspaceId: material.scope.workspaceId, actorId: bound.task.ownerId };
    const digest = requestFingerprint({ kind: 'calendar-bound-draft-1', scope: actor, operationKey: `calendar-draft-${bindingHash}` });
    const operationId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    return { command, material, operationId, actor, overrideRequired: currentDay.source === 'tenant_override', target: { id: material.targetId, version: material.expectedVersion, year: Number(material.date.slice(0, 4)), date: material.date, baseRevision: material.baseRevision }, snapshot: requestFingerprint(canonical({ input, version })) };
  };
  const projectOperation = (value: Awaited<ReturnType<typeof calendars.readDraftOperation>>['operation'], reason: string) => value.state === 'not_observed'
    ? { state: 'not_observed' as const, retryable: false as const } : { state: 'committed' as const, receiptId: value.receiptId,
      target: { id: value.targetId, year: value.year, version: value.version, baseRevision: value.baseRevision, date: value.date },
      resultRevision: value.resultRevision, before: value.before, after: value.after, overrideReason: reason,
      committedAt: value.committedAt, businessDraft: value.businessDraft, publication: value.publication };
  const call = async (request: Request, value: unknown, action: 'list' | 'review' | 'save' | 'operation', signal?: AbortSignal) => {
    const command = action === 'list' ? parse(aiTaskCalendarDraftListInput, value) : action === 'review' ? parse(aiTaskCalendarDraftReviewInput, value)
      : action === 'save' ? parse(aiTaskCalendarDraftSaveInput, value) : parse(aiTaskCalendarDraftReference, value);
    const body = freezeOriginalInput({ headers: { authorization: request.headers.authorization } });
    return waitForTaskApplicationDependency(async () => {
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const bound = await source(body, command.taskId, signal);
      const at = clock(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const envelope = { contractVersion: AI_TASK_CALENDAR_DRAFT_VERSION, taskId: command.taskId, observedAt: at.toISOString() };
      if (action === 'list') {
        const steps = await db.aiStep.findMany({ where: { scopeId: bound.task.scopeId, taskId: bound.task.id,
          toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION }, orderBy: [{ runId: 'asc' }, { sequence: 'asc' }], take: 21 });
        if (steps.length > 20) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const items = [];
        for (const step of steps) {
          if (!step.inputRef) continue;
          const input = await db.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: bound.task.scopeId, taskId: bound.task.id, runId: step.runId } });
          if (!input) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          if (verifyOpeningSectionMaterial(input.payload).key !== 'business_calendar') continue;
          const reference = { taskId: command.taskId, runId: step.runId, stepId: step.id }, found = await locate(bound, reference);
          items.push({ reference, target: found.target, overrideRequired: found.overrideRequired,
            changes: found.material.changes, source: 'original_saved_ai_proposal' as const });
        }
        await bound.verify(); return aiTaskCalendarDraftListResponse.parse({ ...envelope, saveEnabled: d.saveEnabled, items });
      }
      const reference = parse(aiTaskCalendarDraftReference, { taskId: command.taskId, runId: 'runId' in command ? command.runId : undefined,
        stepId: 'stepId' in command ? command.stepId : undefined }), found = await locate(bound, reference);
      const input = { ...d.original, credentials: bound.credentials };
      const differences = new AiOpeningSectionDifferenceService(new AiGuardedOpeningConfigurationSource(input.core, bound.calendarRoutes),
        bound.calendarRoutes, clock, new AiOpeningVersionFieldSource(db, bound.calendarRoutes), true);
      const proposals = new AiOpeningSectionProposalService({ ...input, holderId: d.host.holderId,
        scene: { code: bound.task.sceneCode, version: bound.task.sceneVersion } }, differences, true, { current: async taskId => {
          if (taskId !== bound.task.id) throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); await bound.verify(); return bound.context;
        } });
      const calendar = composeOpeningCalendarDraftSave(input, d.host, { read: async value => {
        if (value.original.inputRef !== found.command.original.inputRef || value.registrationRef !== found.command.registrationRef)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        await bound.verify();
        const receipt = await proposals.readReceipt({ taskId: bound.task.id, runId: reference.runId, registrationRef: value.registrationRef });
        const context = await bound.calendarRoutes.withRead('calendar_version', { year: found.target.year, version: found.target.version }, async context => context);
        assertAiReadContextBinding(context, bound.context); return { context, receipt };
      } });
      if (action === 'review') {
        const input = parse(aiTaskCalendarDraftReviewInput, command);
        const result = await calendar.reviewDraft({ ...found.command, overrideReason: input.overrideReason, overrideConfirmed: input.overrideConfirmed });
        await bound.verify();
        if ((await locate(bound, reference)).snapshot !== found.snapshot) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return aiTaskCalendarDraftReviewResponse.parse({ ...envelope, reference, target: found.target,
          reviewHash: result.review.reviewHash, overrideReason: input.overrideReason, overrideConfirmed: input.overrideConfirmed,
          overrideRequired: result.review.overrideRequired, existingOverrideReason: result.review.existingOverrideReason, before: result.review.before, after: result.review.after,
          persistence: result.review.persistence, publication: result.review.publication });
      }
      if (action === 'save') {
        if (!d.saveEnabled) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const input = parse(aiTaskCalendarDraftSaveInput, command);
        const result = await calendar.saveDraft({ ...found.command, overrideReason: input.overrideReason, overrideConfirmed: input.overrideConfirmed, reviewHash: input.reviewHash,
          decision: input.decision });
        try { await bound.verify(); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
        return aiTaskCalendarDraftOperationResponse.parse({ ...envelope, reference, operation: projectOperation(result.operation, input.overrideReason) });
      }
      const row = await db.rentalCalendarOverrideAuditEntry.findUnique({ where: { id: found.operationId } });
      if (!row) { await bound.verify(); return aiTaskCalendarDraftOperationResponse.parse({ ...envelope, reference, operation: { state: 'not_observed', retryable: false } }); }
      if (row.tenantId !== found.actor.tenantId || row.workspaceId !== found.actor.workspaceId || row.operator !== found.actor.actorId
        || row.action !== 'override') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const saved = z.object({ after: z.object({ __rentalBoundDraftOperation: z.object({ kind: z.literal('calendar-bound-draft-1'),
        reviewHash: z.string().regex(/^[a-f0-9]{64}$/u), overrideConfirmed: z.boolean() }).passthrough() }).passthrough(),
        reason: z.string().min(1).max(1000) }).passthrough().parse(row);
      // These fields restore the original read command. The original Core
      // validates the complete receipt proof, identity, target and command hash.
      const result = await calendar.readDraftOperation({ ...found.command, overrideReason: saved.reason,
        reviewHash: saved.after.__rentalBoundDraftOperation.reviewHash, overrideConfirmed: saved.after.__rentalBoundDraftOperation.overrideConfirmed });
      await bound.verify(); return aiTaskCalendarDraftOperationResponse.parse({ ...envelope, reference, operation: projectOperation(result.operation, saved.reason) });

    }, action === 'save', signal);
  };
  const preparation = composeTaskCalendarDraftPreparation({ ...d, saved: (request, taskId, signal) => call(request, { taskId }, 'list', signal) as Promise<import('@rental-os/shared').AiTaskCalendarDraftListResponse> });
  const entry = composeTaskCalendarSourceEntry(d);
  return Object.freeze({ ...preparation, ...entry, list: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'list', signal),
    review: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'review', signal),
    save: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'save', signal),
    operation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'operation', signal) });
}

@Controller(AI_TASK_CALENDAR_DRAFT_HTTP.basePath)
export class AiTaskCalendarDraftController {
  constructor(@Inject(AI_TASK_CALENDAR_DRAFT_REQUESTS) private readonly requests: ReturnType<typeof composeRequestBoundTaskCalendarDraft>) {}
  private respond(request: IncomingMessage & { body?: unknown }, value: unknown, action: 'list' | 'review' | 'save' | 'operation'
    | 'preparation' | 'previewPreparation' | 'prepare' | 'preparationOperation' | 'source' | 'entry' | 'entryOperation') {
    // The global DTO whitelist transforms arguments, not the original wire
    // body. Closed contracts must reject extra fields before they disappear.
    const original = Object.hasOwn(request, 'body') ? request.body : value;
    return respondAiScene(() => withRequestAbort(request, async signal => this.requests[action](request, original, signal)), 'read_original_calendar_draft_operation');
  }
  @Post(AI_TASK_CALENDAR_DRAFT_HTTP.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftListDto) { return this.respond(request, body, 'list'); }
  @Post(AI_TASK_CALENDAR_DRAFT_HTTP.review) @HttpCode(200) @Header('Cache-Control', 'no-store')
  review(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftReviewDto) { return this.respond(request, body, 'review'); }
  @Post(AI_TASK_CALENDAR_DRAFT_HTTP.save) @HttpCode(200) @Header('Cache-Control', 'no-store')
  save(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftSaveDto) { return this.respond(request, body, 'save'); }
  @Post(AI_TASK_CALENDAR_DRAFT_HTTP.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftReferenceDto) { return this.respond(request, body, 'operation'); }
  @Post(AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.preparation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  preparation(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftPreparationDto) { return this.respond(request, body, 'preparation'); }
  @Post(AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.previewPreparation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  previewPreparation(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftPreparationPreviewDto) { return this.respond(request, body, 'previewPreparation'); }
  @Post(AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.prepare) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftPrepareDto) { return this.respond(request, body, 'prepare'); }
  @Post(AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.preparationOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  preparationOperation(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftPreparationReferenceDto) { return this.respond(request, body, 'preparationOperation'); }
  @Post(AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.source) @HttpCode(200) @Header('Cache-Control', 'no-store')
  source(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftSourceDto) { return this.respond(request, body, 'source'); }
  @Post(AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.entry) @HttpCode(200) @Header('Cache-Control', 'no-store')
  entry(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftEntryDto) { return this.respond(request, body, 'entry'); }
  @Post(AI_TASK_CALENDAR_DRAFT_PREPARATION_HTTP.entryOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  entryOperation(@Req() request: IncomingMessage, @Body() body: AiTaskCalendarDraftEntryReferenceDto) { return this.respond(request, body, 'entryOperation'); }
}
