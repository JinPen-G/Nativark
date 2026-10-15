import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { AiRetentionService } from './retention.service';

export const AI_RETENTION_REQUESTS = Symbol('AI_RETENTION_REQUESTS');
export const AI_RETENTION_HTTP = Object.freeze({ basePath: 'ai-native/privacy', cleanup: 'cleanup', receipt: 'receipt', receipts: 'receipts' });
type Request = { headers: { authorization?: unknown } };
export type AiRetentionRequestFactory = (request: Request) => AiRetentionService;

/** No timer, unsigned restore or arbitrary file/table deletion endpoint. */
@Controller(AI_RETENTION_HTTP.basePath)
export class AiRetentionController {
  constructor(@Inject(AI_RETENTION_REQUESTS) private readonly create: AiRetentionRequestFactory) {}
  private async respond(request: Request, operation: 'cleanup' | 'receipt' | 'receipts', body: unknown) {
    try { return await this.create(request)[operation](body); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const status = error instanceof z.ZodError ? 400 : code === 'AI_ACCESS_DENIED' ? 403
        : code === 'AI_REVISION_CONFLICT' || code === 'AI_RESULT_UNKNOWN' ? 409 : 503;
      throw new HttpException({ code: status === 400 ? 'AI_INVALID_INPUT' : status === 503 ? 'AI_RESOURCE_UNAVAILABLE'
        : code, retryable: false, ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'list_retention_receipts' } : {}) }, status);
    }
  }
  @Post(AI_RETENTION_HTTP.cleanup) @HttpCode(200) @Header('Cache-Control', 'no-store')
  cleanup(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'cleanup', body); }
  @Post(AI_RETENTION_HTTP.receipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'receipt', body); }
  @Post(AI_RETENTION_HTTP.receipts) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipts(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'receipts', body); }
}
