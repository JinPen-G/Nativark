/** User-started linked opening request -> original R1 rule proposal. Stores its
 * locator with the original reissue in one transaction. Observing an operation
 * never recreates a task, refreshes a plan or replays an uncertain R1 write. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { AI_TASK_RULE_DRAFT_FIELDS, AI_TASK_RULE_DRAFT_PREPARATION_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION,
  aiTaskRuleDraftPreparationInput, aiTaskRuleDraftPreparationResponse, aiTaskRuleDraftPreparationPreviewInput,
  aiTaskRuleDraftPreparationPreviewResponse, aiTaskRuleDraftPrepareInput, aiTaskRuleDraftPreparationReference,
  aiTaskRuleDraftPreparationOperationResponse, type AiExecutionContext, type AiTaskRuleDraftListResponse,
  type AiSceneRequestReadDraft, type AiTaskRuleDraftPreparationReference, type AiTaskRuleDraftReference,
  type AiTaskDraftRejectedOperation } from '@rental-os/shared';
import type { TaskRuleDraftDependencies } from './task-rule-draft.application';
import type { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { composeAiOriginalScenes } from './scenes/original-scenes.composition';
import { composeOpeningProposalWorkflow } from './scenes/opening-proposal-workflow.composition';
import { AiOpeningSectionDifferenceService, verifyOpeningSectionMaterial } from './tools/opening-section-difference.service';
import { AiGuardedOpeningConfigurationSource } from './tools/opening-configuration.source';
import { AiOpeningVersionFieldSource } from './tools/opening-version-fields.source';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { originalIdentityHash } from './task-request/original-request.authority';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { AiTaskRepositoryError } from './ai-task.repository';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { runWithRequestIdentity } from '../../common/request-identity';
import { createRuleOriginalRequests, createRuleOriginalReadRequests } from './task-rule-original-source.composition';
import { ruleSourceEntryMarker, ruleSourceEntryOperationId } from './task-rule-source-entry.composition';

type Request = { headers: { authorization?: unknown } };
type Task = NonNullable<Awaited<ReturnType<PrismaClient['aiTask']['findFirst']>>>;
export interface RuleDraftPreparationSource {
  context: AiExecutionContext; task: Task; original: AiSceneRequestReadDraft;
  ruleRoutes: AiBusinessReadRouteAuthority; verify(): Promise<void>;
}
type Dependencies = TaskRuleDraftDependencies & {
  resolve(request: Request, taskId: string): Promise<RuleDraftPreparationSource>;
  saved(request: Request, taskId: string, signal?: AbortSignal): Promise<AiTaskRuleDraftListResponse>;
  rejected?(request: Request, taskId: string, reference: AiTaskRuleDraftReference, signal?: AbortSignal): Promise<{
    targetId: string; version: string; receipt: AiTaskDraftRejectedOperation; verify(): Promise<void> }>;
};
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const markerSchema = z.object({ kind: z.literal('rule-linked-preparation-1'), taskId: id.max(36), operationKey: z.string().uuid(),
  commandHash: hash, originalInputRef: z.string().uuid(), originalHash: hash,
  reissuedInputRef: z.string().uuid(), material: z.unknown() }).strict();

export function composeTaskRuleDraftPreparation(d: Dependencies) {
  const db = d.original.db, clock = d.original.clock ?? (() => new Date());
  const at = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const operationId = (context: AiExecutionContext, reference: AiTaskRuleDraftPreparationReference) => {
    const digest = requestFingerprint({ kind: 'rule-linked-preparation-1', scope: context.scope, actor: context.actor, reference });
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
  };
  const bind = async (request: Request, taskId: string, signal?: AbortSignal, rejected?: AiTaskRuleDraftReference) => {
    const bound = await d.resolve(request, taskId);
    if (signal?.aborted || bound.context.actor.kind !== 'user' || bound.context.scope.kind !== 'workspace') throw denied();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer \S+$/u.test(header)) throw denied();
    const credentials = { current: async () => {
      if (signal?.aborted) throw denied(); return { authorization: header, audience: 'operator' as const, requestId: randomUUID() };
    } };
    const input = { ...d.original, credentials }, defaults = composeAiOriginalScenes(input);
    // The immutable source journal supplies the rule target before an opening
    // read can request broader permissions than this dedicated entry has.
    const sourceRow = await db.aiTaskOriginalRequest.findUnique({ where: { id: bound.original.inputRef } });
    let entry: z.infer<typeof ruleSourceEntryMarker> | undefined;
    if (sourceRow?.requestKey.startsWith('rule-entry:')) {
      const reference = { operationKey: z.string().uuid().parse(sourceRow.requestKey.slice('rule-entry:'.length)) };
      const row = await db.operationLog.findUnique({ where: { id: ruleSourceEntryOperationId(bound.context, reference) } });
      if (!row || bound.context.scope.kind !== 'workspace' || bound.context.actor.kind !== 'user'
        || row.action !== 'ai-native.rule.entry' || row.tenantId !== bound.context.scope.tenantId
        || row.workspaceId !== bound.context.scope.workspaceId || row.userId !== bound.context.actor.userId) throw denied();
      entry = ruleSourceEntryMarker.parse(row.detail);
      if (entry.inputRef !== bound.original.inputRef || entry.operationKey !== reference.operationKey) throw denied();
    }
    const requests = entry ? createRuleOriginalRequests(input, entry.target) : defaults.requests;
    const original = await requests.readHistorical(bound.original), task = await requests.readTaskReceipt(bound.original.inputRef);
    if (original.receipt.state === 'revoked' || original.receipt.contentHash !== bound.task.inputHash
      || original.receipt.sceneCode !== 'opening_diagnosis' || original.receipt.sceneVersion !== bound.task.sceneVersion
      || task.state !== 'observed' || task.taskId !== bound.task.id) throw denied();
    const rejection = rejected ? await (d.rejected ? d.rejected(request, taskId, rejected, signal) : Promise.reject(denied())) : undefined;
    if (rejection && entry && (rejection.targetId !== entry.target.id || rejection.version !== entry.target.version)) throw denied();
    const scenes = { ...defaults, requests, readTaskReceipt: (inputRef: string) => requests.readTaskReceipt(inputRef) };
    const verify = async () => {
      if (signal?.aborted) throw denied(); await bound.verify();
      await rejection?.verify();
      const latest = await scenes.requests.readHistorical(bound.original), created = await scenes.readTaskReceipt(bound.original.inputRef);
      if (latest.receipt.state === 'revoked' || latest.receipt.contentHash !== original.receipt.contentHash
        || originalIdentityHash(latest.context) !== originalIdentityHash(original.context) || created.state !== 'observed'
        || created.taskId !== task.taskId || created.runId !== task.runId) throw denied();
    };
    const fields = new AiOpeningVersionFieldSource(db, bound.ruleRoutes);
    const differences = new AiOpeningSectionDifferenceService(new AiGuardedOpeningConfigurationSource(d.original.core, bound.ruleRoutes), bound.ruleRoutes, clock, fields, false, entry?.target);
    const workflow = composeOpeningProposalWorkflow(input, d.host, undefined, entry ? { requests, ruleOnly: entry.target } : undefined);
    return { bound, scenes, fields, differences, workflow, original, task, entry, rejection, verify };
  };
  type Bound = Awaited<ReturnType<typeof bind>>;
  const envelope = (root: Bound) => ({ contractVersion: AI_TASK_RULE_DRAFT_PREPARATION_VERSION, taskId: root.bound.task.id,
    runId: root.task.runId, scope: root.bound.context.scope, original: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
      inputRef: root.original.receipt.inputRef, contentHash: root.original.receipt.contentHash, sceneVersion: root.original.receipt.sceneVersion }, observedAt: at().toISOString() });
  const policy = async (root: Bound) => {
    const row = await db.aiTaskPlanPolicy.findFirst({ where: { scopeId: root.bound.task.scopeId,
      sceneCode: 'opening_diagnosis', sceneVersion: root.bound.task.sceneVersion } });
    const tools = aiPersistedPlanToolsSchema.safeParse(row?.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(row?.limits);
    if (!row?.enabled || !tools.success || !limits.success || !tools.data.some(tool => tool.code === 'tenant.config.propose')
      || !(row.expiresAt instanceof Date) || row.expiresAt <= at()) throw unavailable();
    return { expiresAt: row.expiresAt, hash: requestFingerprint({ revision: row.revision, tools: tools.data, limits: limits.data, expiresAt: row.expiresAt.toISOString() }) };
  };
  const preview = async (root: Bound, command: z.infer<typeof aiTaskRuleDraftPreparationPreviewInput>, expiresAt?: string) => {
    if (root.rejection && (root.rejection.targetId !== command.targetId || root.rejection.version !== command.version)) throw denied();
    if (root.entry && (root.entry.target.id !== command.targetId || root.entry.target.version !== command.version)) throw conflict();
    if (root.entry && !root.rejection) {
      const source = await root.fields.read({ key: 'business_rule', targetId: command.targetId, expectedVersion: command.version }, root.bound.context);
      if (requestFingerprint(source.basis) !== root.entry.sourceHash) throw conflict();
    }
    const publication = await policy(root);
    await root.bound.ruleRoutes.withRuleDraftPreview(command.targetId, async context => { assertAiReadContextBinding(context, root.bound.context); });
    const section = { key: 'business_rule' as const, targetId: command.targetId, expectedVersion: command.version,
      changes: AI_TASK_RULE_DRAFT_FIELDS.map(field => ({ field, value: command.values[field] })) };
    const material = await root.differences.prepare(section, root.bound.context); await root.verify();
    const deadline = expiresAt ?? new Date(Math.min(at().getTime() + 300000, publication.expiresAt.getTime())).toISOString();
    if (Date.parse(deadline) <= at().getTime() || Date.parse(deadline) > publication.expiresAt.getTime()
      || Date.parse(deadline) > at().getTime() + 300000) throw conflict();
    const reviewHash = requestFingerprint({ kind: AI_TASK_RULE_DRAFT_PREPARATION_VERSION, origin: envelope(root).original,
      taskId: root.bound.task.id, section, materialHash: material.materialHash, policy: publication.hash, expiresAt: deadline });
    return { section, material, reviewHash, expiresAt: deadline };
  };
  const observe = async (request: Request, root: Bound, reference: AiTaskRuleDraftPreparationReference,
    admission: 'not_started' | 'unavailable' | 'unknown' = 'not_started') => {
    const row = await db.operationLog.findUnique({ where: { id: operationId(root.bound.context, reference) } });
    const base = { contractVersion: AI_TASK_RULE_DRAFT_PREPARATION_VERSION, reference, scope: root.bound.context.scope,
      observedAt: at().toISOString(), model: 'not_called' as const, businessDraft: 'not_created' as const, publication: 'not_attempted' as const, retryable: false as const };
    if (!row) { await root.verify(); return aiTaskRuleDraftPreparationOperationResponse.parse({ ...base, operation: { state: 'not_observed', retryable: false } }); }
    if (root.bound.context.actor.kind !== 'user' || root.bound.context.scope.kind !== 'workspace'
      || row.action !== 'ai-native.rule.prepare' || row.tenantId !== root.bound.context.scope.tenantId
      || row.workspaceId !== root.bound.context.scope.workspaceId || row.userId !== root.bound.context.actor.userId) throw denied();
    const marker = markerSchema.parse(row.detail), material = verifyOpeningSectionMaterial(marker.material);
    if (marker.taskId !== reference.taskId || marker.operationKey !== reference.operationKey || marker.originalInputRef !== root.bound.original.inputRef
      || marker.originalHash !== root.original.receipt.contentHash || material.key !== 'business_rule') throw denied();
    const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: marker.reissuedInputRef };
    const linked = await root.scenes.requests.readHistorical(original), task = await root.scenes.readTaskReceipt(original.inputRef);
    if (linked.receipt.previousInputRef !== root.bound.original.inputRef || linked.receipt.requestKey !== `rule-prep:${reference.operationKey}`
      || linked.receipt.state === 'revoked' || linked.request.sceneCode !== 'opening_diagnosis'
      || linked.request.input.sections.length !== 1 || linked.request.input.sections[0] !== 'business_rule') throw denied();
    if (task.state === 'observed') {
      const plan = await db.aiTaskRunPlan.findFirst({ where: { scopeId: root.bound.task.scopeId, taskId: task.taskId, runId: task.runId } });
      if (plan) {
        const saved = root.entry ? undefined : await root.workflow.readReceipt({ original, registrationRef: `opening-section:business_rule:${material.materialHash}` });
        if (root.entry || saved?.receipt.state === 'ai_proposal_saved') {
          const items = await d.saved(request, task.taskId), item = items.items.find(item => item.target.id === material.targetId
            && item.target.version === material.expectedVersion && requestFingerprint(item.changes) === requestFingerprint(material.changes));
          if (!item || item.reference.runId !== task.runId) throw denied(); await root.verify();
          return aiTaskRuleDraftPreparationOperationResponse.parse({ ...base, operation: { state: 'ai_proposal_saved', original,
            task: { state: 'observed', taskId: task.taskId, runId: task.runId }, proposal: item } });
        }
      }
    }
    await root.verify();
    return aiTaskRuleDraftPreparationOperationResponse.parse({ ...base, operation: { state: 'linked_request_recorded', original,
      task: task.state === 'observed' ? { state: 'observed', taskId: task.taskId, runId: task.runId } : { state: 'not_observed' },
      proposal: 'not_observed', admission } });
  };
  const call = async (request: Request, value: unknown, action: 'preparation' | 'previewPreparation' | 'prepare' | 'preparationOperation', signal?: AbortSignal) => {
    const schema = action === 'preparation' ? aiTaskRuleDraftPreparationInput : action === 'previewPreparation'
      ? aiTaskRuleDraftPreparationPreviewInput : action === 'prepare' ? aiTaskRuleDraftPrepareInput : aiTaskRuleDraftPreparationReference;
    const parsed = schema.safeParse(structuredClone(value)); if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), body = { headers: { authorization: request.headers.authorization } };
    return waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
      const root = await bind(body, command.taskId, signal, 'rejected' in command ? command.rejected : undefined);
      if (action === 'preparationOperation') return observe(body, root, aiTaskRuleDraftPreparationReference.parse(command));
      if (action === 'preparation') {
        const rows = await root.bound.ruleRoutes.withRead('rule_versions', {}, async context => {
          assertAiReadContextBinding(context, root.bound.context);
          if (context.scope.kind !== 'workspace') throw denied();
          return db.rentalRuleVersion.findMany({ where: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 21, select: { id: true, version: true, status: true } });
        });
        const hasMore = rows.length > 20, targets = [];
        for (const row of rows.slice(0, 20)) {
          if (root.rejection && (row.id !== root.rejection.targetId || row.version !== root.rejection.version)) continue;
          if (root.entry && (row.id !== root.entry.target.id || row.version !== root.entry.target.version)) continue;
          const fields = await root.fields.read({ key: 'business_rule', targetId: row.id, expectedVersion: row.version }, root.bound.context);
          if (root.entry && !root.rejection && requestFingerprint(fields.basis) !== root.entry.sourceHash) throw conflict();
          const values = Object.fromEntries(AI_TASK_RULE_DRAFT_FIELDS.map(field => [field, z.boolean().parse(fields.fields[field])]));
          targets.push({ id: row.id, version: row.version, status: row.status, values, sourceHash: requestFingerprint(fields.basis) });
        }
        await root.verify(); return aiTaskRuleDraftPreparationResponse.parse({ ...envelope(root), targets, hasMore, coverage: 'latest_20_candidates',
          preparation: 'new_linked_opening_request', businessDraft: 'not_created', publication: 'not_attempted' });
      }
      const selected = aiTaskRuleDraftPreparationPreviewInput.parse({ taskId: command.taskId, targetId: 'targetId' in command ? command.targetId : undefined,
        version: 'version' in command ? command.version : undefined, values: 'values' in command ? command.values : undefined,
        ...('rejected' in command && command.rejected ? { rejected: command.rejected } : {}) });
      if (action === 'previewPreparation') {
        const result = await preview(root, selected);
        return aiTaskRuleDraftPreparationPreviewResponse.parse({ ...envelope(root), target: { id: selected.targetId, version: selected.version },
          values: selected.values, changes: result.material.changes, reviewHash: result.reviewHash, expiresAt: result.expiresAt,
          status: result.material.status, preparation: 'new_linked_opening_request', persistence: 'not_attempted', businessDraft: 'not_created', publication: 'not_attempted' });
      }
      const prepare = aiTaskRuleDraftPrepareInput.parse(command), reference = { taskId: prepare.taskId, operationKey: prepare.operationKey };
      const existing = await db.operationLog.findUnique({ where: { id: operationId(root.bound.context, reference) } });
      if (existing) {
        const marker = markerSchema.parse(existing.detail);
        if (marker.commandHash !== requestFingerprint(prepare)) throw conflict(); return observe(body, root, reference);
      }
      const checked = await preview(root, selected, prepare.expiresAt);
      if (checked.material.status !== 'difference_ready' || checked.reviewHash !== prepare.reviewHash) throw conflict();
      const context = root.bound.context; if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw denied();
      const tenantId = context.scope.tenantId, workspaceId = context.scope.workspaceId, userId = context.actor.userId;
      const receipt = await root.scenes.requests.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: `rule-prep:${reference.operationKey}`,
        previousInputRef: root.bound.original.inputRef, sceneCode: 'opening_diagnosis', input: { sections: ['business_rule'] } }, true,
      async (tx, receipt) => { await tx.operationLog.create({ data: { id: operationId(context, reference), action: 'ai-native.rule.prepare',
        tenantId, workspaceId, userId,
        detail: { kind: 'rule-linked-preparation-1', taskId: reference.taskId,
          operationKey: reference.operationKey, commandHash: requestFingerprint(prepare), originalInputRef: root.bound.original.inputRef,
          originalHash: root.original.receipt.contentHash, reissuedInputRef: receipt.inputRef, material: JSON.parse(JSON.stringify(checked.material)) } } }); });
      const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: receipt.inputRef };
      try {
        await root.verify(); await root.scenes.requests.createTask(original);
        if (!d.preparationAdmission) return observe(body, root, reference, 'unavailable');
        await d.preparationAdmission(body, original, { kind: 'business_rule', targetId: checked.material.targetId,
          ...(root.entry ? { version: checked.material.expectedVersion } : {}) }, signal);
        await root.workflow.start({ original, section: checked.section }, signal, checked.material.materialHash);
        return await observe(body, root, reference);
      } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
    }), action === 'prepare', signal);
  };
  return Object.freeze({ preparation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'preparation', signal),
    previewPreparation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'previewPreparation', signal),
    prepare: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'prepare', signal),
    preparationOperation: (request: Request, value: unknown, signal?: AbortSignal) => call(request, value, 'preparationOperation', signal) });
}
