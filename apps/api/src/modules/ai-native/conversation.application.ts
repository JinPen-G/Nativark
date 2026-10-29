/** Opt-in operator conversation transport. Current Auth/ALS and original scene
 * policies remain mandatory; the provider cannot generate, publish plans or
 * execute a Task. Disabled construction is inert, never an empty-success stub. */
import { randomUUID } from 'node:crypto';
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AI_CONVERSATION_HTTP_DRAFT } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { AiConversationRepository } from './conversation.repository';
import { conversationCommand, conversationResponse } from './conversation-contract';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import type { composeRequestBoundOriginalTaskRecoveryReaders } from './scenes/request-bound-scenes.application';

type Request = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
type Action = keyof typeof AI_CONVERSATION_HTTP_DRAFT.operations;
export const AI_CONVERSATION_REQUESTS = Symbol('AI_CONVERSATION_REQUESTS');
export function composeAiConversationRequests(dependencies: Omit<AiOriginalSceneDependencies, 'credentials'>, enabled = false,
  observations?: Pick<ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>, 'readModelResult'>) {
  return { async consume(request: Request, action: Action, value: unknown, signal?: AbortSignal) {
    if (!enabled || 'credentials' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (!Object.hasOwn(AI_CONVERSATION_HTTP_DRAFT.operations, action)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const contract = AI_CONVERSATION_HTTP_DRAFT.operations[action], header = request?.headers?.authorization;
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const command = conversationCommand(contract.request, value), requestId = randomUUID();
    let active = !signal?.aborted;
    const close = () => { active = false; };
    signal?.addEventListener('abort', close, { once: true });
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        const input = { ...dependencies, credentials: { current: async () => {
          if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          return { authorization: header, audience: 'operator' as const, requestId };
        } } };
        const root = composeAiOriginalScenes(input), app = new AiConversationRepository(input, root.requests), supplied = structuredClone(command);
        const result = action === 'archive' || action === 'delete' ? await app.mutate(supplied, action)
          : action === 'operation' ? await app.readOperation(supplied)
          : action === 'admission' ? await app.readAdmission(supplied)
          : action === 'release' ? await app.releaseTurn(supplied)
          : action === 'modelResult' ? await app.modelResult(supplied, { readModelResult: command => {
            if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            if (!observations) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
            return observations.readModelResult({ headers: { authorization: header } }, command);
          } })
          : await app[action](supplied);
        return conversationResponse(action, result, command);
      }), contract.write, signal);
    } finally { close(); signal?.removeEventListener('abort', close); }
  } };
}
@Controller(AI_CONVERSATION_HTTP_DRAFT.basePath)
export class AiConversationController {
  constructor(@Inject(AI_CONVERSATION_REQUESTS) private readonly requests: ReturnType<typeof composeAiConversationRequests>) {}
  private call(request: Request, action: Action, value: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.consume(request, action, value, signal), { maxWaitMs: 15000 }),
      action === 'admit' ? 'read_original_admission' : 'read_original_operation');
  }
  @Post('create') @HttpCode(200) @Header('Cache-Control', 'no-store')
  create(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'create', value); }
  @Post('read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'read', value); }
  @Post('list') @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'list', value); }
  @Post('archive') @HttpCode(200) @Header('Cache-Control', 'no-store')
  archive(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'archive', value); }
  @Post('delete') @HttpCode(200) @Header('Cache-Control', 'no-store')
  delete(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'delete', value); }
  @Post('operation') @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'operation', value); }
  @Post('admit') @HttpCode(200) @Header('Cache-Control', 'no-store')
  admit(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'admit', value); }
  @Post('admission') @HttpCode(200) @Header('Cache-Control', 'no-store')
  admission(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'admission', value); }
  @Post('turns') @HttpCode(200) @Header('Cache-Control', 'no-store')
  turns(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'turns', value); }
  @Post('release') @HttpCode(200) @Header('Cache-Control', 'no-store')
  release(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'release', value); }
  @Post('modelResult') @HttpCode(200) @Header('Cache-Control', 'no-store')
  modelResult(@Req() request: Request, @Body() value: unknown) { return this.call(request, 'modelResult', value); }
}
