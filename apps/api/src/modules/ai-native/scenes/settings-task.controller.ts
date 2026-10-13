import { Body, Controller, Header, Inject, Post, Req } from '@nestjs/common';
import { AI_SCENE_MODEL_HTTP_DRAFT as routes } from '@rental-os/shared';
import type { AiSceneHttpRequest, composeRequestBoundOriginalSceneModel } from './request-bound-scenes.application';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';

export const AI_SETTINGS_TASK_HTTP_REQUESTS = Symbol('AI_SETTINGS_TASK_HTTP_REQUESTS');
export const settingsTaskHttpMethods = Object.freeze(['startSettingsTask', 'readSettingsConfirmation',
  'decideSettingsProposal', 'readSettingsDecision', 'continueSettingsConfirmation', 'reconcileSettingsTask', 'cancelSettingsTask'] as const);
/** Request-bound port only. No model runtime, raw lease, approval grant or Core
 * write is supplied by this Controller; the existing application owns them. */
export type SettingsTaskHttpRequests = Pick<ReturnType<typeof composeRequestBoundOriginalSceneModel>, typeof settingsTaskHttpMethods[number]>;
type RunRequest = AiSceneHttpRequest & AiRequestAbortSource;

@Controller(routes.basePath)
export class AiSettingsTaskController {
  constructor(@Inject(AI_SETTINGS_TASK_HTTP_REQUESTS) private readonly requests: SettingsTaskHttpRequests) {}
  @Post(routes.startSettingsTask) @Header('Cache-Control', 'no-store')
  startSettingsTask(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.startSettingsTask(request, body, signal)));
  }
  @Post(routes.readSettingsConfirmation) @Header('Cache-Control', 'no-store')
  readSettingsConfirmation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.requests.readSettingsConfirmation(request, body));
  }
  @Post(routes.decideSettingsProposal) @Header('Cache-Control', 'no-store')
  decideSettingsProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.requests.decideSettingsProposal(request, body), 'read_decision_receipt');
  }
  @Post(routes.readSettingsDecision) @Header('Cache-Control', 'no-store')
  readSettingsDecision(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.requests.readSettingsDecision(request, body), 'read_decision_receipt');
  }
  @Post(routes.continueSettingsConfirmation) @Header('Cache-Control', 'no-store')
  continueSettingsConfirmation(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.continueSettingsConfirmation(request, body, signal)));
  }
  @Post(routes.reconcileSettingsTask) @Header('Cache-Control', 'no-store')
  reconcileSettingsTask(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.reconcileSettingsTask(request, body, signal)));
  }
  @Post(routes.cancelSettingsTask) @Header('Cache-Control', 'no-store')
  cancelSettingsTask(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.requests.cancelSettingsTask(request, body));
  }
}
