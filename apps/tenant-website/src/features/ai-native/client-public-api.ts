/** Fixed public browse/continuation HTTP surface. Public requests have no
 * customer bearer. Explicit continuation uses the existing customer transport
 * without refreshing/replaying a POST; late identity responses are withdrawn. */
import { AI_CLIENT_PUBLIC_HTTP, aiClientPublicReadRequestSchema, aiClientPublicSessionRequestSchema,
  aiClientPublicPreparationRequestSchema, aiClientPublicOperationRequestSchema, aiClientPublicContinuationRequestSchema,
  aiClientPublicContinuationReadRequestSchema, aiClientPublicSessionResponseSchema, aiClientPublicReadResponseSchema,
  aiClientPublicPreparationResponseSchema, aiClientPublicOperationResponseSchema, aiClientPublicContinuationResponseSchema,
  type AiClientPublicContinuityApi, type AiClientPublicReadRequest, type AiClientPublicSessionRequest,
  type AiClientPublicPreparationRequest, type AiClientPublicOperationRequest,
  type AiClientPublicContinuationRequest, type AiClientPublicContinuationReadRequest } from '@rental-os/shared';
import { customerFetch, customerSessionGeneration } from '@rental-os/web-client';
import { API_BASE } from '../../data/apiClient';

export function createClientPublicApi(target: { tenantCode: string; serviceCode: string; current(): boolean }):
  AiClientPublicContinuityApi & { read(input: AiClientPublicReadRequest): Promise<ReturnType<typeof aiClientPublicReadResponseSchema.parse>> } {
  const before = aiClientPublicSessionRequestSchema.parse({ tenantCode: target.tenantCode, serviceCode: target.serviceCode });
  const route = `/${AI_CLIENT_PUBLIC_HTTP.basePaths[0].replace('client/v1/', '')}`;
  const post = async (action: string, body: unknown, credential?: string, client = false) => {
    if (!target.current()) throw Error('public_context_changed');
    if (!body || typeof body !== 'object' || !('tenantCode' in body) || !('serviceCode' in body)
      || body.tenantCode !== before.tenantCode || body.serviceCode !== before.serviceCode) throw Error('public_context_changed');
    const generation = customerSessionGeneration(before.tenantCode);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json',
      ...(credential ? { [AI_CLIENT_PUBLIC_HTTP.credentialHeader]: credential } : {}) };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const init = { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal };
      const response = client ? await customerFetch(before.tenantCode, `${API_BASE}/api/client/v1`, `${route}/${action}`, init, false)
        : await fetch(`${API_BASE}/api/${AI_CLIENT_PUBLIC_HTTP.basePaths[0]}/${action}`, init);
      const result: unknown = await response.json();
      if (!target.current() || client && generation !== customerSessionGeneration(before.tenantCode)) throw Error('public_context_changed');
      if (!response.ok) throw Error('public_original_unavailable');
      return result && typeof result === 'object' && 'data' in result ? result.data : result;
    } finally { clearTimeout(timer); }
  };
  return Object.freeze({
    async read(input: AiClientPublicReadRequest) { return aiClientPublicReadResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.read, aiClientPublicReadRequestSchema.parse(input))); },
    async issueSession(input: AiClientPublicSessionRequest) { return aiClientPublicSessionResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.issueSession, aiClientPublicSessionRequestSchema.parse(input))); },
    async prepare(input: AiClientPublicPreparationRequest, credential: string) { return aiClientPublicPreparationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.prepare, aiClientPublicPreparationRequestSchema.parse(input), credential)); },
    async readOriginal(input: AiClientPublicOperationRequest, credential: string) { return aiClientPublicOperationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.readOriginal, aiClientPublicOperationRequestSchema.parse(input), credential)); },
    async continueOriginal(input: AiClientPublicContinuationRequest, credential: string) { return aiClientPublicContinuationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.continueOriginal, aiClientPublicContinuationRequestSchema.parse(input), credential, true)); },
    async readContinuation(input: AiClientPublicContinuationReadRequest) { return aiClientPublicContinuationResponseSchema.parse(await post(AI_CLIENT_PUBLIC_HTTP.readContinuation, aiClientPublicContinuationReadRequestSchema.parse(input), undefined, true)); },
  });
}
