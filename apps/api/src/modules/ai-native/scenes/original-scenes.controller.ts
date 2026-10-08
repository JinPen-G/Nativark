import { Body, Controller, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { composeRequestBoundOriginalScenes, AiSceneHttpRequest } from './request-bound-scenes.application';
import { AI_SCENE_REQUEST_HTTP_DRAFT } from '@rental-os/shared';

export const AI_ORIGINAL_SCENES = Symbol('AI_ORIGINAL_SCENES');
export const AI_ORIGINAL_SCENE_REQUESTS = Symbol('AI_ORIGINAL_SCENE_REQUESTS');
type Scenes = ReturnType<typeof composeRequestBoundOriginalScenes>;
@Controller(AI_SCENE_REQUEST_HTTP_DRAFT.basePath)
export class AiOriginalScenesController {
  constructor(@Inject(AI_ORIGINAL_SCENE_REQUESTS) private readonly scenes: Scenes) {}
  private async respond<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : 'AI_STORAGE_UNAVAILABLE';
      const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403, AI_SCOPE_CHANGED: 403,
        AI_RESOURCE_UNAVAILABLE: 404, AI_REVISION_CONFLICT: 409, AI_STORAGE_UNAVAILABLE: 503, AI_RESULT_UNKNOWN: 409 };
      const known = typeof code === 'string' && Object.prototype.hasOwnProperty.call(statuses, code) ? code : 'AI_STORAGE_UNAVAILABLE';
      throw new HttpException({ code: known, retryable: false, ...(known === 'AI_RESULT_UNKNOWN' ? { nextAction: 'reconcile' } : {}) }, statuses[known]);
    }
  }
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
}
