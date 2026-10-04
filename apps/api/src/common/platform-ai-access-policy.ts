/** Internal action boundary for platform-owned provider configuration only.
 * No Controller, public DTO or automatic role grant is introduced here. */
export const PLATFORM_AI_PROVIDER_PERMISSIONS = {
  view: 'system:ai-provider:view', manage: 'system:ai-provider:manage'
} as const;
export function isPlatformAiProviderPath(path: string): boolean {
  return /^\/platform\/ai\/providers\/[A-Za-z0-9][\w.:-]{0,35}$/u.test(path);
}
export function platformAiProviderPermission(method: string, path: string): string | undefined {
  if (!isPlatformAiProviderPath(path)) return undefined;
  if (method === 'GET') return PLATFORM_AI_PROVIDER_PERMISSIONS.view;
  if (method === 'PUT') return PLATFORM_AI_PROVIDER_PERMISSIONS.manage;
  return undefined;
}
