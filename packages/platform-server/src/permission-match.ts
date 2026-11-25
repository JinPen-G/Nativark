/** Match permissions already resolved for the current authenticated principal.
 * Uses the original Guard's exact-or-* semantics without expanding permissions
 * or interpreting policy/tool allowlists as authority. Scope and ACL still apply. */
export function hasEffectivePermission(granted: readonly string[], required: string): boolean {
  return Array.isArray(granted) && typeof required === 'string' && required.length > 0
    && (granted.includes(required) || granted.includes('*'));
}
