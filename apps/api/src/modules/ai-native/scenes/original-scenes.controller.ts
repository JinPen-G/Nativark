import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { withRequestAbort } from './request-abort';
import type { composeRequestBoundOriginalScenes, composeRequestBoundOriginalSceneModel,
  composeRequestBoundPersistedOriginalSceneModel, composeRequestBoundOriginalTaskActionPolicies,
  composeRequestBoundScenePlanPolicies, composeRequestBoundOriginalTaskRecoveryReaders,
  composeRequestBoundOriginalOpeningReadTask, AiSceneHttpRequest } from './request-bound-scenes.application';
import { AI_SCENE_REQUEST_HTTP_DRAFT, AI_SCENE_MODEL_HTTP_DRAFT, AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT,
  AI_SCENE_PLAN_POLICY_HTTP_DRAFT, AI_OPENING_READ_TASK_HTTP_DRAFT,
  AI_SCENE_REQUEST_DRAFT_SCHEMAS, type AiOriginalOpeningReadSourceDraft } from '@rental-os/shared';
import { originalRequestReferenceSchema } from '../task-request/original-request.validation';
import { AiTaskRepositoryError } from '../ai-task.repository';

export const AI_ORIGINAL_SCENES = Symbol('AI_ORIGINAL_SCENES');
export const AI_ORIGINAL_SCENE_REQUESTS = Symbol('AI_ORIGINAL_SCENE_REQUESTS');
export const AI_ORIGINAL_SCENE_MODEL_REQUESTS = Symbol('AI_ORIGINAL_SCENE_MODEL_REQUESTS');
export const AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS = Symbol('AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS');
export const AI_ORIGINAL_TASK_ACTION_POLICIES = Symbol('AI_ORIGINAL_TASK_ACTION_POLICIES');
export const AI_SCENE_PLAN_POLICIES = Symbol('AI_SCENE_PLAN_POLICIES');
export const AI_ORIGINAL_SCENE_RECOVERY_REQUESTS = Symbol('AI_ORIGINAL_SCENE_RECOVERY_REQUESTS');
export const AI_ORIGINAL_OPENING_READ_TASK_REQUESTS = Symbol('AI_ORIGINAL_OPENING_READ_TASK_REQUESTS');
type Scenes = ReturnType<typeof composeRequestBoundOriginalScenes>;
export async function respondAiScene<T>(work: () => Promise<T>, unknownAction = 'reconcile') {
  try { return await work(); }
  catch (error) {
    const response = error instanceof HttpException ? error.getResponse() : undefined;
    // Preserve only the known public code, never an arbitrary exception body,
    // message, stack, request content or provider details.
    const rawCode = response && typeof response === 'object' && 'code' in response ? response.code
      : error instanceof HttpException && [401, 403].includes(error.getStatus()) ? 'AI_ACCESS_DENIED'
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
const openingSourceAjv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(openingSourceAjv);
const openingSourceDefinitions = JSON.parse(JSON.stringify(Object.fromEntries(
  ['AiOriginalOpeningReadSourceDraft', 'AiOpeningReadFactsDraft', 'AiSceneRequestReceiptDraft']
    .map(name => [name, AI_SCENE_REQUEST_DRAFT_SCHEMAS[name]])
)).replaceAll('#/components/schemas/', '#/$defs/'));
const validOpeningSource = openingSourceAjv.compile<AiOriginalOpeningReadSourceDraft>({
  $ref: '#/$defs/AiOriginalOpeningReadSourceDraft', $defs: openingSourceDefinitions
});
const validOrderExtensionPreview = openingSourceAjv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneOrderExtensionPreviewDraft);

/** Separate, opt-in read-task transport. It offers no model, approval, input
 * submission or configuration-write route, and never selects an arbitrary tool. */
@Controller(AI_OPENING_READ_TASK_HTTP_DRAFT.basePath)
export class AiOriginalOpeningReadTaskController {
  constructor(@Inject(AI_ORIGINAL_OPENING_READ_TASK_REQUESTS)
    private readonly tasks: ReturnType<typeof composeRequestBoundOriginalOpeningReadTask>) {}
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.start) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.tasks.start(request, body, signal)), 'read_execution');
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.recover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  recover(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.tasks.recover(request, body, signal)), 'read_execution');
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.reconcile) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.tasks.reconcile(request, body, signal)), 'read_execution');
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.inspect) @HttpCode(200) @Header('Cache-Control', 'no-store')
  inspect(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.tasks.inspect(request, body)); }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.takeover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  takeover(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.tasks.takeover(request, body, signal)), 'read_takeover_receipt');
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.readTakeoverReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTakeoverReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.tasks.readTakeoverReceipt(request, body));
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.requestCancellationIntent) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancellationIntent(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.tasks.requestCancellationIntent(request, body), 'read_cancellation_receipt');
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.settleUnstartedCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleUnstartedCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.tasks.settleUnstartedCancellation(request, body), 'read_cancellation_settlement_receipt');
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.readCancellationReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.tasks.readCancellationReceipt(request, body));
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.readCancellationSettlementReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationSettlementReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.tasks.readCancellationSettlementReceipt(request, body));
  }
  @Post(AI_OPENING_READ_TASK_HTTP_DRAFT.reopenSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reopenSource(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(async () => {
      // Reuse AiSceneModelResultReadDraft's original/resultId reference shape.
      // No URL, historic payload, tool code or caller Task ID is forwarded.
      const parsed = z.object({ original: originalRequestReferenceSchema, resultId: z.string().uuid() }).strict().safeParse(structuredClone(body));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const response = structuredClone(await withRequestAbort(request, signal => this.tasks.reopenSource(request,
        { ...parsed.data.original, resultId: parsed.data.resultId }, signal)));
      if (!validOpeningSource(response) || response.original.sceneCode !== 'opening_diagnosis'
        || response.original.inputRef !== parsed.data.original.inputRef
        || response.original.draftVersion !== parsed.data.original.draftVersion
        || response.source.original.resultId !== parsed.data.resultId
        || response.original.state === 'revoked' || response.source.facts.coverage !== 'requested_sections'
        || BigInt(response.source.original.outputBytes) > 18446744073709551615n
        || BigInt(response.source.original.activeMs) > 18446744073709551615n
        || new Set(response.source.facts.items.map(row => row.key)).size !== response.source.facts.items.length) {
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      }
      return response;
    });
  }
}
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
  /** Bound the original request, not its durable task. Body/auth snapshots
   * precede all waits; interruption is never proof that a write rolled back. */
  private call<T>(request: SceneRunHttpRequest, body: unknown,
    consume: (current: AiSceneHttpRequest, command: unknown, signal: AbortSignal) => Promise<T>) {
    return this.respond(() => {
      const current = { headers: { authorization: request?.headers?.authorization } }, command = structuredClone(body);
      return withRequestAbort(request, signal => consume(current, command, signal), { maxWaitMs: 15000 });
    });
  }
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.queryOrders) @HttpCode(200) @Header('Cache-Control', 'no-store')
  queryOrders(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return this.call(request, body, (current, command, signal) => this.scenes.queryOrders(current, command, signal));
  }
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.previewOrderExtension) @HttpCode(200) @Header('Cache-Control', 'no-store')
  previewOrderExtension(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return this.respond(() => {
      const command = structuredClone(body);
      if (!validOrderExtensionPreview(command)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return withRequestAbort(request, signal => this.scenes.previewOrderExtension(request, command, signal));
    });
  }
  @Post() @Header('Cache-Control', 'no-store')
  create(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.create(current, command, signal)); }
  @Post('read') @Header('Cache-Control', 'no-store')
  read(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.read(current, command, signal)); }
  @Post('reissue') @Header('Cache-Control', 'no-store')
  reissue(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.reissue(current, command, signal)); }
  @Post('reconcile') @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.reconcile(current, command, signal)); }
  @Post('reconcile-reissue') @Header('Cache-Control', 'no-store')
  reconcileReissue(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.reconcileReissue(current, command, signal)); }
  @Post('create-task') @Header('Cache-Control', 'no-store')
  createTask(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.createTask(current, command, signal)); }
  @Post('material') @Header('Cache-Control', 'no-store')
  material(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.prepareTaskMaterial(current, command, signal)); }
  @Post('recovery') @Header('Cache-Control', 'no-store')
  recovery(@Req() request: SceneRunHttpRequest, @Body() body: unknown) { return this.call(request, body, (current, command, signal) => this.scenes.readRecovery(current, command, signal)); }
  /** Read current preparation for the stored original request, never quote creation. */
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.quoteReview) @HttpCode(200) @Header('Cache-Control', 'no-store')
  quoteReview(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, signal => this.scenes.reviewQuote(request, body, signal)));
  }
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.quoteConfirm) @HttpCode(200) @Header('Cache-Control', 'no-store')
  quoteConfirm(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, signal => this.scenes.confirmQuote(request, body, signal)), 'read_original_quote_receipt');
  }
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.quoteReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  quoteReceipt(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, signal => this.scenes.readQuoteReceipt(request, body, signal)));
  }
  @Post(AI_SCENE_REQUEST_HTTP_DRAFT.compareOriginalQuotes) @HttpCode(200) @Header('Cache-Control', 'no-store')
  compareOriginalQuotes(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, signal => this.scenes.compareOriginalQuotes(request, body, signal)));
  }
}

