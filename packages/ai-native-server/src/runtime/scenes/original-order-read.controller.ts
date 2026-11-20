import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AI_SCENE_ORDER_READ_HTTP_DRAFT, AI_ORDER_READ_HTTP_CONTRACTS, type AiSceneRequestReadDraft, type AiSceneModelTakeoverDraft } from '@rental-os/shared';
import { originalRequestReferenceSchema } from '../task-request/original-request.validation';
import type { AiSceneHttpRequest } from './request-bound-scenes.application';
import { respondAiScene } from './original-scenes.controller';
import { validateAiOrderReadResponse } from './scene-observation-contracts';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';

export const AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS = Symbol('AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS');
/** Closed server method set shared by explicit modules and the standard host. */
export const originalOrderReadRequestMethods = Object.freeze(Object.keys(AI_ORDER_READ_HTTP_CONTRACTS) as Array<keyof typeof AI_ORDER_READ_HTTP_CONTRACTS>);
/** Consumes the request-bound, current-identity application, never a runner or
 * unguarded Core reader. The host must supply its actual dedicated assembly. */
export interface OriginalOrderReadHttpRequests {
  start(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft, signal?: AbortSignal): Promise<unknown>;
  recover(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft, signal?: AbortSignal): Promise<unknown>;
  readPreparation(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  resumePrepared(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft, signal?: AbortSignal): Promise<unknown>;
  readAnswer(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  takeover(request: AiSceneHttpRequest, command: AiSceneModelTakeoverDraft, signal?: AbortSignal): Promise<unknown>;
  readTakeoverReceipt(request: AiSceneHttpRequest, command: AiSceneModelTakeoverDraft): Promise<unknown>;
  readOrderResult(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readModelResult(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readTaskScene(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readNextSteps(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  readTaskSnapshot(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  reopenModelSource(request: AiSceneHttpRequest, original: AiSceneRequestReadDraft): Promise<unknown>;
  requestCancel(request: AiSceneHttpRequest, command: { original: AiSceneRequestReadDraft; expectedRevision: number }): Promise<unknown>;
  readCancellationReceipt(request: AiSceneHttpRequest, command: { original: AiSceneRequestReadDraft; expectedRevision: number }): Promise<unknown>;
  settleUnstartedCancellation(request: AiSceneHttpRequest, command: { original: AiSceneRequestReadDraft; expectedRevision: number }): Promise<unknown>;
  readCancellationSettlementReceipt(request: AiSceneHttpRequest, command: { original: AiSceneRequestReadDraft; expectedRevision: number }): Promise<unknown>;
}
const cancelSchema = z.object({ original: originalRequestReferenceSchema,
  expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
const takeoverSchema = z.object({ original: originalRequestReferenceSchema,
  expectedTaskRevision: z.number().int().min(1).max(4294967294), expectedRunRevision: z.number().int().min(1).max(4294967294),
  expectedFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict();
type Request = AiSceneHttpRequest & AiRequestAbortSource;
type Command = AiSceneRequestReadDraft | AiSceneModelTakeoverDraft | z.infer<typeof cancelSchema>;
const invalid = () => new HttpException({ code: 'AI_INVALID_INPUT', retryable: false }, 400);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid();
  return structuredClone(parsed.data);
}

/** Registered hosts remain closed without trusted server configuration. This
 * route cannot upgrade a saved single-model plan, choose a worker, approve
 * writes or replay an unknown send. Historical observation has its own host. */
@Controller(AI_SCENE_ORDER_READ_HTTP_DRAFT.basePath)
export class AiOriginalOrderReadController {
  constructor(@Inject(AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS) private readonly app: OriginalOrderReadHttpRequests) {}
  private respond<K extends keyof typeof AI_ORDER_READ_HTTP_CONTRACTS, T extends Command>(action: K, command: T, work: (copy: T) => Promise<unknown>) {
    const expected = structuredClone(command), contract = AI_ORDER_READ_HTTP_CONTRACTS[action];
    return respondAiScene(async () => validateAiOrderReadResponse(action, await work(structuredClone(expected)), expected),
      'unknownAction' in contract ? contract.unknownAction : 'reconcile');
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.start) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: Request, @Body() body: unknown) {
    return this.respond('start', parse(originalRequestReferenceSchema, body), original => withRequestAbort(request, signal => this.app.start(request, original, signal)));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.recover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  recover(@Req() request: Request, @Body() body: unknown) {
    return this.respond('recover', parse(originalRequestReferenceSchema, body), original => withRequestAbort(request, signal => this.app.recover(request, original, signal)));
  }
  // Repair stays separate: the actual host rejects execution/occupancy evidence.
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.resumePrepared) @HttpCode(200) @Header('Cache-Control', 'no-store')
  resumePrepared(@Req() request: Request, @Body() body: unknown) {
    return this.respond('resumePrepared', parse(originalRequestReferenceSchema, body), original => withRequestAbort(request, signal => this.app.resumePrepared(request, original, signal)));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readPreparation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPreparation(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readPreparation', parse(originalRequestReferenceSchema, body), original => this.app.readPreparation(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readAnswer) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readAnswer(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readAnswer', parse(originalRequestReferenceSchema, body), original => this.app.readAnswer(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.takeover) @HttpCode(200) @Header('Cache-Control', 'no-store')
  takeover(@Req() request: Request, @Body() body: unknown) {
    return this.respond('takeover', parse(takeoverSchema, body), command => withRequestAbort(request, signal => this.app.takeover(request, command, signal)));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readTakeoverReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTakeoverReceipt(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readTakeoverReceipt', parse(takeoverSchema, body), command => this.app.readTakeoverReceipt(request, command));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readOrderResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOrderResult(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readOrderResult', parse(originalRequestReferenceSchema, body), original => this.app.readOrderResult(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readModelResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readModelResult(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readModelResult', parse(originalRequestReferenceSchema, body), original => this.app.readModelResult(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readTaskScene) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskScene(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readTaskScene', parse(originalRequestReferenceSchema, body), original => this.app.readTaskScene(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readNextSteps) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readNextSteps(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readNextSteps', parse(originalRequestReferenceSchema, body), original => this.app.readNextSteps(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readTaskSnapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskSnapshot(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readTaskSnapshot', parse(originalRequestReferenceSchema, body), original => this.app.readTaskSnapshot(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.reopenModelSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reopenModelSource(@Req() request: Request, @Body() body: unknown) {
    return this.respond('reopenModelSource', parse(originalRequestReferenceSchema, body), original => this.app.reopenModelSource(request, original));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.requestCancel) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancel(@Req() request: Request, @Body() body: unknown) {
    return this.respond('requestCancel', parse(cancelSchema, body), command => this.app.requestCancel(request, command));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readCancellationReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationReceipt(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readCancellationReceipt', parse(cancelSchema, body), command => this.app.readCancellationReceipt(request, command));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.settleUnstartedCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleUnstartedCancellation(@Req() request: Request, @Body() body: unknown) {
    return this.respond('settleUnstartedCancellation', parse(cancelSchema, body), command => this.app.settleUnstartedCancellation(request, command));
  }
  @Post(AI_SCENE_ORDER_READ_HTTP_DRAFT.readCancellationSettlementReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationSettlementReceipt(@Req() request: Request, @Body() body: unknown) {
    return this.respond('readCancellationSettlementReceipt', parse(cancelSchema, body), command => this.app.readCancellationSettlementReceipt(request, command));
  }
}
