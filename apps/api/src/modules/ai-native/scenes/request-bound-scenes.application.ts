import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from '../task-request/prisma-quote-selection.repository';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { composeHumanQuoteOrder, type HumanQuoteOrderDependencies } from './human-quote-order.composition';

export type AiSceneHttpRequest = { headers: { authorization?: unknown } };
export type AiSceneRequestOptions = { enabled: boolean; audience: 'operator' | 'staff' };
export type RequestBoundOriginalSceneDependencies = Omit<AiOriginalSceneDependencies, 'credentials'>;
export type RequestBoundQuoteSelectionDependencies = RequestBoundOriginalSceneDependencies & Omit<HumanQuoteSelectionDependencies, 'credentials' | 'originals'>;
export type RequestBoundQuoteOrderDependencies = RequestBoundOriginalSceneDependencies & Omit<HumanQuoteOrderDependencies, 'credentials' | 'originals'>;
const optionsSchema = z.object({ enabled: z.literal(true), audience: z.enum(['operator', 'staff']) }).strict();
const bearerSchema = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

function bindRequests<D extends object, A>(dependencies: D, options: AiSceneRequestOptions,
  compose: (input: D & { credentials: AiTaskCredentialSource }) => A) {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success || 'credentials' in dependencies || 'originals' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const server = { ...dependencies }, { audience } = parsed.data;
  return async <R>(request: AiSceneHttpRequest, value: unknown, consume: (app: A, command: unknown) => Promise<R>): Promise<R> => {
    const header = bearerSchema.safeParse(request?.headers?.authorization);
    if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const command = structuredClone(value), credential = Object.freeze({ authorization: header.data, audience, requestId: randomUUID() });
    let active = true;
    try {
      return await runWithRequestIdentity({}, () => consume(compose({ ...server, credentials: {
        current: async () => {
          if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          return { ...credential };
        }
      } }), command));
    } finally { active = false; }
  };
}

export function composeRequestBoundOriginalScenes(dependencies: RequestBoundOriginalSceneDependencies, options: AiSceneRequestOptions) {
  const call = bindRequests(dependencies, options, composeAiOriginalScenes);
  return Object.freeze({
    create: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.create(command)),
    read: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.read(command)),
    reissue: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reissue(command)),
    reconcile: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command)),
    reconcileReissue: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command, true)),
    createTask: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.createTask(command)),
    prepareTaskMaterial: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.prepareTaskMaterial(command)),
    readRecovery: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readRecovery(command))
  });
}

export function composeRequestBoundQuoteSelections(dependencies: RequestBoundQuoteSelectionDependencies, options: AiSceneRequestOptions) {
  const call = bindRequests(dependencies, options, input => new PrismaQuoteSelectionRepository({ ...input,
    originals: composeAiOriginalScenes(input).requests }));
  return Object.freeze({
    select: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.select(command)),
    read: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.read(command)),
    reconcile: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command))
  });
}

export function composeRequestBoundHumanQuoteOrder(dependencies: RequestBoundQuoteOrderDependencies, options: AiSceneRequestOptions) {
  const call = bindRequests(dependencies, options, input => composeHumanQuoteOrder({ ...input,
    originals: composeAiOriginalScenes(input).requests }));
  return Object.freeze({
    readSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedProposal(command)),
    decideSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.decideSelectedProposal(command)),
    readSelectedDecisionReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedDecisionReceipt(command)),
    readSelectedReprepareEligibility: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedReprepareEligibility(command))
  });
}