/** Observation transport can be mounted without a model/runner. Mount it OR
 * a derived execution controller at this prefix, never both. */
@Controller(AI_SCENE_MODEL_HTTP_DRAFT.basePath)
export class AiOriginalSceneObservationController {
  constructor(@Inject(AI_ORIGINAL_SCENE_RECOVERY_REQUESTS)
    protected readonly observations: Omit<ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>, 'resolveAnswerContinuation'>) {}
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskPage) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskPage(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readTaskPage(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskEvents) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskEvents(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readTaskEvents(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskUsage) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskUsage(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readTaskUsage(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskScene(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readTaskScene(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskPerformance) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskPerformance(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request,
      signal => this.observations.readTaskPerformance(request, body, signal), { maxWaitMs: 15000 }));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readInput) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readInput(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readInput(request, body));
  }
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
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readCancellationSettlementReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationSettlementReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readCancellationSettlementReceipt(request, body), 'read_cancellation_settlement_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readAnswer) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readAnswer(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readAnswer(request, body), 'read_answer');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readModelResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readModelResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.readModelResult(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.reopenModelSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reopenModelSource(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.reopenModelSource(request, body));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.reopenOpeningModelSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reopenOpeningModelSource(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.reopenOpeningModelSource(request, body));
  }
}

