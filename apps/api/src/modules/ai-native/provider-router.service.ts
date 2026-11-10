import { z } from 'zod';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileCapability, AiProviderProfileRole } from './provider-profile.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { MAX_AI_PROVIDER_PROFILES } from './provider-profile.ports';
import type { ProviderRouteDecision, ProviderRouteRequest, ProviderRouterPorts, AiRouteScene } from './provider-router.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const capability = z.enum(['text', 'streaming', 'tools', 'structured_output', 'vision', 'audio', 'embedding', 'reasoning']);
const capabilities = z.array(capability).max(8).refine(items => new Set(items).size === items.length);
const platform = z.object({ id: id.max(36), kind: z.literal('PLATFORM') }).strict();
const scopeSchema = z.discriminatedUnion('kind', [platform,
  z.object({ id: id.max(36), kind: z.literal('TENANT'), tenantId: id }).strict(),
  z.object({ id: id.max(36), kind: z.literal('WORKSPACE'), tenantId: id, workspaceId: id }).strict()
]);
const inputSchema = z.object({ consumerScope: scopeSchema, configurationScope: scopeSchema, mode: z.enum(['platform_managed', 'tenant_managed']),
  scene: z.enum(['chat', 'builder', 'vision', 'knowledge', 'reasoning', 'embedding']), requiredCapabilities: capabilities.refine(v => v.length > 0) }).strict();
const profileSchema = z.object({ id: id.max(36), scopeId: id.max(36), scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']),
  profileKey: id.max(64), role: z.enum(['DEFAULT', 'REASONING', 'VISION', 'EMBEDDING']), serviceMode: z.enum(['platform_managed', 'tenant_managed']),
  protocol: id.max(64), provider: z.string().min(1).max(128), model: z.string().min(1).max(256), credentialRef: id,
  configRevision: z.number().int().min(1).max(4294967295), enabled: z.boolean(), disabledAt: z.date().nullable(), allowedCapabilities: capabilities }).strict();
const preflightSchema = z.object({ allowed: z.boolean(), required: capabilities, missing: capabilities, stale: capabilities }).strict();
const roleFor = (scene: AiRouteScene): AiProviderProfileRole => {
  switch (scene) {
    case 'builder': case 'reasoning': return 'REASONING';
    case 'vision': return 'VISION';
    case 'embedding': return 'EMBEDDING';
    // Knowledge answers remain text generation; they never select a vector route.
    case 'knowledge': case 'chat': return 'DEFAULT';
  }
};

/** Pure server routing policy, not authentication or a dispatch lease.
 * Snapshot profile/configRevision must still be revalidated at actual dispatch.
 */
export class ProviderRouterService {
  constructor(private readonly ports: ProviderRouterPorts) {
    if (!ports || typeof ports.profiles?.list !== 'function' || typeof ports.capabilities?.preflight !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  /** Revalidate this selected call, not a fresh winner; new routing candidates do not redispatch it. */
  async assertCurrent(value: ProviderRouteDecision, required: readonly AiProfileCapability[]) {
    const decision = structuredClone(value), profile = profileSchema.parse(decision.profile);
    const current = await this.ports.profiles.get(structuredClone(decision.scope), profile.profileKey);
    if (!current || requestFingerprint(profileSchema.parse(current)) !== requestFingerprint(profile)
      || !current.enabled || current.disabledAt || required.some(capability => !current.allowedCapabilities.includes(capability))) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    const check = preflightSchema.parse(await this.ports.capabilities.preflight(structuredClone(current), [...required]));
    if (!check.allowed || check.missing.length || check.stale.length || check.required.length !== required.length
      || check.required.some(capability => !required.includes(capability))) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  }

  async resolve(value: ProviderRouteRequest): Promise<ProviderRouteDecision> {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const request = structuredClone(parsed.data), scope = request.configurationScope, consumer = request.consumerScope;
    if (request.mode === 'platform_managed' ? scope.kind !== 'PLATFORM'
      : consumer.kind === 'PLATFORM' || scope.kind !== 'TENANT' || scope.tenantId !== consumer.tenantId
        || (consumer.kind === 'TENANT' && consumer.id !== scope.id)) throw new ModelGatewayError('INVALID_REQUEST');
    let rows;
    try { rows = z.array(profileSchema).max(MAX_AI_PROVIDER_PROFILES).parse(await this.ports.profiles.list(structuredClone(scope))); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw new ModelGatewayError('CONFIG_INVALID');
    const desired = roleFor(request.scene);
    const ordered = rows.filter(p => p.enabled && !p.disabledAt && p.serviceMode === request.mode && p.scopeId === scope.id && p.scopeKind === scope.kind
      && (p.role === desired || p.role === 'DEFAULT')).sort((a,b) => {
        const priority = Number(b.role === desired) - Number(a.role === desired);
        return priority || (a.profileKey < b.profileKey ? -1 : a.profileKey > b.profileKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
    if (!ordered.length) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    for (const profile of ordered) {
      if (request.requiredCapabilities.some(c => !profile.allowedCapabilities.includes(c))) continue;
      let check;
      try { check = preflightSchema.parse(await this.ports.capabilities.preflight(structuredClone(profile), [...request.requiredCapabilities])); }
      catch { throw new ModelGatewayError('CONFIG_INVALID'); }
      if (check.required.length !== request.requiredCapabilities.length || check.required.some(c => !request.requiredCapabilities.includes(c))
        || [...check.missing, ...check.stale].some(c => !request.requiredCapabilities.includes(c))
        || (check.allowed && (check.missing.length > 0 || check.stale.length > 0))) throw new ModelGatewayError('CONFIG_INVALID');
      if (check.allowed) return { profile: structuredClone(profile), scope: structuredClone(scope), role: profile.role, preflight: check };
    }
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  }
}
