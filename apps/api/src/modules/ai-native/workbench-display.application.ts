/** Read-only HTTP assembly for original display artifacts and supplied sources.
 * Current Auth/ALS, owner scope, original model/financial evidence and version
 * policy are rechecked; opening this surface never creates or starts a Task. */
import { hasEffectivePermission } from '../../common/permission-match';
import { randomUUID } from 'node:crypto';
import { AI_CONVERSATION_DRAFT_VERSION, AI_TASK_CENTER_ENTRY_PERMISSIONS,
  type AiWorkbenchDisplayReadDraft, type AiWorkbenchDisplayRevalidateDraft,
  type AiWorkbenchDisplaySourceReadDraft, type AiWorkbenchDisplayMaterialDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composePersistedTaskAuthorization } from './task-authorization.composition';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { AiConversationRepository } from './conversation.repository';
import { conversationCommand } from './conversation-contract';
import { AiWorkbenchDisplayOriginalReader } from './workbench-display-original.reader';
import { AiWorkbenchDisplayPreparationService } from './workbench-display-preparation.service';
import { AiOriginalSceneDisplayGeneration, type AiOriginalSceneDisplayPublication } from './workbench-display-generation.service';
import { AiWorkbenchFieldMaterialService } from './workbench-field-material.service';
import { PrismaTaskPlanInputSource } from './runner/prisma-task-plan-input.source';
import { PrismaModelStepEvidenceAuthority } from './model-input/prisma-model-step-evidence.authority';
import { PrismaGatewayInvocationBindings } from './budget/prisma-gateway-invocation-bindings';
import { PrismaGatewayAccountingFacts } from './budget/prisma-gateway-accounting-facts';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { inspectAiWorkbenchDisplayMaterial } from './workbench-display.contract';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { originalIdentityHash } from './task-request/original-request.authority';

type Request = { headers: { authorization?: unknown } };
type Reads = { readModelResult(request: Request, value: unknown): Promise<unknown>; reopenModelSource(request: Request, value: unknown): Promise<unknown> };
type Action = 'display' | 'display-revalidate' | 'display-source';
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const same = (a: unknown, b: unknown) => requestFingerprint(a) === requestFingerprint(b);