/** Original cancellation is deliberately absent from the standard read host. */
@Controller(AI_SCENE_MODEL_HTTP_DRAFT.basePath)
export class AiOriginalSceneRecoveryController extends AiOriginalSceneObservationController {
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.requestCancellationIntent) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancellationIntent(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.requestCancellationIntent(request, body), 'read_cancellation_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.settleUnstartedCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleUnstartedCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.settleUnstartedCancellation(request, body), 'read_cancellation_settlement_receipt');
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.settleReleasedInputCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleReleasedInputCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => this.observations.settleReleasedInputCancellation(request, body), 'read_cancellation_settlement_receipt');
  }
}

/** No root-module registration. The server must provide the actual authorized
 * runner/Gateway/financial evidence assembly; request bodies cannot do so. */
@Controller(AI_SCENE_MODEL_HTTP_DRAFT.basePath)
export class AiOriginalSceneModelActionsController extends AiOriginalSceneRecoveryController {
  constructor(@Inject(AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS)
    protected readonly model: Omit<ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>, 'resolveAnswerContinuation'> &
      Pick<ReturnType<typeof composeRequestBoundPersistedOriginalSceneModel>,
        'start' | 'readInput' | 'refreshInput' | 'resume' | 'readQuotePreparation' | 'confirmClarifiedQuote' |
        'readClarifiedQuoteReceipt' | 'continueAnswer' | 'reconcile' | 'recover' | 'readExecution' | 'takeover' | 'requestCancel'>) { super(model); }
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
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene)
  readTaskScene(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.fullModel.readTaskScene(request, body)); }
}
