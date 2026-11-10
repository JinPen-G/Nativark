/** Original catalog-goal Web composition over this SAME OAuth Core.
 * Original Auth/Guard/nonce/verification/adoption/OperationLog remain the owners;
 * importing or constructing opens no listener, publishes no MCP business tool,
 * installs no Nest route or grants no default MFA/field/counter permission. */
import type { createMcpCatalogGoalControlPlane, McpCatalogGoalControlPlaneConfig } from '@rental-os/mcp-server/catalog-goal-control-plane' with { 'resolution-mode':'import' };
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { OperationLogService } from '../../common/operation-log.service';
import type { OriginalMcpOAuthCore } from './original-mcp-oauth-core';
import { createOriginalMcpCatalogGoalIntentAuthority } from './original-mcp-catalog-goal-intent-authority';
import type { OriginalCatalogGoalIntentVerificationSource } from './original-mcp-catalog-goal-intent-authority';
export type OriginalMcpCatalogGoalPackageExports = Parameters<typeof createOriginalMcpCatalogGoalIntentAuthority>[0]
  & { createMcpCatalogGoalControlPlane: typeof createMcpCatalogGoalControlPlane };
export function createOriginalMcpCatalogGoalControlPlane(
  mcp: OriginalMcpCatalogGoalPackageExports,config: McpCatalogGoalControlPlaneConfig,
  original: Pick<OriginalMcpOAuthCore,'store'|'grantAuthority'>,
  auth: Pick<AuthService,'resolveTrustedBrowserPrincipal'|'withTrustedWorkspacePrincipal'>,
  guard: Pick<ApiAuthGuard,'withTrustedCatalogRead'>,
  logs: Parameters<typeof createOriginalMcpCatalogGoalIntentAuthority>[5],
  verification: OriginalCatalogGoalIntentVerificationSource
): ReturnType<typeof createMcpCatalogGoalControlPlane> {
  if (typeof mcp?.createMcpCatalogGoalControlPlane !== 'function') throw new Error('Original MCP catalog goal composition unavailable');
  const authority=createOriginalMcpCatalogGoalIntentAuthority(mcp,config,original,auth,guard,logs,verification);
  return mcp.createMcpCatalogGoalControlPlane(config,authority);
}
