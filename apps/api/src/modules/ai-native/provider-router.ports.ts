import type { AiProfileCapability, AiProfileScope, AiProviderProfileRecord, AiProviderProfileRole, AiProfileServiceMode, ProviderProfileRepository } from './provider-profile.ports';
import type { CapabilityPreflight, ProviderCapabilityService } from './provider-capability.service';

export type AiRouteScene = 'chat' | 'builder' | 'vision' | 'knowledge' | 'reasoning';
export interface ProviderRouteRequest {
  consumerScope: AiProfileScope;
  configurationScope: AiProfileScope;
  mode: AiProfileServiceMode;
  scene: AiRouteScene;
  requiredCapabilities: readonly AiProfileCapability[];
}
export interface ProviderRouteDecision {
  profile: AiProviderProfileRecord;
  scope: AiProfileScope;
  role: AiProviderProfileRole;
  preflight: CapabilityPreflight;
}
export interface ProviderRouterPorts {
  profiles: ProviderProfileRepository;
  capabilities: Pick<ProviderCapabilityService, 'preflight'>;
}
