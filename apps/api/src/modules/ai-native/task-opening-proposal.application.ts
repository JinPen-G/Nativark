/** Current owned diagnosis -> one explicitly reviewed ordinary-section R1
 * proposal on a new linked Task. The original runner and receipt reader own
 * persistence. Reads never resume preparation, save Core settings or publish. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { AI_TASK_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS, AI_TASK_OPENING_PROPOSAL_HTTP_SCHEMAS,
  AI_TASK_OPENING_PROPOSAL_SECTION_KEYS, AI_TOOL_DRAFT_VERSION,
  type AiTaskOpeningProposalSectionDraft, type AiTaskOpeningProposalPrepareRequestDraft, type AiProposalPayloadDraft,
  type AiTaskOpeningProposalSourceDraft, type AiTaskOpeningProposalListDraft, type AiTaskOpeningProposalOperationDraft,
  type AiTaskOpeningProposalMaterialDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { hasEffectivePermission } from '../../common/permission-match';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { RENTAL_OPENING_TERMINOLOGY_FIELDS } from '../rental-core/rental-core-config.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiScopeRepository } from './ai-scope.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { waitForTaskApplicationDependency, type AiTaskApplicationHost } from './runner/prisma-task-application';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { createOriginalTaskStartAdmission } from './task-start-admission.composition';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { AiGuardedOpeningConfigurationSource } from './tools/opening-configuration.source';
import { AiOpeningSectionDifferenceService, openingSectionChangeSchema, verifyOpeningSectionMaterial } from './tools/opening-section-difference.service';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { composeOpeningProposalWorkflow } from './scenes/opening-proposal-workflow.composition';
import { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import { AiCurrentOriginalRequestAuthority, originalIdentityHash } from './task-request/original-request.authority';
import { fingerprintAiProposalDraft } from './proposal-binding-draft';

type Request = { headers: { authorization?: unknown } };
type Dependencies = Omit<AiOriginalSceneDependencies, 'credentials' | 'db'> & { db: PrismaClient };
type Action = keyof typeof AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS;
const error = (code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_REVISION_CONFLICT' | 'AI_STORAGE_UNAVAILABLE') => new AiTaskRepositoryError(code);
const identifiers = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const reference = z.object({ draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: z.string().uuid() }).strict();
const marker = z.object({ kind: z.literal('opening-linked-proposal-1'), taskId: z.string().uuid(), runId: z.string().uuid(),
  operationKey: identifiers, commandHash: hash, originalInputRef: z.string().uuid(), originalHash: hash,
  linkedOriginal: reference, material: z.unknown() }).strict();
const definitions = JSON.parse(JSON.stringify({ ...AI_TASK_OPENING_PROPOSAL_HTTP_SCHEMAS,
  AiSceneRequestReadDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReadDraft }).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validators = Object.fromEntries(Object.keys(AI_TASK_OPENING_PROPOSAL_HTTP_SCHEMAS)
  .map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));
function wire<T>(name: string, value: unknown, request = false): T {
  const copy = structuredClone(value);
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 262144 || !validators[name]?.(copy)) throw error(request ? 'AI_INVALID_INPUT' : 'AI_STORAGE_UNAVAILABLE');
  return copy as T;
}
const immutable = (value: unknown) => requestFingerprint(value);

export class TaskOpeningProposalApplication {
  private readonly configuration: { enabled: boolean; host: AiTaskApplicationHost };
  constructor(private readonly d: Dependencies, configuration: { enabled: boolean; host: AiTaskApplicationHost }) {
    this.configuration = z.object({ enabled: z.boolean(), host: z.object({ holderId: identifiers,
      leaseMs: z.number().int().min(1).max(120000) }).strict() }).strict().parse(structuredClone(configuration));
  }
  async call(request: Request, action: Action, value: unknown, signal?: AbortSignal) {
    if (!Object.hasOwn(AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS, action)) throw error('AI_INVALID_INPUT');
    const contract = AI_TASK_OPENING_PROPOSAL_HTTP_CONTRACTS[action], command = wire<AiTaskOpeningProposalPrepareRequestDraft>(contract.request, value, true);
    const authorization = request?.headers?.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer \S+$/u.test(authorization)) throw error('AI_ACCESS_DENIED');
    let active = !signal?.aborted;
    const close = () => { active = false; }; signal?.addEventListener('abort', close, { once: true });
    const clock = this.d.clock ?? (() => new Date()), requestId = randomUUID();
    const check = () => { if (!active || signal?.aborted) throw error('AI_ACCESS_DENIED'); };
    const credentials = { current: async () => { check(); return { authorization, audience: 'operator' as const, requestId }; } };
    try {
      const result = await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        check();
        const input = { ...this.d, credentials }, scopes = new AiScopeRepository(this.d.db,
          new AiTaskCurrentIdentityAuthority(this.d.auth, credentials, clock), clock);
        const current = await scopes.resolveCurrent(), context = current.context;
        if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
          || !('access' in context) || !hasEffectivePermission(context.access.permissions, 'rental-os:price:manage')) throw error('AI_ACCESS_DENIED');
        const scope = context.scope;
        const access = aiTaskAccessFromContext(context, command.taskId, clock());
        const task = await this.d.db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: current.scope.id }] } });
        if (!task || task.id !== command.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.scopeId !== current.scope.id
          || task.scopeKind !== 'WORKSPACE' || task.audience !== 'OPERATOR' || task.ownerKind !== 'USER' || task.ownerId !== context.actor.userId
          || task.archivedAt !== null || task.sceneCode !== 'opening_diagnosis' || !task.inputRef || !task.inputHash) throw error('AI_ACCESS_DENIED');
        const routes = new AiBusinessReadRouteAuthority(this.d.guard, credentials, clock);
        const history = new PrismaOriginalRequestRepository(this.d.db, new AiCurrentOriginalRequestAuthority(this.d.db, {
          ...input, authorizeResources: async body => { if (body.sceneCode !== 'opening_diagnosis') throw error('AI_ACCESS_DENIED');
            return routes.withRead('opening', {}, async resolved => resolved); }
        }, clock), clock);
        const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: task.inputRef };
        const first = await history.readHistorical(original), created = await history.readTaskReceipt(original.inputRef);
        if (first.receipt.state === 'revoked' || first.receipt.contentHash !== task.inputHash || first.receipt.sceneVersion !== task.sceneVersion
          || first.request.sceneCode !== 'opening_diagnosis' || created.state !== 'observed' || created.taskId !== task.id
          || command.runId !== undefined && command.runId !== created.runId) throw error('AI_ACCESS_DENIED');
        const run = await this.d.db.aiRun.findFirst({ where: { id: created.runId, taskId: task.id, scopeId: task.scopeId } });
        if (!run || run.actorKind !== 'USER' || run.actorId !== task.ownerId) throw error('AI_ACCESS_DENIED');
        const verify = async () => {
          check(); const next = await scopes.resolveCurrent(), nextAccess = aiTaskAccessFromContext(next.context, task.id, clock());
          const latest = await this.d.db.aiTask.findFirst({ where: { AND: [nextAccess.where, { scopeId: current.scope.id }] } });
          const receipt = await history.readHistorical(original), linked = await history.readTaskReceipt(original.inputRef);
          if (nextAccess.bindingKey !== access.bindingKey || originalIdentityHash(next.context) !== originalIdentityHash(context)
            || !latest || latest.id !== task.id || latest.inputRef !== task.inputRef || latest.inputHash !== task.inputHash
            || latest.ownerId !== task.ownerId || latest.archivedAt !== null || receipt.receipt.state === 'revoked'
            || receipt.receipt.contentHash !== first.receipt.contentHash || receipt.receipt.revision !== first.receipt.revision
            || linked.state !== 'observed' || linked.taskId !== task.id || linked.runId !== run.id) throw error('AI_ACCESS_DENIED');
          check();
        };
        await verify();
        const operationId = (key: string) => `opening-prop:${immutable({ scope: context.scope, actor: context.actor, taskId: task.id, operationKey: key })}`;
        const semantics = (key: string) => ({ diagnosisTaskId: task.id, diagnosisRunId: run.id, operationKey: key,
          retryable: false as const, activeConfiguration: 'unchanged' as const, businessDraft: 'not_created' as const, publication: 'not_attempted' as const });
        const observe = async (key: string): Promise<AiTaskOpeningProposalOperationDraft> => {
          const row = await this.d.db.operationLog.findUnique({ where: { id: operationId(key) } });
          if (!row) { await verify(); return { ...semantics(key), state: 'not_observed', receipt: null, linked: null, nextAction: 'read_original_operation' }; }
          if (row.action !== 'ai-native.opening.prepare' || row.tenantId !== scope.tenantId
            || row.workspaceId !== scope.workspaceId || row.userId !== context.actor.userId) throw error('AI_ACCESS_DENIED');
          const saved = marker.parse(row.detail), material = verifyOpeningSectionMaterial(saved.material);
          if (saved.taskId !== task.id || saved.runId !== run.id || saved.operationKey !== key || saved.originalInputRef !== original.inputRef
            || saved.originalHash !== first.receipt.contentHash || !AI_TASK_OPENING_PROPOSAL_SECTION_KEYS.includes(material.key as never)
            || material.scope.tenantId !== scope.tenantId || material.scope.workspaceId !== scope.workspaceId) throw error('AI_ACCESS_DENIED');
          const registrationRef = `opening-section:${material.key}:${material.materialHash}`;
          const receipt = await history.readHistorical(saved.linkedOriginal);
          if (receipt.receipt.previousInputRef !== original.inputRef || receipt.request.sceneCode !== 'opening_diagnosis'
            || receipt.request.input.sections.length !== 1 || receipt.request.input.sections[0] !== material.key) throw error('AI_ACCESS_DENIED');
          const metadata = await history.readTaskReceipt(saved.linkedOriginal.inputRef);
          const linked = { original: saved.linkedOriginal, taskId: metadata.state === 'observed' ? metadata.taskId : null,
            runId: metadata.state === 'observed' ? metadata.runId : null, registrationRef };
          if (metadata.state !== 'observed') { await verify(); return { ...semantics(key), state: 'unknown', receipt: null, linked, nextAction: 'read_original_operation' }; }
          try {
            const workflow = composeOpeningProposalWorkflow(input, this.configuration.host);
            const result = await workflow.readReceipt({ original: saved.linkedOriginal, registrationRef });
            await verify();
            if (result.receipt.state !== 'ai_proposal_saved') return { ...semantics(key), state: 'unknown', receipt: null, linked, nextAction: 'read_original_operation' };
            const known = result.receipt;
            if (fingerprintAiProposalDraft(known.proposal) !== known.payloadHash) throw error('AI_ACCESS_DENIED');
            const proposal = known.proposal as unknown as AiProposalPayloadDraft, proposalMaterial = verifyOpeningSectionMaterial(known.material);
            // Review and R1 can observe identical material at different times.
            // The verified material hash binds the business difference; audit
            // timestamps cannot turn a saved proposal into an unknown result.
            if (proposalMaterial.materialHash !== material.materialHash || proposal.taskId !== metadata.taskId
              || proposal.actions.length !== 1 || proposal.actions[0].toolCode !== 'tenant.config.propose'
              || proposal.actions[0].preview.contentHash !== material.materialHash || proposal.actions[0].target.resourceId !== material.targetId
              || proposal.actions[0].target.version !== material.expectedVersion || immutable(proposal.scope) !== immutable(scope)) throw error('AI_ACCESS_DENIED');
            return { ...semantics(key), state: 'observed', nextAction: 'read_original_proposal', receipt: { taskId: metadata.taskId,
              runId: metadata.runId, original: saved.linkedOriginal, registrationRef, proposalId: proposal.proposalId,
              proposalRevision: proposal.revision, payloadHash: known.payloadHash,
              material: proposalMaterial as AiTaskOpeningProposalMaterialDraft } };
          } catch (cause) {
            if (cause instanceof AiTaskRepositoryError && ['AI_ACCESS_DENIED', 'AI_STORAGE_UNAVAILABLE'].includes(cause.code)) throw cause;
            await verify(); return { ...semantics(key), state: 'unknown', receipt: null, linked, nextAction: 'read_original_operation' };
          }
        };
        if (action === 'operation') return observe(command.operationKey);
        if (action === 'prepare') {
          const existing = await this.d.db.operationLog.findUnique({ where: { id: operationId(command.operationKey) } });
          if (existing) {
            if (marker.parse(existing.detail).commandHash !== immutable({ ...command, runId: run.id })) throw error('AI_REVISION_CONFLICT');
            return observe(command.operationKey);
          }
        }
        const configuration = new AiGuardedOpeningConfigurationSource(this.d.core, routes);
        const before = await configuration.current(context.scope, context), after = await configuration.current(context.scope, context);
        if (immutable(before) !== immutable(after)) throw error('AI_REVISION_CONFLICT');
        const source: AiTaskOpeningProposalSourceDraft = { taskId: task.id, runId: run.id, original, contentHash: first.receipt.contentHash,
          receiptRevision: first.receipt.revision, sceneVersion: first.receipt.sceneVersion, scope: context.scope, materialHash: immutable(before) };
        const selected = first.request.input.sections.filter(key => AI_TASK_OPENING_PROPOSAL_SECTION_KEYS.includes(key as never));
        const candidates: AiTaskOpeningProposalListDraft['candidates'] = [];
        if (selected.includes('workspace_profile') && before.profile) candidates.push({ key: 'workspace_profile', targetId: 'workspace_profile', expectedVersion: before.profile.configVersion,
          fields: RENTAL_OPENING_TERMINOLOGY_FIELDS.map(field => ({ field, title: ({ itemLabel: '单品称谓', itemGroupLabel: '商品组称谓', assetLabel: '资产称谓',
            fulfillmentLabel: '履约称谓', pickupLabel: '取货称谓', returnLabel: '归还称谓' })[field], input: 'text', value: before.profile!.terminology[field] ?? null, maxLength: 80 })) });
        if (selected.includes('item_groups')) for (const group of before.groups) candidates.push({ key: 'item_groups', targetId: group.id,
          expectedVersion: before.settings.configVersion, fields: [{ field: 'status', title: '状态', input: 'choice', value: group.status,
            choices: ['enabled', 'disabled'] }, { field: 'code', title: '代码', input: 'text', value: group.code, maxLength: 191 }] });
        if (selected.includes('pricing_groups_rates')) candidates.push({ key: 'pricing_groups_rates', targetId: 'pricing_groups_rates', expectedVersion: before.settings.configVersion,
          fields: [{ field: 'defaultUnit', title: '默认计价单位', input: 'choice', value: before.settings.pricing.defaultUnit, choices: [...before.settings.pricing.enabledUnits] },
            { field: 'enabledUnits', title: '启用计价单位', input: 'choices', value: [...before.settings.pricing.enabledUnits], choices: [...before.settings.pricing.enabledUnits] }] });
        if (selected.includes('fulfillment_network')) candidates.push({ key: 'fulfillment_network', targetId: 'fulfillment_network', expectedVersion: before.settings.configVersion,
          fields: [{ field: 'enabledModes', title: '启用履约模式', input: 'choices', value: [...before.settings.fulfillment.enabledModes], choices: [...before.settings.fulfillment.enabledModes] }] });
        await verify();
        if (action === 'list') return { source, candidates, hasMore: before.truncated.groups || before.truncated.pricingGroups || before.truncated.locations,
          coverage: 'bounded_current_original_configuration', readOnly: true, activeConfiguration: 'unchanged', publication: 'not_attempted' };
        const section = openingSectionChangeSchema.parse(command.section);
        if (!selected.includes(section.key) || !AI_TASK_OPENING_PROPOSAL_SECTION_KEYS.includes(section.key as never)) throw error('AI_ACCESS_DENIED');
        const target = candidates.find(row => row.key === section.key && (section.key !== 'item_groups' || row.targetId === section.targetId));
        if (!target || target.expectedVersion !== section.expectedVersion || section.changes.some(change => !target.fields.some(field => field.field === change.field))) throw error('AI_REVISION_CONFLICT');
        const differences = new AiOpeningSectionDifferenceService(configuration, routes, clock);
        const material = await differences.prepare(section, context);
        await verify();
        if (action === 'preview') return { source, section: command.section, material, proposalOnly: true,
          activeConfiguration: 'unchanged', publication: 'not_attempted' };
        if (!this.configuration.enabled) throw error('AI_RESOURCE_UNAVAILABLE');
        if (material.status !== 'difference_ready' || material.materialHash !== command.reviewedMaterialHash) throw error('AI_REVISION_CONFLICT');
        const policy = await this.d.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: task.scopeId, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion } });
        const tools = aiPersistedPlanToolsSchema.safeParse(policy?.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(policy?.limits);
        if (!policy?.enabled || !tools.success || !limits.success || !(policy.expiresAt instanceof Date) || policy.expiresAt <= clock()
          || !tools.data.some(tool => tool.code === 'tenant.config.propose' && tool.version === AI_TOOL_DRAFT_VERSION)) throw error('AI_RESOURCE_UNAVAILABLE');
        const scenes = composeAiOriginalScenes(input), sectionDraft = section as AiTaskOpeningProposalSectionDraft;
        const knownCommand = immutable({ ...command, runId: run.id });
        let attempted = false;
        try {
          await verify();
          if ((await differences.prepare(sectionDraft, context)).materialHash !== material.materialHash) throw error('AI_REVISION_CONFLICT');
          attempted = true;
          const saved = await scenes.requests.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION,
            requestKey: `opening-prop:${immutable({ operationKey: command.operationKey, taskId: task.id, scope: context.scope, actor: context.actor })}`,
            previousInputRef: original.inputRef, sceneCode: 'opening_diagnosis', input: { sections: [section.key] } }, true,
          async (tx, receipt) => { await tx.operationLog.create({ data: { id: operationId(command.operationKey), action: 'ai-native.opening.prepare',
            tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: context.actor.userId,
            detail: { kind: 'opening-linked-proposal-1', taskId: task.id, runId: run.id, operationKey: command.operationKey,
              commandHash: knownCommand, originalInputRef: original.inputRef, originalHash: first.receipt.contentHash,
              linkedOriginal: { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: receipt.inputRef }, material: JSON.parse(JSON.stringify(material)) } } }); });
          const linked = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: saved.inputRef };
          // The same original request key may already exist after a concurrent
          // save. Its section list cannot attest this caller's reviewed values;
          // the transaction's operation marker must bind them before R1 starts.
          const recorded = await this.d.db.operationLog.findUnique({ where: { id: operationId(command.operationKey) } });
          if (!recorded) throw error('AI_STORAGE_UNAVAILABLE');
          const recordedMarker = marker.parse(recorded.detail);
          if (recordedMarker.commandHash !== knownCommand || recordedMarker.linkedOriginal.inputRef !== linked.inputRef
            || immutable(recordedMarker.material) !== immutable(material)) throw error('AI_REVISION_CONFLICT');
          await verify(); await scenes.requests.createTask(linked);
          await createOriginalTaskStartAdmission(this.d, 'opening_diagnosis')(request, linked, undefined, signal);
          await composeOpeningProposalWorkflow(input, this.configuration.host).start({ original: linked, section: sectionDraft }, signal, command.reviewedMaterialHash);
          return observe(command.operationKey);
        } catch (cause) {
          if (!attempted) throw cause;
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        }
      }), action === 'prepare', signal);
      check(); return wire(contract.response, result);
    } finally { active = false; signal?.removeEventListener('abort', close); }
  }
}
