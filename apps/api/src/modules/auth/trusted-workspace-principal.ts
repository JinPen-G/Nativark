/** Internal original-identity binding, not an OAuth verifier or client DTO.
 * The original current grant authority supplies these IDs inside its transaction;
 * permissions, roles and data/location scope always come from original storage. */
import type { SystemUserRow } from '@rental-os/shared';

export interface TrustedWorkspacePrincipal {
  readonly userId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly audience: 'operator';
}
export interface AuthAccessContext {
  user: SystemUserRow;
  tenantUser: SystemUserRow;
  workspaceId?: string;
  hasWorkspaces: boolean;
  workspaceValid: boolean;
  /** Original Web sessions only; a trusted workspace ticket is not a Web session. */
  accessSession?: { sessionId: string; expiresAt: number };
}
// A type-only brand; the actual permission to consume this ticket is private to
// the issuing AuthService instance and ends with its enclosing callback.
declare const trustedWorkspaceAccessBrand: unique symbol;
export interface TrustedWorkspaceAccess { readonly [trustedWorkspaceAccessBrand]: true }

export function snapshotTrustedWorkspacePrincipal(value: unknown): TrustedWorkspacePrincipal {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Trusted identity unavailable');
  const fields = ['userId', 'tenantId', 'workspaceId', 'audience'];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== fields.length) throw new Error('Trusted identity unavailable');
  const copy: Record<string, string> = {};
  for (const field of fields) {
    const property = descriptors[field];
    if (!property?.enumerable || !Object.hasOwn(property, 'value') || typeof property.value !== 'string'
      || (field === 'audience' ? property.value !== 'operator' : !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(property.value))) {
      throw new Error('Trusted identity unavailable');
    }
    copy[field] = property.value;
  }
  return Object.freeze(copy) as unknown as TrustedWorkspacePrincipal;
}
