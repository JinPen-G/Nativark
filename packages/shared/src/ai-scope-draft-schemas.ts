/** Owned wire scopes, shared by clients, OpenAPI and closed scene schemas.
 * Structural validity is not a current identity or resource authorization. */
import { leafClosed as obj, leafEnum as choice, leafId as id, leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';
export const AI_SCOPE_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiPlatformScope: obj({ kind: choice('platform') }),
  AiTenantScope: obj({ kind: choice('tenant'), tenantId: id() }),
  AiWorkspaceScope: obj({ kind: choice('workspace'), tenantId: id(), workspaceId: id() }),
  AiExecutionScope: { oneOf: [ref('AiPlatformScope'), ref('AiTenantScope'), ref('AiWorkspaceScope')] }
};
