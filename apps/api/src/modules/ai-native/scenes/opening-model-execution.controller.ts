/** Opening diagnosis delegates to the original persistent model application.
 * This host cannot approve proposals, publish settings or accept model/lease input. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AI_OPENING_MODEL_EXECUTION_HTTP_DRAFT as routes } from '@rental-os/shared';
import type { composeRequestBoundPersistedOriginalSceneModel, AiSceneHttpRequest } from './request-bound-scenes.application';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';
import { respondAiScene } from './original-scenes.controller';

export const AI_ORIGINAL_OPENING_MODEL_REQUESTS = Symbol('AI_ORIGINAL_OPENING_MODEL_REQUESTS');
export type OpeningModelRequests = Pick<ReturnType<typeof composeRequestBoundPersistedOriginalSceneModel>,
  'start' | 'recover' | 'reconcile' | 'takeover' | 'requestCancel' | 'readExecution'>;
type Request = AiSceneHttpRequest & AiRequestAbortSource;

@Controller(routes.basePath)
export class AiOriginalOpeningModelExecutionController {
  constructor(@Inject(AI_ORIGINAL_OPENING_MODEL_REQUESTS) private readonly requests: OpeningModelRequests) {}
  @Post(routes.start) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: Request, @Body() value: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.start(request, value, signal)), 'read_execution');
  }
  @Post(routes.recover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  recover(@Req() request: Request, @Body() value: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.recover(request, value, signal)), 'read_execution');
  }
  @Post(routes.reconcile) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: Request, @Body() value: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.reconcile(request, value, signal)), 'read_execution');
  }
  @Post(routes.takeover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  takeover(@Req() request: Request, @Body() value: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.takeover(request, value, signal)), 'read_takeover_receipt');
  }
  @Post(routes.requestCancel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancel(@Req() request: Request, @Body() value: unknown) {
    return respondAiScene(() => withRequestAbort(request, () => this.requests.requestCancel(request, value), { maxWaitMs: 15000 }), 'read_cancellation_receipt');
  }
  @Post(routes.readExecution) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readExecution(@Req() request: Request, @Body() value: unknown) {
    return respondAiScene(() => withRequestAbort(request, () => this.requests.readExecution(request, value), { maxWaitMs: 15000 }), 'read_execution');
  }
}
