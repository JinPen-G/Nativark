/** Operator request composition for explicit model-only controls and receipts.
 * Reads use original sources; only a new recorded control builds the existing
 * Task host. No business rerun, new Task, approval or budget reset is provided. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_CONVERSATION_DRAFT_VERSION, AI_WORKBENCH_MODEL_CONTROL_VERSION, type AiWorkbenchModelControlPreparation,
  type AiWorkbenchModelControlCommand, type AiWorkbenchModelControlReference, type AiSceneRequestReadDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError } from './ai-task.repository';
import { conversationCommand } from './conversation-contract';
import { composePersistedTaskAuthorization } from './task-authorization.composition';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { AiOriginalSceneResultService } from './scenes/original-scene-result.service';
import { AiConversationRepository } from './conversation.repository';
import { AiWorkbenchDisplayOriginalReader } from './workbench-display-original.reader';
import { PrismaTaskPlanInputSource } from './runner/prisma-task-plan-input.source';
import { PrismaGatewayInvocationBindings } from './budget/prisma-gateway-invocation-bindings';
import { PrismaGatewayAccountingFacts } from './budget/prisma-gateway-accounting-facts';
import { PrismaModelStepEvidenceAuthority } from './model-input/prisma-model-step-evidence.authority';
import { WorkbenchModelControlRepository } from './workbench-model-control.repository';
import { WorkbenchModelControlSource } from './workbench-model-control.source';
import { WorkbenchModelControlService, type WorkbenchModelControlDependencies } from './workbench-model-control.service';
import { composeOriginalSceneKnowledge, type AiOriginalSceneKnowledgeOptions } from './scenes/original-scene-knowledge';
import { WORKBENCH_MODEL_CONTROL_ACTION } from './workbench-model-control.contract';

export const AI_WORKBENCH_MODEL_CONTROL_REQUESTS = Symbol('AI_WORKBENCH_MODEL_CONTROL_REQUESTS');
type Action = 'model-control-prepare' | 'model-control' | 'model-control-read';
type Request = { headers: { authorization?: unknown } };
type BuildInput = Parameters<WorkbenchModelControlDependencies['build']>[0];
export interface WorkbenchModelControlOptions {
  available(sceneCode: string): boolean;
  readOrderAnswer?(request: Request, original: AiSceneRequestReadDraft): Promise<unknown>;
  knowledge?: AiOriginalSceneKnowledgeOptions;
  build(input: AiOriginalSceneDependencies, control: BuildInput): ReturnType<WorkbenchModelControlDependencies['build']>;
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const resultQuery = z.object({ taskId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  resultId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
const lineageQuery = resultQuery.pick({ taskId: true }).extend({
  runId: resultQuery.shape.taskId, originRunId: resultQuery.shape.taskId }).strict();

export function composeWorkbenchModelControlRequests(dependencies: Omit<AiOriginalSceneDependencies, 'credentials'>,
  options: WorkbenchModelControlOptions) {
  const call = async (request: Request, action: Action | 'original-result' | 'original-lineage', value: unknown, signal?: AbortSignal) => {
    const header = request?.headers?.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)) throw denied();
    if (!['model-control-prepare', 'model-control', 'model-control-read', 'original-result', 'original-lineage'].includes(action)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = action === 'original-lineage' ? lineageQuery.parse(structuredClone(value))
      : action === 'original-result' ? resultQuery.parse(structuredClone(value))
      : action === 'model-control' ? conversationCommand('AiWorkbenchModelControlCommand', value)
      : action === 'model-control-read' ? conversationCommand('AiWorkbenchModelControlReference', value)
      : conversationCommand('AiWorkbenchDisplayReadDraft', value);
    const requestId = randomUUID(); let active = !signal?.aborted;
    const close = () => { active = false; }; signal?.addEventListener('abort', close, { once: true });
    try {
      return await runWithRequestIdentity({}, async () => {
        const input = { ...dependencies, credentials: { current: async () => {
          if (!active) throw denied(); return { authorization: header, audience: 'operator' as const, requestId };
        } } }, clock = input.clock ?? (() => new Date());
        const authorization = composePersistedTaskAuthorization(input), scenes = composeAiOriginalScenes(input);
        const assertGenerationCurrent = (sceneCode: string) => { if (!options.available(sceneCode)) throw unavailable(); };
        const conversation = new AiConversationRepository(input, scenes.requests);
        let rootAnswerReader: AiWorkbenchDisplayOriginalReader | undefined;
        const repository = new WorkbenchModelControlRepository(input.db, authorization.authority, clock, assertGenerationCurrent,
          options.readOrderAnswer ? { async readOriginal(reference) {
            if (!rootAnswerReader) throw unavailable();
            const access = await authorization.tasks.resolveAccess(reference.taskId, 'read_step_terminal');
            const task = await input.db.aiTask.findFirst({ where: access.where });
            if (!task?.inputRef || task.sceneCode !== 'order_explanation') throw denied();
            const turns = await input.db.aiConversationTurn.findMany({ where: { scopeId: task.scopeId,
              ownerId: task.ownerId, originalRequestId: task.inputRef }, take: 2 });
            if (turns.length !== 1) throw unavailable();
            const original = await rootAnswerReader.read({ draftVersion: AI_CONVERSATION_DRAFT_VERSION,
              conversationId: turns[0].conversationId, admissionKey: turns[0].admissionKey, resultId: reference.resultId });
            if (original.task.taskId !== reference.taskId || original.model.step.runId !== reference.runId
              || original.model.step.id !== reference.stepId || original.model.inputRef !== reference.inputId
              || original.model.result.id !== reference.resultId) throw denied();
            return original;
          } } : undefined);
        const current = await repository.current(command.taskId);
        if (!['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(current.task.sceneCode)) throw denied();
        const policy = { sceneCode: current.task.sceneCode, maxOutputTokens: 32768 };
        const plans = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
          'ai.model.text', undefined, policy);
        const bindings = new PrismaGatewayInvocationBindings(input.db, authorization.scopes, clock, policy);
        const financial = new PrismaGatewayAccountingFacts(input.db, bindings, authorization.scopes,
          { quantity: async () => { throw unavailable(); } }, clock);
        const evidence = new PrismaModelStepEvidenceAuthority(input.db, authorization.authority, plans, policy, financial, clock);
        const knowledge = options.knowledge ? composeOriginalSceneKnowledge(options.knowledge, input, clock) : undefined;
        const observations = new AiOriginalSceneResultService(input.db, authorization.tasks, scenes,
          { ...policy, routeScene: 'chat' }, clock, knowledge, repository.readOrigin.bind(repository));
        const sourceObservations = { readModelResult: (query: unknown) => observations.read(query),
          ...(options.readOrderAnswer ? { readOrderAnswer: (original: AiSceneRequestReadDraft) => options.readOrderAnswer!(request, original) } : {}) };
        // The root answer reader must not recurse through the control repository
        // whose parent proof it supplies. Its fixed three-step branch is enough.
        rootAnswerReader = new AiWorkbenchDisplayOriginalReader({ db: input.db, scopes: authorization.scopes,
          conversations: conversation, originals: scenes.requests, tasks: authorization.tasks, evidence, policy,
          observations: sourceObservations });
        if (action === 'original-lineage') {
          const query = lineageQuery.parse(command);
          if (!current.task.inputRef) throw unavailable();
          const read = (access: typeof current.access) => input.db.$transaction(tx => repository.readOrigin(tx, access,
            { scopeId: current.task.scopeId, taskId: current.task.id, runId: query.runId, originRunId: query.originRunId,
              registrationRef: `scene-model:${current.task.inputRef}`, includeHistory: true }), { isolationLevel: 'RepeatableRead' });
          const origin = await read(current.access), after = await repository.current(query.taskId);
          if (after.identityHash !== current.identityHash || after.access.bindingKey !== current.access.bindingKey
            || !isDeepStrictEqual(after.task, current.task) || !isDeepStrictEqual(await read(after.access), origin)) throw denied();
          return origin;
        }
        const originals = new AiWorkbenchDisplayOriginalReader({ db: input.db, scopes: authorization.scopes,
          conversations: conversation, originals: scenes.requests,
          tasks: authorization.tasks, evidence, policy, observations: sourceObservations,
          readRunOrigin: repository.readOrigin.bind(repository) });
        const source = new WorkbenchModelControlSource({ db: input.db, repository, originals });
        if (action === 'original-result') {
          const query = resultQuery.parse(command);
          const artifact = await input.db.aiTaskResultArtifact.findFirst({ where: { scopeId: current.task.scopeId,
            taskId: current.task.id, id: query.resultId }, select: { runId: true } });
          if (!artifact) throw unavailable();
          const operation = await input.db.operationLog.findFirst({ where: { id: artifact.runId,
            userId: current.task.ownerId, action: WORKBENCH_MODEL_CONTROL_ACTION }, select: { id: true } });
          if (!operation) return null;
          if (!current.task.inputRef) throw unavailable();
          const turns = await input.db.aiConversationTurn.findMany({ where: { scopeId: current.task.scopeId,
            ownerId: current.task.ownerId, originalRequestId: current.task.inputRef }, take: 2 });
          if (turns.length !== 1) throw unavailable();
          const material = await originals.read({ draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: turns[0].conversationId,
            admissionKey: turns[0].admissionKey, resultId: query.resultId });
          if (!material.lineage.control || material.model.step.runId !== artifact.runId
            || material.task.taskId !== query.taskId || material.model.result.id !== query.resultId) throw denied();
          return { contractVersion: AI_TASK_DRAFT_VERSION, taskId: query.taskId, runId: artifact.runId, resultId: query.resultId,
            sceneCode: material.observation.sceneCode, status: material.observation.status, text: material.observation.text,
            sources: [], observedAt: material.observation.observedAt, businessExecution: 'not_inferred_from_model_result',
            execution: 'read_only_no_start_no_reconnect_side_effect' };
        }
        const service = new WorkbenchModelControlService({ repository, source, authority: {
          create: async original => {
            // Gate new registration as well as dispatch. An old prepared
            // command cannot leave a new Run when generation is now disabled.
            assertGenerationCurrent(original.sceneCode);
            const grant = await scenes.creationAuthority.create(original);
            assertGenerationCurrent(original.sceneCode);
            return grant;
          },
        },
          build: control => options.build(input, control) });
        if (action === 'model-control-read') return service.read(command as AiWorkbenchModelControlReference);
        if (action === 'model-control') return service.execute(command as AiWorkbenchModelControlCommand, signal);
        if (!options.available(current.task.sceneCode) || current.task.status !== 'SUCCEEDED') throw unavailable();
        const key = { scopeId: current.task.scopeId, taskId: command.taskId };
        const runs = await input.db.aiRun.findMany({ where: key, orderBy: { sequence: 'desc' }, take: 2 });
        const run = runs[0];
        if (!run || runs[1]?.sequence === run.sequence || run.status !== 'SUCCEEDED'
          || run.scopeId !== key.scopeId || run.taskId !== key.taskId
          || run.actorKind !== 'USER' || run.actorId !== current.task.ownerId) throw unavailable();
        const steps = await input.db.aiStep.findMany({ where: { ...key, runId: run.id }, orderBy: { sequence: 'asc' }, take: 4 });
        let step = steps[0];
        if (steps.length !== 1) {
          if (steps.length !== 3 || current.task.sceneCode !== 'order_explanation' || !options.readOrderAnswer
            || !current.task.inputRef || run.sequence !== 1) throw unavailable();
          const inputs = await input.db.aiTaskActionInput.findMany({ where: { ...key, runId: run.id,
            registrationRef: `scene-answer:${current.task.inputRef}` }, take: 2 });
          if (inputs.length !== 1) throw unavailable();
          const answers = steps.filter(item => item.inputRef === inputs[0].id && item.requestFingerprint === inputs[0].fingerprint);
          if (answers.length !== 1) throw unavailable();
          step = answers[0];
        }
        if (!step || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== run.id
          || step.status !== 'SUCCEEDED' || step.toolCode !== 'ai.model.text' || !step.resultRef) throw unavailable();
        const selected = { taskId: command.taskId, operationId: 'source-preview', kind: 'reinterpret' as const,
          expectedTaskRevision: current.task.revision, sourceRunId: run.id, sourceResultId: step.resultRef,
          expectedPresentationRevision: run.sequence };
        await source.prepare(selected);
        const after = await repository.current(command.taskId);
        if (after.identityHash !== current.identityHash || after.access.bindingKey !== current.access.bindingKey
          || !isDeepStrictEqual(after.task, current.task)) throw denied();
        assertGenerationCurrent(current.task.sceneCode);
        const { operationId: _operation, kind: _kind, ...original } = selected;
        return { version: AI_WORKBENCH_MODEL_CONTROL_VERSION, ...original,
          kinds: ['reinterpret', 'reformat'], semantics: 'current_original_source_not_model_permission' } satisfies AiWorkbenchModelControlPreparation;
      });
    } finally { close(); signal?.removeEventListener('abort', close); }
  };
  return { consume: (request: Request, action: Action, value: unknown, signal?: AbortSignal) => call(request, action, value, signal),
    /** Server-only task result port. It never prepares or executes a control. */
    readResult: (request: Request, value: unknown, signal?: AbortSignal) => call(request, 'original-result', value, signal),
    /** Server-only lineage proof. It does not use the new-generation window. */
    readLineage: (request: Request, value: unknown, signal?: AbortSignal) => call(request, 'original-lineage', value, signal) };
}
