/** Operator request composition for explicit model-only controls and receipts.
 * Reads use original sources; only a new recorded control builds the existing
 * Task host. No business rerun, new Task, approval or budget reset is provided. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AI_WORKBENCH_MODEL_CONTROL_VERSION, type AiWorkbenchModelControlPreparation,
  type AiWorkbenchModelControlCommand, type AiWorkbenchModelControlReference } from '@rental-os/shared';
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

export const AI_WORKBENCH_MODEL_CONTROL_REQUESTS = Symbol('AI_WORKBENCH_MODEL_CONTROL_REQUESTS');
type Action = 'model-control-prepare' | 'model-control' | 'model-control-read';
type Request = { headers: { authorization?: unknown } };
type BuildInput = Parameters<WorkbenchModelControlDependencies['build']>[0];
export interface WorkbenchModelControlOptions {
  available(sceneCode: string): boolean;
  knowledge?: AiOriginalSceneKnowledgeOptions;
  build(input: AiOriginalSceneDependencies, control: BuildInput): ReturnType<WorkbenchModelControlDependencies['build']>;
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

export function composeWorkbenchModelControlRequests(dependencies: Omit<AiOriginalSceneDependencies, 'credentials'>,
  options: WorkbenchModelControlOptions) {
  return { async consume(request: Request, action: Action, value: unknown, signal?: AbortSignal) {
    const header = request?.headers?.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)) throw denied();
    if (!['model-control-prepare', 'model-control', 'model-control-read'].includes(action)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = action === 'model-control' ? conversationCommand('AiWorkbenchModelControlCommand', value)
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
        const repository = new WorkbenchModelControlRepository(input.db, authorization.authority, clock);
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
        const originals = new AiWorkbenchDisplayOriginalReader({ db: input.db, scopes: authorization.scopes,
          conversations: new AiConversationRepository(input, scenes.requests), originals: scenes.requests,
          tasks: authorization.tasks, evidence, policy, observations: { readModelResult: query => observations.read(query) },
          readRunOrigin: repository.readOrigin.bind(repository) });
        const source = new WorkbenchModelControlSource({ db: input.db, repository, originals });
        const service = new WorkbenchModelControlService({ repository, source, authority: {
          create: async original => {
            // Gate new registration as well as dispatch. An old prepared
            // command cannot leave a new Run when generation is now disabled.
            if (!options.available(original.sceneCode)) throw unavailable();
            const grant = await scenes.creationAuthority.create(original);
            if (!options.available(original.sceneCode)) throw unavailable();
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
        const steps = await input.db.aiStep.findMany({ where: { ...key, runId: run.id }, take: 2 });
        const step = steps[0];
        if (steps.length !== 1 || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== run.id
          || step.status !== 'SUCCEEDED' || step.toolCode !== 'ai.model.text' || !step.resultRef) throw unavailable();
        const selected = { taskId: command.taskId, operationId: 'source-preview', kind: 'reinterpret' as const,
          expectedTaskRevision: current.task.revision, sourceRunId: run.id, sourceResultId: step.resultRef,
          expectedPresentationRevision: run.sequence };
        await source.prepare(selected);
        const after = await repository.current(command.taskId);
        if (after.identityHash !== current.identityHash || after.access.bindingKey !== current.access.bindingKey
          || !isDeepStrictEqual(after.task, current.task)) throw denied();
        const { operationId: _operation, kind: _kind, ...original } = selected;
        return { version: AI_WORKBENCH_MODEL_CONTROL_VERSION, ...original,
          kinds: ['reinterpret', 'reformat'], semantics: 'current_original_source_not_model_permission' } satisfies AiWorkbenchModelControlPreparation;
      });
    } finally { close(); signal?.removeEventListener('abort', close); }
  } };
}
