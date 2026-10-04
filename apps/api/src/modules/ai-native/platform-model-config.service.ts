import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import { TenantModelConfigService, type TenantModelConfigPorts } from './tenant-model-config.service';
import { SecretBox } from '../../common/secret-box';

export type AiServiceMode = 'platform_managed' | 'tenant_managed';
export interface PlatformModelConfigSummary {
  mode: AiServiceMode; revision: number; serviceName?: string; availability?: 'not_verified';
  protocol?: string; baseUrl?: string; model?: string; enabled?: boolean; keyConfigured?: boolean;
  timeoutMs?: number; maxConcurrent?: number; maxOutputTokens?: number;
}
/**
 * Dual-track configuration facade. It deliberately exposes no provider key and
 * does not treat platform mode as a provider route; the later Router supplies
 * platform credentials through a separate server-owned profile.
 */
export class PlatformModelConfigService {
  private readonly tenant: TenantModelConfigService;
  constructor(ports: TenantModelConfigPorts, secrets: SecretBox) { this.tenant = new TenantModelConfigService(ports, secrets); }
  async get(context: GatewayContext): Promise<PlatformModelConfigSummary> { return this.tenant.get(context); }
  async saveTenantService(context: GatewayContext, input: unknown): Promise<PlatformModelConfigSummary> {
    const summary = await this.tenant.save(context, input);
    if (summary.mode !== 'tenant_managed') throw new ModelGatewayError('CONFIG_INVALID');
    return summary;
  }
  async clearTenantService(context: GatewayContext, expectedRevision: number): Promise<PlatformModelConfigSummary> {
    const current = await this.tenant.get(context);
    if (current.mode !== 'tenant_managed' || !current.protocol || !current.baseUrl || !current.model) {
      throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
    }
    return this.saveTenantService(context, {
      expectedRevision,
      enabled: current.enabled ?? false,
      protocol: current.protocol,
      baseUrl: current.baseUrl,
      model: current.model,
      timeoutMs: current.timeoutMs,
      maxConcurrent: current.maxConcurrent,
      maxOutputTokens: current.maxOutputTokens,
      secretChange: { operation: 'clear' },
    });
  }
  async switchMode(context: GatewayContext, mode: AiServiceMode, expectedRevision: number): Promise<PlatformModelConfigSummary> {
    return this.tenant.changeMode(context, { mode, expectedRevision });
  }
  async selection(context: GatewayContext) { return this.tenant.selection(context); }
  async selectionForInvocation(context: GatewayContext) { return this.tenant.selectionForInvocation(context); }
  async tenantProfile(context: GatewayContext) { return this.tenant.profile(context); }
  async tenantCredential(reference: string, context: GatewayContext) { return this.tenant.credential(reference, context); }
}
