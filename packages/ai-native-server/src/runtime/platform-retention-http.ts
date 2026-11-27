/** Original platform retention transport. The host supplies the verified
 * request lifetime and its current management authority. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AI_PLATFORM_RETENTION_HTTP } from '@rental-os/platform-contracts/ai-retention';
import { callAiTaskRunnerDependency } from '@rental-os/platform-server/ai-runtime';
import { withRequestAbort, type AiRequestAbortSource } from './scenes/request-abort';
import { logInterruptedRetention } from './privacy/retention-page-observation';
import { platformRetentionHttpRequest, platformRetentionHttpResponse } from './privacy/retention-http.contract';
import type { PlatformRetentionOperations } from './privacy/platform-retention';
import { AiTaskRepositoryError } from '../task-errors';

export const AI_PLATFORM_RETENTION_REQUESTS = Symbol('AI_PLATFORM_RETENTION_REQUESTS');
export const AI_NATIVE_RETENTION_RESTORE_CONFIGURATION = Symbol('AI_NATIVE_RETENTION_RESTORE_CONFIGURATION');
export const AI_NATIVE_PLATFORM_RETENTION_RESTORE_KEY_HASH = Symbol('AI_NATIVE_PLATFORM_RETENTION_RESTORE_KEY_HASH');
export type PlatformRetentionRequestScope = <T>(work: () => Promise<T>) => Promise<T>;
export type PlatformRetentionRequest = { headers: { authorization?: unknown }; body?: unknown } & AiRequestAbortSource;
export type AiPlatformRetentionRequestFactory = (request: PlatformRetentionRequest) => Pick<PlatformRetentionOperations,
  'cleanup' | 'receipt' | 'receipts' | 'protectStoredBodies' | 'exportRestoreManifest' | 'reapplyRestore'> & { close(): void };
export interface PlatformRetentionHttpController {
  cleanup(request: PlatformRetentionRequest, body: unknown): Promise<unknown>;
  receipt(request: PlatformRetentionRequest, body: unknown): Promise<unknown>;
  receipts(request: PlatformRetentionRequest, body: unknown): Promise<unknown>;
}

const restoreKey = z.string().regex(/^[a-f0-9]{64}$/u);
export function platformRetentionRestoreKeyHash(keyHash: unknown, configuration: unknown) {
  const direct = restoreKey.optional().safeParse(keyHash);
  const configured = z.object({ publicKeyHash: restoreKey }).strict().optional().safeParse(configuration);
  if (!direct.success || !configured.success || direct.data !== undefined && configured.data !== undefined
    && direct.data !== configured.data.publicKeyHash) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return configured.data?.publicKeyHash ?? direct.data;
}

/** Restore and body protection stay host-only; the three HTTP actions share
 * the original request, bounded wait and closed response contract. */
export function createPlatformRetentionController(withScope: PlatformRetentionRequestScope):
  new (create: AiPlatformRetentionRequestFactory) => PlatformRetentionHttpController {
  @Controller(AI_PLATFORM_RETENTION_HTTP.basePath)
  class AiPlatformRetentionController {
    constructor(@Inject(AI_PLATFORM_RETENTION_REQUESTS) private readonly create: AiPlatformRetentionRequestFactory) {}
    private async respond(request: PlatformRetentionRequest, operation: 'cleanup' | 'receipt' | 'receipts', body: unknown) {
      const writing = operation === 'cleanup';
      try {
        const command = platformRetentionHttpRequest(operation, request.body ?? body);
        return await withRequestAbort(request, signal => withScope(async () => {
          const scoped = this.create(request), close = () => scoped.close();
          signal.addEventListener('abort', close, { once: true }); if (signal.aborted) close();
          try {
            const result = await callAiTaskRunnerDependency<unknown>(() => scoped[operation](structuredClone(command)),
              writing ? 30000 : 5000, 'platform_retention_http', signal);
            return platformRetentionHttpResponse(operation, result, command);
          } finally { close(); signal.removeEventListener('abort', close); }
        }), { maxWaitMs: writing ? 30000 : 15000 });
      } catch (error) {
        const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const code = rawCode === 'AI_RUN_LIMIT' || rawCode === 'AI_RESULT_UNKNOWN'
          ? writing ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE' : rawCode;
        const status = error instanceof z.ZodError || code === 'AI_INVALID_INPUT' ? 400 : code === 'AI_ACCESS_DENIED' ? 403
          : code === 'AI_REVISION_CONFLICT' || code === 'AI_RESULT_UNKNOWN' ? 409 : 503;
        if (writing && (status === 503 || code === 'AI_RESULT_UNKNOWN')) logInterruptedRetention('platform', status);
        throw new HttpException({ code: status === 400 ? 'AI_INVALID_INPUT' : status === 503 ? 'AI_RESOURCE_UNAVAILABLE' : code,
          retryable: false, ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'list_retention_receipts' } : {}) }, status);
      }
    }
    @Post(AI_PLATFORM_RETENTION_HTTP.cleanup) @HttpCode(200) @Header('Cache-Control', 'no-store')
    cleanup(@Req() request: PlatformRetentionRequest, @Body() body: unknown) { return this.respond(request, 'cleanup', body); }
    @Post(AI_PLATFORM_RETENTION_HTTP.receipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
    receipt(@Req() request: PlatformRetentionRequest, @Body() body: unknown) { return this.respond(request, 'receipt', body); }
    @Post(AI_PLATFORM_RETENTION_HTTP.receipts) @HttpCode(200) @Header('Cache-Control', 'no-store')
    receipts(@Req() request: PlatformRetentionRequest, @Body() body: unknown) { return this.respond(request, 'receipts', body); }
  }
  return AiPlatformRetentionController;
}
