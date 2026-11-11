/** Rule page -> original request/creation receipt. It records source metadata
 * only; linked R1 preparation and the original Core draft remain separate.
 * Recorded operation keys are reconciled before reading today's rule fields. */
import { hasEffectivePermission } from '../../common/permission-match';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_TASK_RULE_SOURCE_ENTRY_VERSION, AI_TASK_RULE_DRAFT_FIELDS,
  aiTaskRuleSourceInput, aiTaskRuleSourceEntryInput, aiTaskRuleSourceEntryReference,
  aiTaskRuleSourceResponse, aiTaskRuleSourceEntryResponse, type AiExecutionContext,
  type AiTaskRuleSourceEntryReference } from '@rental-os/shared';
import type { TaskRuleDraftDependencies } from './task-rule-draft.application';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { AiOpeningVersionFieldSource } from './tools/opening-version-fields.source';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { createRuleOriginalRequests, createRuleOriginalReadRequests } from './task-rule-original-source.composition';
import { originalIdentityHash } from './task-request/original-request.authority';
import { AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const hash = z.string().regex(/^[a-f0-9]{64}$/u), resource = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const ruleSourceEntryMarker = z.object({ kind: z.literal('rule-source-entry-1'), operationKey: z.string().uuid(), commandHash: hash,
  inputRef: z.string().uuid(), target: z.object({ id: resource, version: resource,
    status: z.enum(['draft', 'pending', 'published', 'superseded', 'void']) }).strict(), sourceHash: hash }).strict();
export function ruleSourceEntryOperationId(context: AiExecutionContext, reference: AiTaskRuleSourceEntryReference) {
  const value = requestFingerprint({ kind: 'rule-source-entry-1', scope: context.scope, actor: context.actor, reference });
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}
type Request = { headers: { authorization?: unknown } };
export function composeTaskRuleSourceEntry(d: TaskRuleDraftDependencies) {
  const db = d.original.db, clock = d.original.clock ?? (() => new Date());
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw denied(); return value; };
  const bind = async (request: Request, signal?: AbortSignal) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer \S+$/u.test(authorization)) throw denied();
    const credentials = { current: async () => { if (signal?.aborted) throw denied(); return { authorization, audience: 'operator' as const, requestId: randomUUID() }; } };
    const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(d.original.auth, credentials, clock), clock);
    const first = await scopes.resolveCurrent(), context = first.context;
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
      || !('access' in context) || !hasEffectivePermission(context.access.permissions, 'rental-os:rules:manage')) throw denied();
    const verify = async () => { if (signal?.aborted) throw denied(); const latest = await scopes.resolveCurrent();
      if (latest.scope.id !== first.scope.id || originalIdentityHash(latest.context) !== originalIdentityHash(context)) throw denied(); };
    return { context, verify, input: { ...d.original, credentials }, routes: new AiBusinessReadRouteAuthority(d.original.guard, credentials, clock) };
  };
  type Bound = Awaited<ReturnType<typeof bind>>;
  const source = async (root: Bound, command: z.infer<typeof aiTaskRuleSourceInput>) => {
    const row = await root.routes.withRuleDraftPreview(command.targetId, async context => {
      assertAiReadContextBinding(context, root.context); if (context.scope.kind !== 'workspace') throw denied();
      return db.rentalRuleVersion.findFirst({ where: { id: command.targetId, tenantId: context.scope.tenantId,
        workspaceId: context.scope.workspaceId, version: command.version } });
    });
    if (!row || row.id !== command.targetId || row.version !== command.version) throw changed();
    const fields = await new AiOpeningVersionFieldSource(db, root.routes).read({ key: 'business_rule', targetId: row.id, expectedVersion: row.version }, root.context);
    await root.verify(); return aiTaskRuleSourceResponse.shape.target.parse({ id: row.id, version: row.version, status: row.status,
      sourceHash: requestFingerprint(fields.basis), values: Object.fromEntries(AI_TASK_RULE_DRAFT_FIELDS.map(field => [field, fields.fields[field]])) });
  };
  const observe = async (root: Bound, reference: AiTaskRuleSourceEntryReference) => {
    const row = await db.operationLog.findUnique({ where: { id: ruleSourceEntryOperationId(root.context, reference) } });
    const base = { contractVersion: AI_TASK_RULE_SOURCE_ENTRY_VERSION, reference, scope: root.context.scope, observedAt: now().toISOString(),
      model: 'not_called' as const, execution: 'not_started' as const, retryable: false as const };
    if (!row) { await root.verify(); return aiTaskRuleSourceEntryResponse.parse({ ...base, operation: { state: 'not_observed', retryable: false } }); }
    if (root.context.scope.kind !== 'workspace' || root.context.actor.kind !== 'user' || row.action !== 'ai-native.rule.entry'
      || row.tenantId !== root.context.scope.tenantId || row.workspaceId !== root.context.scope.workspaceId || row.userId !== root.context.actor.userId) throw denied();
    const saved = ruleSourceEntryMarker.parse(row.detail); if (saved.operationKey !== reference.operationKey) throw denied();
    const requests = createRuleOriginalReadRequests(root.input, saved.target), original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: saved.inputRef };
    const receipt = await requests.readHistorical(original), task = await requests.readTaskReceipt(original.inputRef);
    if (receipt.receipt.state === 'revoked' || receipt.receipt.requestKey !== `rule-entry:${reference.operationKey}`
      || receipt.request.sceneCode !== 'opening_diagnosis' || receipt.request.input.sections.length !== 1 || receipt.request.input.sections[0] !== 'business_rule') throw denied();
    await root.verify(); return aiTaskRuleSourceEntryResponse.parse({ ...base, operation: { state: 'original_request_recorded', original,
      target: saved.target, task: task.state === 'observed' ? { state: 'observed', taskId: task.taskId, runId: task.runId } : { state: 'not_observed' } } });
  };
  const call = async (request: Request, value: unknown, action: 'source' | 'entry' | 'entryOperation', signal?: AbortSignal) => {
    const schema = action === 'source' ? aiTaskRuleSourceInput : action === 'entry' ? aiTaskRuleSourceEntryInput : aiTaskRuleSourceEntryReference;
    const parsed = schema.safeParse(structuredClone(value)); if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
      const root = await bind(request, signal), command = parsed.data;
      if (action === 'entryOperation') return observe(root, aiTaskRuleSourceEntryReference.parse(command));
      if (action === 'entry') { const entry = aiTaskRuleSourceEntryInput.parse(command), reference = { operationKey: entry.operationKey };
        const old = await db.operationLog.findUnique({ where: { id: ruleSourceEntryOperationId(root.context, reference) } });
        if (old) { if (ruleSourceEntryMarker.parse(old.detail).commandHash !== requestFingerprint(entry)) throw changed(); return observe(root, reference); } }
      const input = aiTaskRuleSourceInput.parse({ targetId: 'targetId' in command ? command.targetId : undefined, version: 'version' in command ? command.version : undefined });
      const selected = await source(root, input);
      if (action === 'source') return aiTaskRuleSourceResponse.parse({ contractVersion: AI_TASK_RULE_SOURCE_ENTRY_VERSION,
        scope: root.context.scope, observedAt: now().toISOString(), target: selected, source: 'original_rule_version', task: 'not_created' });
      const entry = aiTaskRuleSourceEntryInput.parse(command), reference = { operationKey: entry.operationKey };
      if (entry.sourceHash !== selected.sourceHash) throw changed();
      if (root.context.scope.kind !== 'workspace' || root.context.actor.kind !== 'user') throw denied();
      const scope = root.context.scope, actor = root.context.actor, target = { id: selected.id, version: selected.version, status: selected.status };
      const requests = createRuleOriginalRequests(root.input, target);
      try {
        const receipt = await requests.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: `rule-entry:${reference.operationKey}`,
          sceneCode: 'opening_diagnosis', input: { sections: ['business_rule'] } }, false, async (tx, receipt) => {
          if ((await source(root, input)).sourceHash !== selected.sourceHash) throw changed();
          await tx.operationLog.create({ data: { id: ruleSourceEntryOperationId(root.context, reference), action: 'ai-native.rule.entry',
            tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: actor.userId, detail: { kind: 'rule-source-entry-1',
              operationKey: reference.operationKey, commandHash: requestFingerprint(entry), inputRef: receipt.inputRef, target, sourceHash: selected.sourceHash } } });
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
