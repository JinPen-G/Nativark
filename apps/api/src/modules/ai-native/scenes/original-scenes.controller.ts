import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { withRequestAbort } from './request-abort';
import type { composeRequestBoundOriginalScenes, composeRequestBoundOriginalSceneModel,
  composeRequestBoundPersistedOriginalSceneModel, composeRequestBoundOriginalTaskActionPolicies,
  composeRequestBoundScenePlanPolicies, composeRequestBoundOriginalTaskRecoveryReaders, AiSceneHttpRequest } from './request-bound-scenes.application';
import { AI_SCENE_REQUEST_HTTP_DRAFT, AI_SCENE_MODEL_HTTP_DRAFT, AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT,
  AI_SCENE_PLAN_POLICY_HTTP_DRAFT } from '@rental-os/shared';

export const AI_ORIGINAL_SCENES = Symbol('AI_ORIGINAL_SCENES');
export const AI_ORIGINAL_SCENE_REQUESTS = Symbol('AI_ORIGINAL_SCENE_REQUESTS');
export const AI_ORIGINAL_SCENE_MODEL_REQUESTS = Symbol('AI_ORIGINAL_SCENE_MODEL_REQUESTS');
export const AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS = Symbol('AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS');
export const AI_ORIGINAL_TASK_ACTION_POLICIES = Symbol('AI_ORIGINAL_TASK_ACTION_POLICIES');
export const AI_SCENE_PLAN_POLICIES = Symbol('AI_SCENE_PLAN_POLICIES');
export const AI_ORIGINAL_SCENE_RECOVERY_REQUESTS = Symbol('AI_ORIGINAL_SCENE_RECOVERY_REQUESTS');
type Scenes = ReturnType<typeof composeRequestBoundOriginalScenes>;
export async function respondAiScene<T>(work: () => Promise<T>, unknownAction = 'reconcile') {
  try { return await work(); }
  catch (error) {
    const response = error instanceof HttpException ? error.getResponse() : undefined;
    // Preserve only the known public code, never an arbitrary exception body,
    // message, stack, request content or provider details.
    const rawCode = response && typeof response === 'object' && 'code' in response ? response.code
      : error instanceof Error && 'code' in error ? error.code : 'AI_STORAGE_UNAVAILABLE';
    const gatewayCodes: Record<string, string> = { FORBIDDEN: 'AI_ACCESS_DENIED', INVALID_REQUEST: 'AI_INVALID_INPUT',
      CONFIG_INVALID: 'AI_RESOURCE_UNAVAILABLE', CAPABILITY_UNSUPPORTED: 'AI_RESOURCE_UNAVAILABLE', INVALID_RESPONSE: 'AI_RESOURCE_UNAVAILABLE' };
    const code = typeof rawCode === 'string' && Object.prototype.hasOwnProperty.call(gatewayCodes, rawCode) ? gatewayCodes[rawCode] : rawCode;
    const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403, AI_SCOPE_CHANGED: 403,
      AI_RESOURCE_UNAVAILABLE: 404, AI_REVISION_CONFLICT: 409, AI_STORAGE_UNAVAILABLE: 503, AI_RESULT_UNKNOWN: 409 };
    const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(statuses, code) ? code : 'AI_STORAGE_UNAVAILABLE';
    throw new HttpException({ code: known, retryable: false, ...(known === 'AI_RESULT_UNKNOWN' ? { nextAction: unknownAction } : {}) }, statuses[known]);
  }
}
type SceneRunHttpRequest = AiSceneHttpRequest & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
@Controller(AI_SCENE_PLAN_POLICY_HTTP_DRAFT.basePath)
export class AiScenePlanPolicyController {
  constructor(@Inject(AI_SCENE_PLAN_POLICIES) private readonly application: ReturnType<typeof composeRequestBoundScenePlanPolicies>) {}
  @Post(AI_SCENE_PLAN_POLICY_HTTP_DRAFT.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.application.read(request, body), 'read_original_scene_plan_policy');
  }
  @Post(AI_SCENE_PLAN_POLICY_HTTP_DRAFT.change) @HttpCode(200) @Header('Cache-Control', 'no-store')
  change(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.application.change(request, body), 'read_original_scene_plan_policy');
  }
}
@Controller(AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.basePath)
export class AiOriginalTaskActionPolicyController {
  constructor(@Inject(AI_ORIGINAL_TASK_ACTION_POLICIES)
    private readonly application: ReturnType<typeof composeRequestBoundOriginalTaskActionPolicies>) {}
  @Post(AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.configure) @HttpCode(200) @Header('Cache-Control', 'no-store')
  configure(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.application.configure(request, body), 'read_original_task_action_policy');
  }
  @Post(AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.clear) @HttpCode(200) @Header('Cache-Control', 'no-store')
  clear(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.application.clear(request, body), 'read_original_task_action_policy');
  }
  @Post(AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.application.read(request, body), 'read_original_task_action_policy');
  }
}
@Controller(AI_SCENE_REQUEST_HTTP_DRAFT.basePath)
export class AiOriginalScenesController {
  constructor(@Inject(AI_ORIGINAL_SCENE_REQUESTS) private readonly scenes: Scenes) {}
  private readonly respond = respondAiScene;
  @Post()
  create(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.create(request, body)); }
  @Post('read')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.read(request, body)); }
  @Post('reissue')
  reissue(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.reissue(request, body)); }
  @Post('reconcile')
  reconcile(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.reconcile(request, body)); }
  @Post('reconcile-reissue')
  reconcileReissue(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.reconcileReissue(request, body)); }
  @Post('create-task')
  createTask(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.createTask(request, body)); }
  @Post('material')
  material(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.prepareTaskMaterial(request, body)); }
  @Post('recovery')
  recovery(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.readRecovery(request, body)); }
  /** Read current preparation for the stored original request, never quote creation. */
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.quoteReview)
  quoteReview(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.reviewQuote(request, body)); }
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.quoteConfirm)
  quoteConfirm(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.confirmQuote(request, body)); }
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.quoteReceipt)
  quoteReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return this.respond(() => this.scenes.readQuoteReceipt(request, body)); }
}

