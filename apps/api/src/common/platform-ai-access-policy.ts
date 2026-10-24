/** Exact permission boundary shared by platform configuration HTTP and its
 * internal current-identity checks. Never grants tenant or invocation access. */
import { AI_PLATFORM_CAPABILITY_HTTP_DRAFT as probe } from '@rental-os/shared';
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
  const read = ['readOriginal', 'readTask', 'inspect', 'readHistory', 'readAccounting', 'readAccountingOperation'] as const;
  const write = ['publish', 'createTask', 'start', 'cancel', 'reconcile', 'readCapabilityReceipt', 'releaseUnsent', 'reconcileAccounting'] as const;
  if (read.some(action => path === `/${probe.basePath}/${probe[action]}`)) return PLATFORM_AI_PROVIDER_PERMISSIONS.view;
  if (write.some(action => path === `/${probe.basePath}/${probe[action]}`)) return PLATFORM_AI_PROVIDER_PERMISSIONS.manage;
  return undefined;
}
