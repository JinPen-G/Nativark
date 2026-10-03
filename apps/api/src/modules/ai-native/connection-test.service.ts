import { createHash } from 'node:crypto';
import { ModelGatewayError, type GatewayContext, type ModelRequest } from './model-gateway.ports';
import type { AiProfileCapability, AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderCapabilityService } from './provider-capability.service';

export interface GatewayConnectionProbe { invoke(context: GatewayContext, request: ModelRequest): Promise<{ text: string; usage?: unknown }>; }
export interface ConnectionTestResult { capability: AiProfileCapability; status: 'supported' | 'unsupported' | 'unverified'; errorCode?: string; evidenceHash: string; }
const featureFor = (capability: AiProfileCapability): ModelRequest['features'] => capability === 'streaming' ? ['streaming'] : capability === 'tools' ? ['tools'] : capability === 'structured_output' ? ['structuredOutput'] : undefined;
/** Controlled probe: no provider SDK or secret is accepted here; Gateway owns routing/credentials/admission. */
export class AiConnectionTestService {
  constructor(private readonly gateway: GatewayConnectionProbe, private readonly evidence: Pick<ProviderCapabilityService, 'record'>) {}
  async run(context: GatewayContext, profile: AiProviderProfileRecord, capabilities: readonly AiProfileCapability[]): Promise<ConnectionTestResult[]> {
    const results: ConnectionTestResult[] = [];
    for (const capability of [...new Set(capabilities)]) {
      let status: ConnectionTestResult['status'] = 'supported', errorCode: string | undefined;
      try {
        const result = await this.gateway.invoke(context, { callId: `connection-test:${profile.id}:${profile.configRevision}:${capability}`, model: profile.model, messages: [{ role: 'user', content: 'connection test' }], maxOutputTokens: 8, features: featureFor(capability) });
        if (!result || typeof result.text !== 'string') throw new ModelGatewayError('INVALID_RESPONSE');
      } catch (error) {
        errorCode = error instanceof ModelGatewayError ? error.code : 'PROVIDER_FAILED';
        status = errorCode === 'CAPABILITY_UNSUPPORTED' ? 'unsupported' : 'unverified';
      }
      const evidenceHash = createHash('sha256').update(`${profile.id}:${profile.configRevision}:${capability}:${status}:${errorCode ?? ''}`).digest('hex');
      await this.evidence.record({ profile, capability, status, source: 'connection_test', evidenceHash, checkedAt: new Date(), details: errorCode ? { errorCode } : { result: 'synthetic_probe_only' } });
      results.push({ capability, status, ...(errorCode ? { errorCode } : {}), evidenceHash });
    }
    return results;
  }
}
