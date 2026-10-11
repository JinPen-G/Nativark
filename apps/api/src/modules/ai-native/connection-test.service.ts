import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { capabilityNameSchema } from './capability-verification';
import { ModelGatewayError, type GatewayContext, type ModelRequest } from './model-gateway.ports';
import type { AiProfileCapability, AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderCapabilityService } from './provider-capability.service';

export interface GatewayConnectionProbe {
  invoke(context: GatewayContext, request: ModelRequest): Promise<{
    text: string;
    usage?: unknown;
    /** Typed channels are intentionally optional: missing channels are a failed challenge, not text evidence. */
    toolRequests?: unknown[];
    structuredOutput?: unknown;
  }>;
}
export interface ConnectionTestResult { capability: AiProfileCapability; status: 'supported' | 'unsupported' | 'unverified'; errorCode?: string; evidenceHash: string; }
const featureFor = (capability: AiProfileCapability): ModelRequest['features'] => capability === 'streaming' ? ['streaming'] : capability === 'tools' ? ['tools'] : capability === 'structured_output' ? ['structuredOutput'] : undefined;
/** Controlled probe: no provider SDK or secret is accepted here; Gateway owns routing/credentials/admission. */
export class AiConnectionTestService {
  constructor(private readonly gateway: GatewayConnectionProbe, private readonly evidence: Pick<ProviderCapabilityService, 'record'>) {}
  async run(context: GatewayContext, profile: AiProviderProfileRecord, capabilities: readonly AiProfileCapability[]): Promise<ConnectionTestResult[]> {
    let boundContext: GatewayContext, boundProfile: AiProviderProfileRecord;
    try { boundContext = structuredClone(context); boundProfile = structuredClone(profile); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    if (!Array.isArray(capabilities) || capabilities.length > capabilityNameSchema.options.length
      || capabilities.some(capability => !capabilityNameSchema.safeParse(capability).success)) throw new ModelGatewayError('INVALID_REQUEST');
    const requested = [...new Set(capabilities)];
    // This guards in-process binding only. The Gateway still owns current
    // authorization/configuration; these snapshots do not attest either.
    const unchanged = () => {
      if (!isDeepStrictEqual(context, boundContext)) throw new ModelGatewayError('FORBIDDEN');
      if (!isDeepStrictEqual(profile, boundProfile)) throw new ModelGatewayError('CONFIG_INVALID');
    };
    const results: ConnectionTestResult[] = [];
    for (const capability of requested) {
      unchanged();
      // Text-only probes cannot distinguish local rejection from provider capability evidence.
      const status = 'unverified';
      let errorCode: string | undefined;
      try {
        // This port has no media/embedding/reasoning challenge or typed result.
        // Do not spend a plain text invocation as if it exercised these modes.
        if (['vision', 'audio', 'embedding', 'reasoning'].includes(capability)) throw new ModelGatewayError('CONFIG_INVALID');
        const result = await this.gateway.invoke(structuredClone(boundContext), { callId: `connection-test:${boundProfile.id}:${boundProfile.configRevision}:${capability}`, model: boundProfile.model, messages: [{ role: 'user', content: 'connection test' }], maxOutputTokens: 8, features: featureFor(capability) });
        if (!result || typeof result.text !== 'string') throw new ModelGatewayError('INVALID_RESPONSE');
        // A plain text response cannot prove a typed capability. Keep the
        // result unverified, but preserve the concrete adapter failure so a
        // missing protocol mapping is visible to configuration owners.
        if (capability === 'tools' && !Array.isArray(result.toolRequests)) {
          throw new ModelGatewayError('INVALID_RESPONSE');
        }
        if (capability === 'structured_output'
          && !Object.prototype.hasOwnProperty.call(result, 'structuredOutput')) {
          throw new ModelGatewayError('INVALID_RESPONSE');
        }
      } catch (error) {
        errorCode = error instanceof ModelGatewayError ? error.code : 'PROVIDER_FAILED';
      }
      // Do not turn identity/config changes into a normal transport failure and
      // write the old probe under another subject or a newer configuration.
      unchanged();
      const evidenceHash = createHash('sha256').update(`${boundProfile.id}:${boundProfile.configRevision}:${capability}:${status}:${errorCode ?? ''}`).digest('hex');
      await this.evidence.record({ profile: structuredClone(boundProfile), capability, status, source: 'connection_test', evidenceHash, checkedAt: new Date(), details: errorCode ? { errorCode } : { result: 'synthetic_probe_only' } });
      unchanged();
      results.push({ capability, status, ...(errorCode ? { errorCode } : {}), evidenceHash });
    }
    return results;
  }
}
