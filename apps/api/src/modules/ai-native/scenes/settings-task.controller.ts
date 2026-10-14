import { Body, Controller, Header, Inject, Post, Req } from '@nestjs/common';
import { AI_SCENE_MODEL_HTTP_DRAFT as routes } from '@rental-os/shared';
import type { AiSceneHttpRequest, composeRequestBoundOriginalSceneModel, composeRequestBoundSettingsTaskCreation,
  composeRequestBoundSettingsTaskControls } from './request-bound-scenes.application';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';

export const AI_SETTINGS_TASK_HTTP_REQUESTS = Symbol('AI_SETTINGS_TASK_HTTP_REQUESTS');
export const AI_SETTINGS_TASK_CREATION_REQUESTS = Symbol('AI_SETTINGS_TASK_CREATION_REQUESTS');
export const AI_SETTINGS_TASK_CONTROL_REQUESTS = Symbol('AI_SETTINGS_TASK_CONTROL_REQUESTS');
/** Original receipt selects the owned task; the body cannot supply permissions,
 * holder, limits, plan or approval. Configuration remains a guarded CAS action. */
@Controller(routes.basePath)
export class AiSettingsTaskControlController {
  constructor(@Inject(AI_SETTINGS_TASK_CONTROL_REQUESTS) private readonly controls: ReturnType<typeof composeRequestBoundSettingsTaskControls>) {}
  @Post(routes.readSettingsTaskPolicy) @Header('Cache-Control', 'no-store')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.controls.readPolicy(request, body));
  }
  @Post(routes.configureSettingsTaskPolicy) @Header('Cache-Control', 'no-store')
  configure(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.controls.configurePolicy(request, body), 'read_settings_task_policy');
  }
  @Post(routes.clearSettingsTaskPolicy) @Header('Cache-Control', 'no-store')
  clear(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.controls.clearPolicy(request, body), 'read_settings_task_policy');
  }
  @Post(routes.startOriginalSettingsTask) @Header('Cache-Control', 'no-store')
  start(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.controls.start(request, body, signal)));
  }
}
/** Metadata producer only. This neither publishes a run plan nor starts work. */
@Controller(routes.basePath)
export class AiSettingsTaskCreationController {
  constructor(@Inject(AI_SETTINGS_TASK_CREATION_REQUESTS) private readonly creation: ReturnType<typeof composeRequestBoundSettingsTaskCreation>) {}
  @Post(routes.createSettingsTask) @Header('Cache-Control', 'no-store')
  create(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.creation.create(request, body), 'read_settings_task_creation');
  }
  @Post(routes.readSettingsTaskCreation) @Header('Cache-Control', 'no-store')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.creation.read(request, body), 'read_settings_task_creation');
  }
}
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
