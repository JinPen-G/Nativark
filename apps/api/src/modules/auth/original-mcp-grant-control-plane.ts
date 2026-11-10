/** Original API host factory for safe Web grant management. Reuses original
 * request identity/tenant management and native OperationLog. Actual published
 * runtime captures are host-supplied; no CJS-to-ESM deep import, listener, Nest
 * registration/Guard bypass, model management tools or permissive Auth fallback. */
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpGrantManagement } from './original-mcp-grant-management';
import type { createMcpGrantControlPlane, McpGrantControlPlaneConfig, OriginalMcpGrantControlPlaneDependencies } from '@rental-os/mcp-server/grant-control-plane' with { 'resolution-mode':'import' };
import type { capturePersistedOAuthGrant } from '@rental-os/mcp-server/prisma-oauth-grant-authority' with { 'resolution-mode':'import' };
import type { captureOAuthGrantRevocationReceipt } from '@rental-os/mcp-server/prisma-oauth-grant-management' with { 'resolution-mode':'import' };
export interface OriginalMcpGrantPackageExports {
  createMcpGrantControlPlane: typeof createMcpGrantControlPlane;
  capturePersistedOAuthGrant: typeof capturePersistedOAuthGrant;
  captureOAuthGrantRevocationReceipt: typeof captureOAuthGrantRevocationReceipt;
}
export function createOriginalMcpGrantControlPlane(
  mcp: OriginalMcpGrantPackageExports, config: McpGrantControlPlaneConfig,
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  original: Pick<OriginalMcpGrantControlPlaneDependencies<Prisma.TransactionClient>, 'database' | 'usage' | 'admission' | 'receiptTraffic'>
): ReturnType<typeof createMcpGrantControlPlane<Prisma.TransactionClient>> {
  if (typeof mcp?.createMcpGrantControlPlane !== 'function' || typeof mcp.capturePersistedOAuthGrant !== 'function'
    || typeof mcp.captureOAuthGrantRevocationReceipt !== 'function' || typeof auth?.resolveTrustedBrowserPrincipal !== 'function'
    || typeof platform?.assertTrustedWorkspaceIntegrationManagement !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function'
    || typeof original?.database?.$transaction !== 'function') throw new Error('Original MCP grant composition unavailable');
  const resourceUrl = config.resourceUrl, captures = { grant: mcp.capturePersistedOAuthGrant, receipt: mcp.captureOAuthGrantRevocationReceipt };
  // A separate fixed browser identity is captured for EACH request. Never share a
  // request-bound Web manager across users, scopes or later callbacks.
  return mcp.createMcpGrantControlPlane<Prisma.TransactionClient>(config, { database: original.database, ...(original.usage === undefined ? {} : { usage: original.usage }),
    ...(original.admission === undefined ? {} : { admission: original.admission }),
    ...(original.receiptTraffic === undefined ? {} : { receiptTraffic: original.receiptTraffic }),
    management: { forRequest(browser, grants) { return createOriginalMcpGrantManagement(captures, { resourceUrl }, auth, platform, browser, grants, logs); } } });
}
