/** Exact permission boundary shared by platform configuration HTTP and its
 * internal current-identity checks. Never grants tenant or invocation access. */
import { AI_PLATFORM_CAPABILITY_HTTP_DRAFT as probe, AI_PLATFORM_CAPABILITY_HTTP_OPERATIONS } from '@rental-os/shared';
import { AI_PLATFORM_RETENTION_HTTP, AI_PLATFORM_RETENTION_HTTP_CONTRACTS } from '@rental-os/shared';
export const PLATFORM_AI_PROVIDER_PERMISSIONS = {
  view: 'system:ai-provider:view', manage: 'system:ai-provider:manage'
} as const;
export function isPlatformAiProviderPath(path: string): boolean {
  return path === '/platform/ai/providers' || /^\/platform\/ai\/providers\/[A-Za-z0-9][\w.:-]{0,35}(?:\/operations\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}|\/capabilities)?$/u.test(path);
}
export function platformAiProviderPermission(method: string, path: string): string | undefined {
  if (!isPlatformAiProviderPath(path)) return undefined;
  if (method === 'GET') return PLATFORM_AI_PROVIDER_PERMISSIONS.view;
  if (method === 'PUT' && path !== '/platform/ai/providers' && !path.includes('/operations/') && !path.endsWith('/capabilities')) return PLATFORM_AI_PROVIDER_PERMISSIONS.manage;
  return undefined;
}
export function platformCapabilityProbePermission(method: string, path: string): string | undefined {
  if (method.toUpperCase() !== probe.method) return undefined;
  const matched = AI_PLATFORM_CAPABILITY_HTTP_OPERATIONS.find(([action]) => path === `/${probe.basePath}/${probe[action]}`);
  return matched ? PLATFORM_AI_PROVIDER_PERMISSIONS[matched[3]] : undefined;
}
/** Exact SaaS maintenance transport. It does not authorize a workspace resource
 * or enable generation, and unregistered platform-privacy methods stay closed. */
export function platformRetentionPermission(method: string, path: string): string | undefined {
  if (method.toUpperCase() !== 'POST') return undefined;
  const match = Object.entries(AI_PLATFORM_RETENTION_HTTP_CONTRACTS).find(([action]) =>
    path === `/${AI_PLATFORM_RETENTION_HTTP.basePath}/${AI_PLATFORM_RETENTION_HTTP[action as keyof typeof AI_PLATFORM_RETENTION_HTTP_CONTRACTS]}`);
  return match ? PLATFORM_AI_PROVIDER_PERMISSIONS[match[1].write ? 'manage' : 'view'] : undefined;
}
