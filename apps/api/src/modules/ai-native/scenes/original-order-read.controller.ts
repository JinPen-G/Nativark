import { Body, Controller, HttpException, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AI_SCENE_ORDER_READ_HTTP_DRAFT, type AiSceneRequestReadDraft } from '@rental-os/shared';
import { originalRequestReferenceSchema } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest } from './request-bound-scenes.application';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';

export const AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS = Symbol('AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS');
/** Consumes the request-bound, current-identity application, never a runner or
 * unguarded Core reader. The host must supply its actual dedicated assembly. */
export interface OriginalOrderReadHttpRequests {
  start(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft, signal?: AbortSignal): Promise<unknown>;
  recover(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft, signal?: AbortSignal): Promise<unknown>;
  readOrderResult(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readModelResult(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readTaskScene(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readNextSteps(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readTaskSnapshot(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  reopenModelSource(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  requestCancel(request: AiSceneHttpRequest, command: { original: AiSceneRequestReadDraft; expectedRevision: number }): Promise<unknown>;
}
const cancelSchema = z.object({ original: originalRequestReferenceSchema,
  expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
type Request = AiSceneHttpRequest & AiRequestAbortSource;
const invalid = () => new HttpException({ code: 'AI_INVALID_INPUT', retryable: false }, 400);
function reference(value: unknown): AiSceneRequestReadDraft {
  const parsed = originalRequestReferenceSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return structuredClone(parsed.data);
}

/** No default registration. A distinct route cannot silently upgrade a saved
 * single-model plan, choose a worker, approve writes or replay an unknown send. */
@Controller(AI_SCENE_ORDER_READ_HTTP_DRAFT.basePath)
export class AiOriginalOrderReadController {
  constructor(@Inject(AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS) private readonly app: OriginalOrderReadHttpRequests) {}
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.start)
  start(@Req() request: Request, @Body() body: unknown) {
    const original = reference(body);
    return respondAiScene(() => withRequestAbort(request, signal => this.app.start(request, original, signal)), 'read_execution');
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.recover)
  recover(@Req() request: Request, @Body() body: unknown) {
    const original = reference(body);
    return respondAiScene(() => withRequestAbort(request, signal => this.app.recover(request, original, signal)), 'read_execution');
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readOrderResult)
  readOrderResult(@Req() request: Request, @Body() body: unknown) { return respondAiScene(() => this.app.readOrderResult(request, reference(body))); }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readModelResult)
  readModelResult(@Req() request: Request, @Body() body: unknown) { return respondAiScene(() => this.app.readModelResult(request, reference(body))); }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readTaskScene)
  readTaskScene(@Req() request: Request, @Body() body: unknown) { return respondAiScene(() => this.app.readTaskScene(request, reference(body))); }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readNextSteps)
  readNextSteps(@Req() request: Request, @Body() body: unknown) { return respondAiScene(() => this.app.readNextSteps(request, reference(body))); }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readTaskSnapshot)
  readTaskSnapshot(@Req() request: Request, @Body() body: unknown) { return respondAiScene(() => this.app.readTaskSnapshot(request, reference(body))); }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.reopenModelSource)
  reopenModelSource(@Req() request: Request, @Body() body: unknown) { return respondAiScene(() => this.app.reopenModelSource(request, reference(body))); }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.requestCancel)
  requestCancel(@Req() request: Request, @Body() body: unknown) {
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) throw invalid();
    return respondAiScene(() => this.app.requestCancel(request, structuredClone(parsed.data)), 'read_execution');
  }
}