/** Shared original recovery transport. Mount this OR an execution controller
 * at this prefix, never both. It has no start/recover/resume/approval methods. */
@Controller(AI_SCENE_MODEL_HTTP_DRAFT.basePath)
export class AiOriginalSceneRecoveryController {
  constructor(@Inject(AI_ORIGINAL_SCENE_RECOVERY_REQUESTS)
    private readonly observations: ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>) {}
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readRecoverySnapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readRecoverySnapshot(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readRecoverySnapshot(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTakeoverReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTakeoverReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readTakeoverReceipt(request, body), 'read_takeover_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readCancellationReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readCancellationReceipt(request, body), 'read_cancellation_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.requestCancellationIntent) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancellationIntent(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.requestCancellationIntent(request, body), 'read_cancellation_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readCancellationSettlementReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationSettlementReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readCancellationSettlementReceipt(request, body), 'read_cancellation_settlement_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.settleUnstartedCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleUnstartedCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.settleUnstartedCancellation(request, body), 'read_cancellation_settlement_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readModelResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readModelResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readModelResult(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.reopenModelSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reopenModelSource(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.reopenModelSource(request, body));
  }
}

/** No root-module registration. The server must provide the actual authorized
 * runner/Gateway/financial evidence assembly; request bodies cannot do so. */
@Controller(AI_SCENE_MODEL_HTTP_DRAFT.basePath)
export class AiOriginalSceneModelActionsController extends AiOriginalSceneRecoveryController {
  constructor(@Inject(AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS)
    protected readonly model: ReturnType<typeof composeRequestBoundPersistedOriginalSceneModel>) { super(model); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.start)
  start(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.start(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readInput)
  readInput(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.readInput(request, body)); }
  /** Refresh only the waiting question. An unknown COMMIT is read back through
   * input, never resume/reconcile execution or resubmit a stale refresh. */
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.refreshInput)
  refreshInput(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.model.refreshInput(request, body), 'read_input');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.resume)
  resume(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.resume(request, body, signal)), 'read_answer');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readAnswer)
  readAnswer(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.model.readAnswer(request, body), 'read_answer');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.continueAnswer)
  continueAnswer(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.continueAnswer(request, body, signal)), 'read_answer');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readQuotePreparation)
  readQuotePreparation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.model.readQuotePreparation(request, body), 'read_answer');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.confirmClarifiedQuote)
  confirmClarifiedQuote(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.model.confirmClarifiedQuote(request, body), 'read_clarified_quote_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readClarifiedQuoteReceipt)
  readClarifiedQuoteReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.model.readClarifiedQuoteReceipt(request, body), 'read_clarified_quote_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.reconcile)
  reconcile(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.reconcile(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readExecution)
  readExecution(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.model.readExecution(request, body));
  }
  /** Reclaim the original persisted run only. No fresh plan or invocation. */
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.recover)
  recover(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.recover(request, body, signal)), 'read_execution');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.takeover)
  takeover(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.takeover(request, body, signal)), 'read_takeover_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.requestCancel)
  requestCancel(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.model.requestCancel(request, body), 'read_cancellation_receipt');
  }
}

/** Existing full server assembly keeps its business/center routes. Model action
 * implementations are inherited, not a second controller execution chain. */
@Controller(AI_SCENE_MODEL_HTTP_DRAFT.basePath)
export class AiOriginalSceneModelController extends AiOriginalSceneModelActionsController {
  constructor(@Inject(AI_ORIGINAL_SCENE_MODEL_REQUESTS)
    private readonly fullModel: ReturnType<typeof composeRequestBoundOriginalSceneModel>) { super(fullModel); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.startSettingsTask)
  startSettingsTask(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.fullModel.startSettingsTask(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readSettingsConfirmation)
  readSettingsConfirmation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.fullModel.readSettingsConfirmation(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.decideSettingsProposal)
  decideSettingsProposal(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.fullModel.decideSettingsProposal(request, body), 'read_decision_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readSettingsDecision)
  readSettingsDecision(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.fullModel.readSettingsDecision(request, body), 'read_decision_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.continueSettingsConfirmation)
  continueSettingsConfirmation(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.fullModel.continueSettingsConfirmation(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.reconcileSettingsTask)
  reconcileSettingsTask(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.fullModel.reconcileSettingsTask(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.cancelSettingsTask)
  cancelSettingsTask(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.fullModel.cancelSettingsTask(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskPage)
  readTaskPage(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.fullModel.readTaskPage(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskEvents)
  readTaskEvents(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.fullModel.readTaskEvents(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskUsage)
  readTaskUsage(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.fullModel.readTaskUsage(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene)
  readTaskScene(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.fullModel.readTaskScene(request, body)); }
}
