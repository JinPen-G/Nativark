/** Mirrors the Prisma enum values; regenerated client will replace these with
 * generated enum types without changing the repository boundary. */
export type AiScopeKind = 'PLATFORM' | 'TENANT' | 'WORKSPACE';
export type AiProviderProfileRole = 'DEFAULT' | 'REASONING' | 'VISION' | 'EMBEDDING';
export type AiProfileServiceMode = 'platform_managed' | 'tenant_managed';
export type AiProfileCapability = 'text' | 'streaming' | 'tools' | 'structured_output' | 'vision' | 'audio' | 'embedding' | 'reasoning';
export interface AiProfileScope { id: string; kind: AiScopeKind; tenantId?: string; workspaceId?: string; }
export interface AiProviderProfileRecord {
  id: string; scopeId: string; scopeKind: AiScopeKind; profileKey: string; role: AiProviderProfileRole;
  serviceMode: AiProfileServiceMode; protocol: string; provider: string; model: string;
  credentialRef: string; configRevision: number; enabled: boolean;
  allowedCapabilities: readonly AiProfileCapability[]; disabledAt: Date | null;
}
export interface CreateAiProviderProfile {
  scope: AiProfileScope; profileKey: string; role: AiProviderProfileRole; serviceMode: AiProfileServiceMode;
  protocol: string; provider: string; model: string; credentialRef: string;
  allowedCapabilities: readonly AiProfileCapability[];
}
export interface UpdateAiProviderProfile {
  expectedRevision: number; enabled?: boolean; model?: string; credentialRef?: string;
  allowedCapabilities?: readonly AiProfileCapability[]; disabledAt?: Date | null;
}
/** Shared ceiling for routing/probe discovery. Overflow must fail closed,
 * never silently drop a higher-priority configured profile. */
export const MAX_AI_PROVIDER_PROFILES = 100;
export interface ProviderProfileRepository {
  list(scope: AiProfileScope): Promise<AiProviderProfileRecord[]>;
  get(scope: AiProfileScope, profileKey: string): Promise<AiProviderProfileRecord | null>;
  create(input: CreateAiProviderProfile): Promise<AiProviderProfileRecord>;
  update(scope: AiProfileScope, profileKey: string, input: UpdateAiProviderProfile): Promise<AiProviderProfileRecord | null>;
}
