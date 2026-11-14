import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AI_PLATFORM_RETENTION_HTTP } from '@rental-os/shared';
import type { AiRetentionService } from './retention.service';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { withRequestAbort, type AiRequestAbortSource } from '../scenes/request-abort';
import { callAiTaskRunnerDependency } from '../runner/ai-task-runner.service';
import { retentionHttpRequest, retentionHttpResponse, platformRetentionHttpRequest, platformRetentionHttpResponse } from './retention-http.contract';
import type { AiPlatformRetentionService } from './platform-retention.service';

export const AI_RETENTION_REQUESTS = Symbol('AI_RETENTION_REQUESTS');
export const AI_PLATFORM_RETENTION_REQUESTS = Symbol('AI_PLATFORM_RETENTION_REQUESTS');
export const AI_RETENTION_HTTP = Object.freeze({ basePath: 'ai-native/privacy', cleanup: 'cleanup', receipt: 'receipt', receipts: 'receipts' });
type Request = { headers: { authorization?: unknown }; body?: unknown } & AiRequestAbortSource;
export type AiRetentionRequestFactory = (request: Request) => Pick<AiRetentionService, 'cleanup' | 'receipt' | 'receipts' | 'protectStoredBodies'> & { close(): void };
export type AiPlatformRetentionRequestFactory = (request: Request) => Pick<AiPlatformRetentionService,
  'cleanup' | 'receipt' | 'receipts' | 'protectStoredBodies' | 'exportRestoreManifest' | 'reapplyRestore'> & { close(): void };

/** No timer, unsigned restore or arbitrary file/table deletion endpoint. */
@Controller(AI_RETENTION_HTTP.basePath)
export class AiRetentionController {
  constructor(@Inject(AI_RETENTION_REQUESTS) private readonly create: AiRetentionRequestFactory) {}
  private async respond(request: Request, operation: 'cleanup' | 'receipt' | 'receipts', body: unknown) {
    const writing = operation === 'cleanup';
    try {
      const command = retentionHttpRequest(operation, request.body ?? body);
      return await withRequestAbort(request, signal => runWithRequestIdentity({}, async () => {
        const scoped = this.create(request), close = () => scoped.close();
        signal.addEventListener('abort', close, { once: true });
        if (signal.aborted) close();
        try {
          const result = await callAiTaskRunnerDependency<unknown>(() => scoped[operation](structuredClone(command)), writing ? 30000 : 5000,
            'retention_http', signal);
          return retentionHttpResponse(operation, result, command);
        }
        finally { close(); signal.removeEventListener('abort', close); }
      }), { maxWaitMs: writing ? 30000 : 15000 });
    }
    catch (error) {
      const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      // Interruption proves neither deletion nor rollback. Only a read can be
      // classified unavailable; cleanup must be reconciled from original receipts.
      const code = rawCode === 'AI_RUN_LIMIT' || rawCode === 'AI_RESULT_UNKNOWN'
        ? writing ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE' : rawCode;
      const status = error instanceof z.ZodError || code === 'AI_INVALID_INPUT' ? 400 : code === 'AI_ACCESS_DENIED' ? 403
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

/** Exact platform maintenance only. Workspace cleanup cannot be reached
 * through this route; server host restore/key methods stay outside HTTP. */
@Controller(AI_PLATFORM_RETENTION_HTTP.basePath)
export class AiPlatformRetentionController {
  constructor(@Inject(AI_PLATFORM_RETENTION_REQUESTS) private readonly create: AiPlatformRetentionRequestFactory) {}
  private async respond(request: Request, operation: 'cleanup' | 'receipt' | 'receipts', body: unknown) {
    const writing = operation === 'cleanup';
    try {
      const command = platformRetentionHttpRequest(operation, request.body ?? body);
      return await withRequestAbort(request, signal => runWithRequestIdentity({}, async () => {
        const scoped = this.create(request), close = () => scoped.close();
        signal.addEventListener('abort', close, { once: true }); if (signal.aborted) close();
        try {
          const result = await callAiTaskRunnerDependency<unknown>(() => scoped[operation](structuredClone(command)),
            writing ? 30000 : 5000, 'platform_retention_http', signal);
          return platformRetentionHttpResponse(operation, result, command);
        } finally { close(); signal.removeEventListener('abort', close); }
      }), { maxWaitMs: writing ? 30000 : 15000 });
    } catch (error) {
      const raw = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const code = raw === 'AI_RUN_LIMIT' || raw === 'AI_RESULT_UNKNOWN'
        ? writing ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE' : raw;
      const status = error instanceof z.ZodError || code === 'AI_INVALID_INPUT' ? 400 : code === 'AI_ACCESS_DENIED' ? 403
        : code === 'AI_REVISION_CONFLICT' || code === 'AI_RESULT_UNKNOWN' ? 409 : 503;
      throw new HttpException({ code: status === 400 ? 'AI_INVALID_INPUT' : status === 503 ? 'AI_RESOURCE_UNAVAILABLE' : code,
        retryable: false, ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'list_retention_receipts' } : {}) }, status);
    }
  }
  @Post(AI_PLATFORM_RETENTION_HTTP.cleanup) @HttpCode(200) @Header('Cache-Control', 'no-store')
  cleanup(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'cleanup', body); }
  @Post(AI_PLATFORM_RETENTION_HTTP.receipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'receipt', body); }
  @Post(AI_PLATFORM_RETENTION_HTTP.receipts) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipts(@Req() request: Request, @Body() body: unknown) { return this.respond(request, 'receipts', body); }
}
