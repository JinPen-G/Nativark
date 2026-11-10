/** Original API host factory for safe issuer-mapping Web metadata. Reuses current
 * tenant integration management, active target account and native original audit;
 * the original store alone creates/preserves the opaque subject. No MFA/grant,
 * new role system, listener, environment read or Nest/Guard route is installed. */
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpSubjectManagement } from './original-mcp-subject-management';
import type { createMcpSubjectControlPlane, McpSubjectControlPlaneConfig } from '@rental-os/mcp-server/subject-control-plane';
import type { createPrismaOAuthSubjectStore, captureOAuthSubjectReceipt } from '@rental-os/mcp-server/prisma-oauth-subject-store';
import type { OAuthSqlDatabase } from '@rental-os/mcp-server/prisma-oauth-store';
export interface OriginalMcpSubjectPackageExports {
  createMcpSubjectControlPlane: typeof createMcpSubjectControlPlane;
  createPrismaOAuthSubjectStore: typeof createPrismaOAuthSubjectStore;
  captureOAuthSubjectReceipt: typeof captureOAuthSubjectReceipt;
}
export function createOriginalMcpSubjectControlPlane(
  mcp: OriginalMcpSubjectPackageExports, config: McpSubjectControlPlaneConfig,
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceSubjectManagement'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  database: OAuthSqlDatabase<Prisma.TransactionClient>
): ReturnType<typeof createMcpSubjectControlPlane> {
  if (typeof mcp?.createMcpSubjectControlPlane !== 'function' || typeof mcp.createPrismaOAuthSubjectStore !== 'function'
    || typeof mcp.captureOAuthSubjectReceipt !== 'function' || typeof auth?.resolveTrustedBrowserPrincipal !== 'function'
    || typeof platform?.assertTrustedWorkspaceSubjectManagement !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function'
    || typeof database?.$transaction !== 'function') throw new Error('Original MCP subject composition unavailable');
  const resourceUrl = config.resourceUrl, createStore = mcp.createPrismaOAuthSubjectStore, captureReceipt = mcp.captureOAuthSubjectReceipt;
  return mcp.createMcpSubjectControlPlane<Prisma.TransactionClient>(config, { forRequest(browser) {
    const fixed = new Request(browser.url, { method: browser.method, headers: new Headers(browser.headers), signal: browser.signal });
    const manager = createOriginalMcpSubjectManagement({ receipt: captureReceipt }, { resourceUrl }, auth, platform, fixed, logs);
    return createStore<Prisma.TransactionClient>({ resourceUrl }, database, manager);
  } });
}
