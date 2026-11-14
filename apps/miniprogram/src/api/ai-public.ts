/** Fixed public/client continuity protocol; no model call, quote or business
 * command. The native HTTP host retains Auth and disables POST refresh replay. */
import { AI_CLIENT_PUBLIC_HTTP, aiClientPublicSessionRequestSchema, aiClientPublicReadRequestSchema,
  aiClientPublicPreparationRequestSchema, aiClientPublicOperationRequestSchema, aiClientPublicContinuationRequestSchema,
  aiClientPublicContinuationReadRequestSchema, aiClientPublicSessionResponseSchema, aiClientPublicReadResponseSchema,
  aiClientPublicPreparationResponseSchema, aiClientPublicOperationResponseSchema, aiClientPublicContinuationResponseSchema } from '../vendor/shared-ai-client';
import type { AiClientPublicContinuityApi, AiClientPublicReadRequest, AiClientPublicReadResponse, AiClientPublicSessionRequest,
  AiClientPublicPreparationRequest, AiClientPublicOperationRequest, AiClientPublicContinuationRequest,
  AiClientPublicContinuationReadRequest } from '@rental-os/shared';
import { request } from '../core/http';
import { PUBLIC_CONFIG } from '../config/public';

const post = (action: string, data: unknown, credential?: string, client = false) => {
  if (!data || typeof data !== 'object' || !('tenantCode' in data) || data.tenantCode !== PUBLIC_CONFIG.tenantCode) throw Error('public_context_changed');
  return request<unknown>(`/api/${AI_CLIENT_PUBLIC_HTTP.basePaths[1]}/${action}`, { method: 'POST', data, auth: client ? 'required' : 'none',
    scope: 'workspace', replayAfterRefresh: false, timeoutMs: 15000,
    ...(credential ? { publicSessionCredential: credential } : {}) });
};
export const clientPublicApi: AiClientPublicContinuityApi & { read(input: AiClientPublicReadRequest): Promise<AiClientPublicReadResponse> } = Object.freeze({
  async read(input: AiClientPublicReadRequest) { return aiClientPublicReadResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.read, aiClientPublicReadRequestSchema.parse(input))); },
  async issueSession(input: AiClientPublicSessionRequest) { return aiClientPublicSessionResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.issueSession, aiClientPublicSessionRequestSchema.parse(input))); },
  async prepare(input: AiClientPublicPreparationRequest, credential: string) { return aiClientPublicPreparationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.prepare, aiClientPublicPreparationRequestSchema.parse(input), credential)); },
  async readOriginal(input: AiClientPublicOperationRequest, credential: string) { return aiClientPublicOperationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.readOriginal, aiClientPublicOperationRequestSchema.parse(input), credential)); },
  async continueOriginal(input: AiClientPublicContinuationRequest, credential: string) { return aiClientPublicContinuationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.continueOriginal, aiClientPublicContinuationRequestSchema.parse(input), credential, true)); },
  async readContinuation(input: AiClientPublicContinuationReadRequest) { return aiClientPublicContinuationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.readContinuation, aiClientPublicContinuationReadRequestSchema.parse(input), undefined, true)); },
});
