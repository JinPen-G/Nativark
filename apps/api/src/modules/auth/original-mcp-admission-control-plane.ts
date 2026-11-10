/** Original API host factory for platform/workspace admission Web metadata.
 * Dispatches ONLY to existing current SaaS or exact workspace integration rights;
 * no role copy, cross-scope fallback, consent/MFA exemption or business grant.
 * Actual published captures/factory and one native database are host-supplied;
 * this does not register Nest/Guard routes, read environment or start a listener. */
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpPlatformAdmissionManagement } from './original-mcp-platform-management';
import { createOriginalMcpWorkspaceAdmissionManagement } from './original-mcp-workspace-management';
import type { createMcpAdmissionControlPlane, McpAdmissionControlPlane, McpAdmissionControlPlaneConfig, OriginalMcpAdmissionControlPlaneDependencies } from '@rental-os/mcp-server/admission-control-plane';
import type { captureOAuthAdmissionTarget, OriginalOAuthAdmissionManagement } from '@rental-os/mcp-server/prisma-oauth-admission-store';
export interface OriginalMcpAdmissionPackageExports {
  createMcpAdmissionControlPlane: typeof createMcpAdmissionControlPlane;
  captureOAuthAdmissionTarget: typeof captureOAuthAdmissionTarget;
}
export function createOriginalMcpAdmissionControlPlane(
  mcp: OriginalMcpAdmissionPackageExports, config: McpAdmissionControlPlaneConfig,
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal' | 'resolveTrustedPlatformBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  original: Pick<OriginalMcpAdmissionControlPlaneDependencies<Prisma.TransactionClient>, 'database' | 'registrations'>
): McpAdmissionControlPlane {
  if (typeof mcp?.createMcpAdmissionControlPlane !== 'function' || typeof mcp.captureOAuthAdmissionTarget !== 'function'
    || typeof auth?.resolveTrustedBrowserPrincipal !== 'function' || typeof auth.resolveTrustedPlatformBrowserPrincipal !== 'function'
    || typeof platform?.assertTrustedWorkspaceIntegrationManagement !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function'
    || typeof original?.database?.$transaction !== 'function' || typeof original.registrations?.readIn !== 'function') throw new Error('Original MCP admission composition unavailable');
  const resourceUrl = config.resourceUrl, captureTarget = mcp.captureOAuthAdmissionTarget;
  return mcp.createMcpAdmissionControlPlane<Prisma.TransactionClient>(config, { database: original.database, registrations: original.registrations,
    management: { forRequest(browser) {
      const fixed = new Request(browser.url, { method: browser.method, headers: new Headers(browser.headers), signal: browser.signal });
      const platformManager = createOriginalMcpPlatformAdmissionManagement({ resourceUrl }, auth, fixed, logs);
      const workspaceManager = createOriginalMcpWorkspaceAdmissionManagement({ resourceUrl }, auth, platform, fixed, logs);
      const manager: OriginalOAuthAdmissionManagement<Prisma.TransactionClient> = {
        authorize(tx, request, signal) { const target = captureTarget(request.target);
          return (target.kind === 'platform' ? platformManager : workspaceManager).authorize(tx, request, signal);
        },
        audit(tx, input, signal) { const target = captureTarget(input.target);
          return (target.kind === 'platform' ? platformManager : workspaceManager).audit(tx, input, signal);
        },
      };
      return Object.freeze(manager);
    } },
  });
}
