/** Current owned Task/Step -> original saved rule proposal -> human Core draft.
 * Locates immutable registration/proposal references on the server. Reads do
 * not prepare/execute; save never publishes. Original operation evidence supplies
 * its own reason/hash for recovery, so a client retains only Task/Step ids. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { AI_TASK_RULE_DRAFT_VERSION, AI_TASK_RULE_DRAFT_HTTP, AI_SCENE_REQUEST_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION,
  aiTaskRuleDraftListInput, aiTaskRuleDraftReference, aiTaskRuleDraftReviewInput, aiTaskRuleDraftSaveInput,
  aiTaskRuleDraftListResponse, aiTaskRuleDraftReviewResponse, aiTaskRuleDraftOperationResponse,
  type AiTaskRuleDraftReference, type AiProposalPayloadDraft } from '@rental-os/shared';
import { composePersistedTaskAuthorization } from './task-authorization.composition';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { aiStepActionId } from './ai-step-registration.repository';
import { fingerprintAiProposalDraft } from './proposal-binding-draft';
import { verifyOpeningSectionMaterial } from './tools/opening-section-difference.service';
import { composeRequestBoundOpeningRuleDraftSave } from './scenes/request-bound-scenes.application';
import type { AiTaskApplicationHost } from './runner/prisma-task-application';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';
import { AiTaskRuleDraftListDto, AiTaskRuleDraftReferenceDto, AiTaskRuleDraftReviewDto, AiTaskRuleDraftSaveDto } from './task-rule-draft.dto';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { assertAiReadContextBinding } from './tools/read-context-binding';

export const AI_TASK_RULE_DRAFT_REQUESTS = Symbol('AI_TASK_RULE_DRAFT_REQUESTS');
export type TaskRuleDraftDependencies = { original: Parameters<typeof composeRequestBoundOpeningRuleDraftSave>[0];
  host: AiTaskApplicationHost; saveEnabled: boolean };
type Request = { headers: { authorization?: unknown } };
const canonical = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> => {
  const result = schema.safeParse(structuredClone(value)); if (!result.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return freezeOriginalInput(result.data);
};

export function composeRequestBoundTaskRuleDraft(d: TaskRuleDraftDependencies) {
  const { db } = d.original, clock = d.original.clock ?? (() => new Date());
  const rules = composeRequestBoundOpeningRuleDraftSave(d.original, { enabled: true, audience: 'operator', host: d.host });
  const source = async (request: Request, taskId: string) => {
    const header = z.string().regex(/^Bearer \S+$/u).max(8192).safeParse(request.headers.authorization);
    if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const credential = Object.freeze({ authorization: header.data, audience: 'operator' as const, requestId: randomUUID() });
    const authorization = composePersistedTaskAuthorization({ ...d.original, credentials: { current: async () => credential } });
    const context = await authorization.authority.resolve(taskId, 'read_metadata');
    const access = await authorization.tasks.resolveAccess(taskId, 'read_metadata');
    if (context.actor.kind !== 'user' || context.audience !== 'operator' || context.scope.kind !== 'workspace'
      || aiTaskAccessFromContext(context, taskId, clock()).bindingKey !== access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const task = await db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== taskId || task.ownerKind !== 'USER' || task.ownerId !== context.actor.userId
      || task.sceneCode !== 'opening_diagnosis' || task.archivedAt !== null || !task.inputRef) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const verify = async () => {
      const current = await authorization.tasks.resolveAccess(taskId, 'read_metadata');
      const latest = await db.aiTask.findFirst({ where: current.where });
      if (current.bindingKey !== access.bindingKey || !latest || latest.id !== task.id || latest.inputRef !== task.inputRef
        || latest.inputHash !== task.inputHash || latest.sceneCode !== task.sceneCode || latest.sceneVersion !== task.sceneVersion
        || latest.ownerId !== task.ownerId || latest.archivedAt !== null) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    await verify();
    return { context, access, task, verify, ruleRoutes: new AiBusinessReadRouteAuthority(d.original.guard, { current: async () => credential }, clock),
      original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef } };
  };
  const locate = async (bound: Awaited<ReturnType<typeof source>>, reference: AiTaskRuleDraftReference) => {
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
    if (material.key !== 'business_rule' || material.status !== 'difference_ready' || material.scope.tenantId !== bound.access.scope.tenantId
      || material.scope.workspaceId !== bound.access.scope.workspaceId || material.materialHash !== input.fingerprint
      || input.registrationRef !== `opening-section:${material.key}:${material.materialHash}`
      || step.actionId !== aiStepActionId(bound.access.scope, bound.task.id, input.registrationRef)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
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
    await bound.ruleRoutes.withRead('rule_version', { version: material.expectedVersion }, async context => { assertAiReadContextBinding(context, bound.context); });
    await bound.verify();
    const command = { original: bound.original, registrationRef: input.registrationRef };
    const bindingHash = requestFingerprint({ ...command, materialHash: material.materialHash, payloadHash: version.payloadHash });
    const actor = { tenantId: material.scope.tenantId, workspaceId: material.scope.workspaceId, actorId: bound.task.ownerId };
    const digest = requestFingerprint({ kind: 'rule-bound-draft-1', scope: actor, operationKey: `rule-draft-${bindingHash}` });
    const operationId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    return { command, material, operationId, actor, snapshot: requestFingerprint(canonical({ input, version })) };
  };
  const projectOperation = (value: Awaited<ReturnType<typeof rules.readDraftOperation>>['operation']) => value.state === 'not_observed'
    ? { state: 'not_observed' as const, retryable: false as const } : { state: 'committed' as const, receiptId: value.receiptId,
      source: { id: value.source.id, version: value.source.version }, draft: { id: value.draft.id, version: value.draft.version, mode: value.draft.mode },
      changes: value.changes, normalizations: value.normalizations, committedAt: value.committedAt, publication: value.publication };
  const call = async (request: Request, value: unknown, action: 'list' | 'review' | 'save' | 'operation', signal?: AbortSignal) => {
    const command = action === 'list' ? parse(aiTaskRuleDraftListInput, value) : action === 'review' ? parse(aiTaskRuleDraftReviewInput, value)
      : action === 'save' ? parse(aiTaskRuleDraftSaveInput, value) : parse(aiTaskRuleDraftReference, value);
    const body = freezeOriginalInput({ headers: { authorization: request.headers.authorization } });
    return waitForTaskApplicationDependency(async () => {
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const bound = await source(body, command.taskId);
      const at = clock(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const envelope = { contractVersion: AI_TASK_RULE_DRAFT_VERSION, taskId: command.taskId, observedAt: at.toISOString() };
      if (action === 'list') {
        const steps = await db.aiStep.findMany({ where: { scopeId: bound.task.scopeId, taskId: bound.task.id,
          toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION }, orderBy: [{ runId: 'asc' }, { sequence: 'asc' }], take: 21 });
        if (steps.length > 20) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const items = [];
        for (const step of steps) {
          if (!step.inputRef) continue;
          const input = await db.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: bound.task.scopeId, taskId: bound.task.id, runId: step.runId } });
          if (!input) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          if (verifyOpeningSectionMaterial(input.payload).key !== 'business_rule') continue;
          const reference = { taskId: command.taskId, runId: step.runId, stepId: step.id }, found = await locate(bound, reference);
          items.push({ reference, target: { id: found.material.targetId, version: found.material.expectedVersion },
            changes: found.material.changes, source: 'original_saved_ai_proposal' as const });
        }
        await bound.verify(); return aiTaskRuleDraftListResponse.parse({ ...envelope, saveEnabled: d.saveEnabled, items });
      }
      const reference = parse(aiTaskRuleDraftReference, { taskId: command.taskId, runId: 'runId' in command ? command.runId : undefined,
        stepId: 'stepId' in command ? command.stepId : undefined }), found = await locate(bound, reference);
      if (action === 'review') {
        const input = parse(aiTaskRuleDraftReviewInput, command);
        const result = await rules.reviewDraft(body, { ...found.command, changeReason: input.changeReason }, signal);
        await bound.verify();
        if ((await locate(bound, reference)).snapshot !== found.snapshot) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return aiTaskRuleDraftReviewResponse.parse({ ...envelope, reference, target: { id: found.material.targetId, version: found.material.expectedVersion },
          reviewHash: result.review.reviewHash, changeReason: input.changeReason, changes: result.review.preview.changes,
          normalizations: result.review.normalizations, resultVersion: result.review.resultVersion, mode: result.review.mode, publication: 'not_attempted' });
      }
      if (action === 'save') {
        if (!d.saveEnabled) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const input = parse(aiTaskRuleDraftSaveInput, command);
        const result = await rules.saveDraft(body, { ...found.command, changeReason: input.changeReason, reviewHash: input.reviewHash,
          decision: input.decision }, signal);
        try { await bound.verify(); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
        return aiTaskRuleDraftOperationResponse.parse({ ...envelope, reference, operation: projectOperation(result.operation) });
      }
      const row = await db.operationLog.findUnique({ where: { id: found.operationId } });
      if (!row) { await bound.verify(); return aiTaskRuleDraftOperationResponse.parse({ ...envelope, reference, operation: { state: 'not_observed', retryable: false } }); }
      if (row.tenantId !== found.actor.tenantId || row.workspaceId !== found.actor.workspaceId || row.userId !== found.actor.actorId
        || row.action !== 'rule.draft.bound.save') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const saved = z.object({ kind: z.literal('rule-bound-draft-1'), reviewHash: z.string().regex(/^[a-f0-9]{64}$/u),
        changeReason: z.string().min(1).max(500) }).passthrough().parse(row.detail);
      // The original domain verifies the COMPLETE operation proof and target.
      // These buffered fields only recover its own original read command.
      const result = await rules.readDraftOperation(body, { ...found.command, changeReason: saved.changeReason, reviewHash: saved.reviewHash }, signal);
      await bound.verify(); return aiTaskRuleDraftOperationResponse.parse({ ...envelope, reference, operation: projectOperation(result.operation) });
    }, action === 'save', signal);
  };
  return Object.freeze({ list: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'list', signal),
    review: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'review', signal),
    save: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'save', signal),
    operation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'operation', signal) });
}

@Controller(AI_TASK_RULE_DRAFT_HTTP.basePath)
export class AiTaskRuleDraftController {
  constructor(@Inject(AI_TASK_RULE_DRAFT_REQUESTS) private readonly requests: ReturnType<typeof composeRequestBoundTaskRuleDraft>) {}
  private respond(request: IncomingMessage, value: unknown, action: 'list' | 'review' | 'save' | 'operation') {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests[action](request, value, signal)), 'read_original_rule_draft_operation');
  }
  @Post(AI_TASK_RULE_DRAFT_HTTP.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: IncomingMessage, @Body() body: AiTaskRuleDraftListDto) { return this.respond(request, body, 'list'); }
  @Post(AI_TASK_RULE_DRAFT_HTTP.review) @HttpCode(200) @Header('Cache-Control', 'no-store')
  review(@Req() request: IncomingMessage, @Body() body: AiTaskRuleDraftReviewDto) { return this.respond(request, body, 'review'); }
  @Post(AI_TASK_RULE_DRAFT_HTTP.save) @HttpCode(200) @Header('Cache-Control', 'no-store')
  save(@Req() request: IncomingMessage, @Body() body: AiTaskRuleDraftSaveDto) { return this.respond(request, body, 'save'); }
  @Post(AI_TASK_RULE_DRAFT_HTTP.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: IncomingMessage, @Body() body: AiTaskRuleDraftReferenceDto) { return this.respond(request, body, 'operation'); }
}
