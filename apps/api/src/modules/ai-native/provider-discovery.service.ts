/** Setup-only directory retrieval. Inspired by Magpie's separation of model
 * listing and inference probes (internal/provider/{models,detect}.go, MIT).
 * Never sends prompts or confuses a shared /models endpoint with Responses /
 * Chat capability. Real inference validation remains the original probe task. */
import { AI_PROVIDER_DISCOVERY_PROTOCOLS, type AiProviderDiscoveryInputDraft, type AiProviderDiscoveryResultDraft } from '@rental-os/shared';
import { ModelGatewayError } from './model-gateway.ports';
import { ModelResponseSecretGuard } from './model-response-secret';
import { modelEgressUrl } from './model-egress-policy';
import type { ModelEgressTransport } from './model-egress.transport';

export async function discoverProviderMetadata(input: AiProviderDiscoveryInputDraft, action: 'models' | 'detect',
  apiKey: string, transport: Pick<ModelEgressTransport, 'getModelDirectory'>, current: () => Promise<void>, signal: AbortSignal): Promise<AiProviderDiscoveryResultDraft> {
  const base = modelEgressUrl(input.baseUrl.replace(/\/+$/u, ''));
  const secrets = new ModelResponseSecretGuard(apiKey);
  const prefix = base.pathname.replace(/\/+$/u, '');
  // Match existing adapters: OpenAI appends to the supplied base; Messages adds
  // /v1 unless already present. Never follow pagination URLs or switch origins.
  const observedAt = new Date().toISOString();
  const protocols: AiProviderDiscoveryResultDraft['protocols'] = AI_PROVIDER_DISCOVERY_PROTOCOLS.map(protocol => ({ protocol, state: 'undetermined' }));
  const ids = new Set<string>(); let truncated = false, listed = false, authFailed = false;
  const modes = action === 'detect' ? ['bearer', 'messages'] : [input.protocol === 'anthropic_messages' ? 'messages' : 'bearer'];
  for (const mode of modes) {
    base.pathname = `${prefix}${mode === 'messages' && !prefix.endsWith('/v1') ? '/v1' : ''}/models`;
    await current();
    if (signal.aborted) throw new ModelGatewayError('CANCELLED');
    const headers: Record<string, string> = mode === 'bearer'
      ? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
    let response;
    try { response = await transport.getModelDirectory({ url: base.toString(), headers, maxResponseBytes: 262144, signal }); }
    catch (error) {
      await current();
      if (signal.aborted || error instanceof ModelGatewayError && ['CANCELLED', 'CONFIG_INVALID'].includes(error.code)) throw error;
      continue; // A directory unavailable is not an inference failure.
    }
    await current();
    if (response.status === 401 || response.status === 403) { authFailed = true; continue; }
    if (response.status !== 200 || secrets.contains(response.body)) continue;
    let data: unknown;
    try { data = JSON.parse(response.body); } catch { continue; }
    // Escaped JSON can hide an encoded key in otherwise valid model IDs. A
    // directory response remains advisory; it never grants inference capability.
    if (secrets.contains(data)) continue;
    if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data)) continue;
    const rows = data.data;
    if (rows.length > 200 || 'has_more' in data && data.has_more === true) truncated = true;
    // Only model IDs, never display names/descriptions/errors from a supplier.
    for (const row of rows.slice(0, 200)) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !/^[\w./:-]{1,256}$/u.test(row.id) || row.id.includes(apiKey)) continue;
      if (ids.size >= 200 && !ids.has(row.id)) { truncated = true; break; }
      ids.add(row.id);
    }
    listed = true;
    // A successful auth/list response suggests a family only. Both OpenAI
    // protocols share /models; even Anthropic-shaped data cannot prove Messages.
    for (const entry of protocols) if (mode === 'messages' ? entry.protocol === 'anthropic_messages' : entry.protocol !== 'anthropic_messages') entry.state = 'candidate';
  }
  await current();
  return { observation: 'metadata_only', observedAt, models: [...ids].sort(), truncated,
    state: ids.size ? 'listed' : listed ? 'empty' : authFailed ? 'authentication_failed' : 'unavailable', protocols };
}
