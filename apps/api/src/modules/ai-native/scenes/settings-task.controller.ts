import { Body, Controller, Header, Inject, Post, Req, HttpException } from '@nestjs/common';
import { AI_SCENE_MODEL_HTTP_DRAFT as routes } from '@rental-os/shared';
import type { AiSceneHttpRequest, composeRequestBoundOriginalSceneModel, composeRequestBoundSettingsTaskCreation,
  composeRequestBoundSettingsTaskControls, composeRequestBoundSettingsChanges } from './request-bound-scenes.application';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';
import { settingsContract } from '../approval-execution/approved-settings-contracts';
import type { composeRequestBoundSettingsTaskReads } from './settings-task-read.composition';

export const AI_SETTINGS_TASK_HTTP_REQUESTS = Symbol('AI_SETTINGS_TASK_HTTP_REQUESTS');
export const AI_SETTINGS_TASK_CREATION_REQUESTS = Symbol('AI_SETTINGS_TASK_CREATION_REQUESTS');
export const AI_SETTINGS_TASK_CONTROL_REQUESTS = Symbol('AI_SETTINGS_TASK_CONTROL_REQUESTS');
export const AI_SETTINGS_CHANGE_REQUESTS = Symbol('AI_SETTINGS_CHANGE_REQUESTS');
export const AI_SETTINGS_TASK_READ_REQUESTS = Symbol('AI_SETTINGS_TASK_READ_REQUESTS');
@Controller(routes.basePath)
export class AiSettingsTaskReadController {
  constructor(@Inject(AI_SETTINGS_TASK_READ_REQUESTS) private readonly reads: ReturnType<typeof composeRequestBoundSettingsTaskReads>) {}
  @Post(routes.readOriginalSettingsSnapshot) @Header('Cache-Control', 'no-store')
  readSnapshot(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.reads.readSnapshot(request, body), 'read_settings_task_creation');
  }
  @Post(routes.readOriginalSettingsEvents) @Header('Cache-Control', 'no-store')
  readEvents(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.reads.readEvents(request, body), 'read_settings_task_creation');
  }
}
@Controller(routes.basePath)
export class AiSettingsChangeController {
  constructor(@Inject(AI_SETTINGS_CHANGE_REQUESTS) private readonly changes: ReturnType<typeof composeRequestBoundSettingsChanges>) {}
  private respond<T>(work: () => Promise<T>) {
    return respondAiScene(async () => {
      try { return await work(); }
      catch (error) {
        // Original Core validation/CAS errors have no public AI code. Preserve
        // their refusal semantics without exposing domain messages or fields.
        if (error instanceof HttpException && [400, 409].includes(error.getStatus())) {
          const code = error.getStatus() === 400 ? 'AI_INVALID_INPUT' : 'AI_REVISION_CONFLICT';
          throw Object.assign(new Error(code), { code });
        }
        throw error;
      }
    }, 'read_change_receipt');
  }
  @Post(routes.readCurrentSettings) @Header('Cache-Control', 'no-store')
  readCurrent(@Req() request: AiSceneHttpRequest) { return this.respond(() => this.changes.readCurrent(request)); }
  @Post(routes.prepareOriginalSettingsChange) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const result = await this.changes.prepare(request, body);
      try { return settingsContract('AiApprovedSettingsChangePreparationResultDraft', result, true); }
      catch {
        // Preparation may already be durable. A malformed acknowledgement is
        // not permission to prepare again under a different operation key.
        throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
      }
    });
  }
  @Post(routes.readOriginalSettingsChange) @Header('Cache-Control', 'no-store')
  readReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.changes.readReceipt(request, body)); }
}
/** Original receipt selects the owned task; the body cannot supply permissions,
 * holder, limits, plan or approval. Configuration remains a guarded CAS action. */
@Controller(routes.basePath)
export class AiSettingsTaskControlController {
  constructor(@Inject(AI_SETTINGS_TASK_CONTROL_REQUESTS) private readonly controls: ReturnType<typeof composeRequestBoundSettingsTaskControls>) {}
  @Post(routes.requestOriginalSettingsCancellation) @Header('Cache-Control', 'no-store')
  requestCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.controls.requestCancellation(request, body), 'read_original_settings_cancellation');
  }
  @Post(routes.readOriginalSettingsCancellation) @Header('Cache-Control', 'no-store')
  readCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.controls.readCancellation(request, body));
  }
  @Post(routes.settleUnstartedSettingsCancellation) @Header('Cache-Control', 'no-store')
  settleUnstartedCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.controls.settleUnstartedCancellation(request, body), 'read_original_settings_cancellation_settlement');
  }
  @Post(routes.readOriginalSettingsCancellationSettlement) @Header('Cache-Control', 'no-store')
  readCancellationSettlement(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.controls.readCancellationSettlement(request, body));
  }
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
