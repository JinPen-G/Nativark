/** Original API host factory for the published Web review control plane.
 * One native database/reader set and original Auth/management/verification/audit
 * supply both review producers. No listener, .env, Nest registration/Guard bypass,
 * second identity system or permissive verification fallback is installed here. */
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpClientReviewManagement } from './original-mcp-client-review-management';
import type { OriginalClientReviewVerificationSource } from './original-mcp-client-review-management';
import { createOriginalMcpNoticeReviewManagement } from './original-mcp-notice-review-management';
import type { OriginalNoticeReviewVerificationSource } from './original-mcp-notice-review-management';
import type { createMcpReviewControlPlane, McpReviewControlPlane, McpReviewControlPlaneConfig, OriginalMcpReviewControlPlaneDependencies } from '@rental-os/mcp-server/review-control-plane' with { 'resolution-mode': 'import' };
import type { publicClientReviewRegistrationHash } from '@rental-os/mcp-server/prisma-public-client-review' with { 'resolution-mode': 'import' };
import type { oauthNoticeCandidateHash, oauthNoticeScopeKey } from '@rental-os/mcp-server/prisma-oauth-notice-review' with { 'resolution-mode': 'import' };
import type { captureOAuthConsentPolicyTarget } from '@rental-os/mcp-server/prisma-oauth-consent-policy-store' with { 'resolution-mode': 'import' };
export interface OriginalMcpReviewPackageExports {
  createMcpReviewControlPlane: typeof createMcpReviewControlPlane;
  publicClientReviewRegistrationHash: typeof publicClientReviewRegistrationHash;
  oauthNoticeCandidateHash: typeof oauthNoticeCandidateHash;
  oauthNoticeScopeKey: typeof oauthNoticeScopeKey;
  captureOAuthConsentPolicyTarget: typeof captureOAuthConsentPolicyTarget;
}
export function createOriginalMcpReviewControlPlane(
  mcp: OriginalMcpReviewPackageExports,
  config: McpReviewControlPlaneConfig,
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal' | 'resolveTrustedPlatformBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  original: Pick<OriginalMcpReviewControlPlaneDependencies<Prisma.TransactionClient>, 'database' | 'registrations' | 'policies'>,
  verification: { client: OriginalClientReviewVerificationSource; notice: OriginalNoticeReviewVerificationSource }
): McpReviewControlPlane<Prisma.TransactionClient> {
  if (typeof mcp?.createMcpReviewControlPlane !== 'function' || typeof mcp.publicClientReviewRegistrationHash !== 'function'
    || typeof mcp.oauthNoticeCandidateHash !== 'function' || typeof mcp.oauthNoticeScopeKey !== 'function' || typeof mcp.captureOAuthConsentPolicyTarget !== 'function'
    || typeof original?.database?.$transaction !== 'function' || typeof original.registrations?.readIn !== 'function' || typeof original.policies?.readIn !== 'function'
    || typeof verification?.client?.current !== 'function' || typeof verification.notice?.current !== 'function') throw new Error('Original MCP review composition unavailable');
  const clientManagement = createOriginalMcpClientReviewManagement({ registrationHash: mcp.publicClientReviewRegistrationHash }, auth, logs, verification.client);
  const noticeManagement = createOriginalMcpNoticeReviewManagement({ candidateHash: mcp.oauthNoticeCandidateHash, scopeKey: mcp.oauthNoticeScopeKey,
    target: mcp.captureOAuthConsentPolicyTarget }, { resourceUrl: config.notice.resourceUrl }, auth, platform, logs, verification.notice);
  // Native stays Prisma.TransactionClient throughout; the host passes actual
  // formal package exports, not private validators or copied SQL-to-Prisma casts.
  return mcp.createMcpReviewControlPlane<Prisma.TransactionClient>(config, { database: original.database, registrations: original.registrations,
    policies: original.policies, clientManagement, noticeManagement });
}
