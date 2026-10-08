import { Body, Controller, HttpException, Inject, Post } from '@nestjs/common';
import type { composeAiOriginalScenes } from './original-scenes.composition';
import { AI_SCENE_REQUEST_HTTP_DRAFT } from '@rental-os/shared';

export const AI_ORIGINAL_SCENES = Symbol('AI_ORIGINAL_SCENES');
type Scenes = ReturnType<typeof composeAiOriginalScenes>;
@Controller(AI_SCENE_REQUEST_HTTP_DRAFT.basePath)
export class AiOriginalScenesController {
  constructor(@Inject(AI_ORIGINAL_SCENES) private readonly scenes: Scenes) {}
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
  create(@Body() body: unknown) { return this.respond(() => this.scenes.create(body)); }
  @Post('read')
  read(@Body() body: unknown) { return this.respond(() => this.scenes.read(body)); }
  @Post('reissue')
  reissue(@Body() body: unknown) { return this.respond(() => this.scenes.reissue(body)); }
  @Post('reconcile')
  reconcile(@Body() body: unknown) { return this.respond(() => this.scenes.reconcile(body)); }
  @Post('reconcile-reissue')
  reconcileReissue(@Body() body: unknown) { return this.respond(() => this.scenes.reconcile(body, true)); }
  @Post('create-task')
  createTask(@Body() body: unknown) { return this.respond(() => this.scenes.createTask(body)); }
  @Post('material')
  material(@Body() body: unknown) { return this.respond(() => this.scenes.prepareTaskMaterial(body)); }
  @Post('recovery')
  recovery(@Body() body: unknown) { return this.respond(() => this.scenes.readRecovery(body)); }
}
