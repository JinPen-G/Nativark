import { Body, Controller, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { composeRequestBoundOriginalScenes, composeRequestBoundOriginalSceneModel, AiSceneHttpRequest } from './request-bound-scenes.application';
import { AI_SCENE_REQUEST_HTTP_DRAFT, AI_SCENE_MODEL_HTTP_DRAFT } from '@rental-os/shared';

export const AI_ORIGINAL_SCENES = Symbol('AI_ORIGINAL_SCENES');
export const AI_ORIGINAL_SCENE_REQUESTS = Symbol('AI_ORIGINAL_SCENE_REQUESTS');
export const AI_ORIGINAL_SCENE_MODEL_REQUESTS = Symbol('AI_ORIGINAL_SCENE_MODEL_REQUESTS');
type Scenes = ReturnType<typeof composeRequestBoundOriginalScenes>;
async function respondAiScene<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : 'AI_STORAGE_UNAVAILABLE';
    const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403, AI_SCOPE_CHANGED: 403,
      AI_RESOURCE_UNAVAILABLE: 404, AI_REVISION_CONFLICT: 409, AI_STORAGE_UNAVAILABLE: 503, AI_RESULT_UNKNOWN: 409 };
    const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(statuses, code) ? code : 'AI_STORAGE_UNAVAILABLE';
    throw new HttpException({ code: known, retryable: false, ...(known === 'AI_RESULT_UNKNOWN' ? { nextAction: 'reconcile' } : {}) }, statuses[known]);
  }
}
type SceneRunHttpRequest = AiSceneHttpRequest & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;
async function withRequestAbort<T>(request: SceneRunHttpRequest, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController(), abort = () => controller.abort();
  const listens = typeof request?.once === 'function' && typeof request?.removeListener === 'function';
  // IncomingMessage.close can mean a normally completed request body, not a
  // cancellation. Only aborted is forwarded. This never proves remote rollback.
  if (request?.aborted) abort();
  else if (listens) request.once!('aborted', abort);
  try { return await work(controller.signal); }
  finally { if (listens) request.removeListener!('aborted', abort); }
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
}

/** No root-module registration. The server must provide the actual authorized
 * runner/Gateway/financial evidence assembly; request bodies cannot do so. */
@Controller(AI_SCENE_MODEL_HTTP_DRAFT.basePath)
export class AiOriginalSceneModelController {
  constructor(@Inject(AI_ORIGINAL_SCENE_MODEL_REQUESTS)
    private readonly model: ReturnType<typeof composeRequestBoundOriginalSceneModel>) {}
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskPage)
  readTaskPage(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.readTaskPage(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskEvents)
  readTaskEvents(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.readTaskEvents(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene)
  readTaskScene(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.readTaskScene(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.start)
  start(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.start(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readInput)
  readInput(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.readInput(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.resume)
  resume(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.resume(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.reconcile)
  reconcile(@Req() request: SceneRunHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.model.reconcile(request, body, signal)));
  }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.requestCancel)
  requestCancel(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.requestCancel(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.readModelResult)
  readModelResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.readModelResult(request, body)); }
  @Post(AI_SCENE_MODEL_HTTP_DRAFT.reopenModelSource)
  reopenModelSource(@Req() request: AiSceneHttpRequest, @Body() body: unknown) { return respondAiScene(() => this.model.reopenModelSource(request, body)); }
}