export function composeAiWorkbenchDisplayRequests(dependencies: Omit<AiOriginalSceneDependencies, 'credentials'>,
  publication: AiOriginalSceneDisplayPublication, observations: Reads) {
  return { async consume(request: Request, action: Action, value: unknown, signal?: AbortSignal) {
    if (!['display', 'display-revalidate', 'display-source'].includes(action)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const header = request?.headers?.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)) throw denied();
    const command = action === 'display' ? conversationCommand('AiWorkbenchDisplayReadDraft', value)
      : action === 'display-revalidate' ? conversationCommand('AiWorkbenchDisplayRevalidateDraft', value)
      : conversationCommand('AiWorkbenchDisplaySourceReadDraft', value);
    const requestId = randomUUID(); let active = !signal?.aborted;
    const close = () => { active = false; }; signal?.addEventListener('abort', close, { once: true });
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        const input = { ...dependencies, credentials: { current: async () => {
          if (!active) throw denied(); return { authorization: header, audience: 'operator' as const, requestId };
        } } }, clock = input.clock ?? (() => new Date());
        const authorization = composePersistedTaskAuthorization(input), scenes = composeAiOriginalScenes(input);
        const locate = async (query: AiWorkbenchDisplayReadDraft) => {
          const current = await authorization.scopes.resolveCurrent(), context = current.context;
          if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
            || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(code => 'access' in context && hasEffectivePermission(context.access.permissions, code))) throw denied();
          const task = await input.db.aiTask.findFirst({ where: { id: query.taskId, scopeId: current.scope.id,
            ownerId: context.actor.userId, ownerKind: 'USER', audience: 'OPERATOR' } });
          if (!task?.inputRef || task.id !== query.taskId || task.scopeId !== current.scope.id || task.ownerId !== context.actor.userId
            || task.ownerKind !== 'USER' || task.audience !== 'OPERATOR' || !['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(task.sceneCode)) throw denied();
          const key = { scopeId: current.scope.id, taskId: task.id };
          const turns = await input.db.aiConversationTurn.findMany({ where: { scopeId: key.scopeId,
            ownerId: context.actor.userId, originalRequestId: task.inputRef }, take: 2 });
          const runs = await input.db.aiRun.findMany({ where: key, orderBy: { sequence: 'desc' }, take: 1 });
          if (turns.length !== 1 || runs.length !== 1) throw unavailable();
          const run = runs[0], turn = turns[0];
          if (run.scopeId !== key.scopeId || run.taskId !== task.id || run.actorKind !== 'USER' || run.actorId !== context.actor.userId
            || turn.scopeId !== key.scopeId || turn.ownerId !== context.actor.userId || turn.originalRequestId !== task.inputRef) throw denied();
          const steps = await input.db.aiStep.findMany({ where: { ...key, runId: run.id, toolCode: 'ai.model.text', status: 'SUCCEEDED' }, take: 2 });
          if (steps.length !== 1 || !steps[0].resultRef) throw unavailable();
          const step = steps[0];
          if (step.scopeId !== key.scopeId || step.taskId !== task.id || step.runId !== run.id) throw denied();
          return { reference: { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: turn.conversationId,
            admissionKey: turn.admissionKey, resultId: step.resultRef! }, task, runId: run.id,
            identity: originalIdentityHash(context), scopeId: current.scope.id };
        };
        const before = await locate(command);
        const policy = { sceneCode: before.task.sceneCode, maxOutputTokens: 32768 };
        const plans = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
          'ai.model.text', undefined, policy);
        const bindings = new PrismaGatewayInvocationBindings(input.db, authorization.scopes, clock, policy);
        // ReadDispatch verifies original persisted accounting. This surface has
        // no pricing/write host; any accidental new pricing request fails closed.
        const financial = new PrismaGatewayAccountingFacts(input.db, bindings, authorization.scopes,
          { quantity: async () => { throw unavailable(); } }, clock);
        const evidence = new PrismaModelStepEvidenceAuthority(input.db, authorization.authority, plans, policy, financial, clock);
        const originals = new AiWorkbenchDisplayOriginalReader({ db: input.db, scopes: authorization.scopes,
          conversations: new AiConversationRepository(input, scenes.requests), originals: scenes.requests,
          tasks: authorization.tasks, evidence, policy,
          observations: { readModelResult: query => observations.readModelResult(request, query) } });
        const producer = new AiOriginalSceneDisplayGeneration({ db: input.db, scopes: authorization.scopes,
          originals: scenes.requests, publication,
          quoteFields: { material: new AiWorkbenchFieldMaterialService(scenes.tools.quote.candidates, clock),
            describe: scenes.tools.quote.businessPreparation.describeInput.bind(scenes.tools.quote.businessPreparation) } }, clock);
        const service = new AiWorkbenchDisplayPreparationService(originals, producer, clock);
        const material = inspectAiWorkbenchDisplayMaterial(await service.read(before.reference));
        const binding = material.presentation.binding, generation = material.presentation.generation;
        if (action !== 'display') {
          const expected = command as AiWorkbenchDisplayRevalidateDraft | AiWorkbenchDisplaySourceReadDraft;
          if (expected.inputFingerprint !== binding.inputFingerprint || expected.materialHash !== binding.materialHash
            || expected.presentationRevision !== binding.presentationRevision || expected.runId !== generation.runId
            || expected.resultId !== generation.resultId) throw denied();
          if ('fieldRevision' in expected && (expected.materialRevision !== binding.materialRevision
            || expected.fieldRevision !== (material.fieldMaterial?.fieldRevision ?? null)
            || expected.aclRevision !== material.presentation.retention.aclRevision || expected.policyVersion !== material.presentation.retention.policyVersion
            || Date.parse(expected.expiresAt) <= clock().getTime()
            || Date.parse(expected.expiresAt) > Date.parse(material.presentation.retention.expiresAt))) throw denied();
        }
        let result: AiWorkbenchDisplayMaterialDraft | { text: string; trust: 'source_data_not_instructions'; truncated: boolean } = material;
        if (action === 'display-source') {
          const sourceId = (command as AiWorkbenchDisplaySourceReadDraft).sourceId;
          if (!material.sourceIds.includes(sourceId)) throw denied();
          const original = await originals.read(before.reference), sources = original.observation.sources;
          const orderIndex = sources.findIndex(source => requestFingerprint(source) === sourceId);
          const knowledgeIndex = original.observation.knowledge?.material.sources.findIndex(source => source.sourceId === sourceId) ?? -1;
          const fieldSource = material.fieldMaterial?.sources.find(source => source.sourceId === sourceId);
          let sourceBody: unknown;
          if (fieldSource && material.fieldMaterial) {
            // service.read already revalidated the original configuration and
            // field rules. Reveal only that safe projection, never its Core
            // configuration body or the other fields of the human question.
            sourceBody = { reference: fieldSource.reference, fieldRevision: material.fieldMaterial.fieldRevision,
              contract: material.fieldMaterial.contract, authority: material.fieldMaterial.authority };
          } else {
            if (orderIndex < 0 && knowledgeIndex < 0) throw unavailable();
            const source = await observations.reopenModelSource(request, { original: binding.original, resultId: generation.resultId,
              sourceIndex: orderIndex >= 0 ? orderIndex : knowledgeIndex, ...(orderIndex >= 0 ? {} : { sourceKind: 'knowledge' }) });
            if (!source || typeof source !== 'object' || !('source' in source)) throw unavailable();
            sourceBody = source.source;
          }
          const full = JSON.stringify(sourceBody); if (!full || Buffer.byteLength(full, 'utf8') > 131072) throw unavailable();
          let text = '', bytes = 0;
          for (const character of full) { const next = Buffer.byteLength(character, 'utf8'); if (bytes + next > 8192) break; text += character; bytes += next; }
          result = { text, trust: 'source_data_not_instructions', truncated: text.length < full.length };
          await service.revalidate(before.reference, binding);
        }
        const after = await locate(command);
        if (!active || !same(before.reference, after.reference) || before.identity !== after.identity || before.scopeId !== after.scopeId
          || before.task.revision !== after.task.revision || before.runId !== after.runId) throw denied();
        return result;
      }), false, signal);
    } finally { close(); signal?.removeEventListener('abort', close); }
  } };
}
