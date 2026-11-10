/** Original API reviewed-projection Web composition. Actual approved sources,
 * current per-request Web management, CAS and native OperationLog stay separate.
 * Missing review permits only existing exact disable per the original adapters;
 * no request reference becomes approval, no MFA/consent/grant or listener is made. */
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpPublicClientManagement } from './original-mcp-public-client-management';
import { createOriginalMcpConsentPolicyManagement } from './original-mcp-consent-policy-management';
import type { createMcpReviewedGovernanceControlPlane, McpReviewedGovernanceConfig } from '@rental-os/mcp-server/reviewed-governance-control-plane';
import type { createPrismaPublicClientRegistry, PrismaPublicClientRegistry, captureRegisteredPublicClient, capturePublicClientRegistrationReceipt } from '@rental-os/mcp-server/prisma-public-client-registry';
import type { PublicClientRegistrationReviewSource } from '@rental-os/mcp-server/prisma-public-client-review';
import type { createPrismaOAuthConsentPolicyStore, PrismaOAuthConsentPolicyStore, OriginalOAuthConsentPolicyReviewSource, captureOAuthConsentPolicyTarget, captureOAuthConsentPolicyReceipt } from '@rental-os/mcp-server/prisma-oauth-consent-policy-store';
import type { captureOAuthConsentPolicy } from '@rental-os/mcp-server/prisma-oauth-consent-review';
import type { OAuthSqlDatabase } from '@rental-os/mcp-server/prisma-oauth-store';
export interface OriginalReviewedGovernancePackageExports {
  createMcpReviewedGovernanceControlPlane: typeof createMcpReviewedGovernanceControlPlane;
  createPrismaPublicClientRegistry: typeof createPrismaPublicClientRegistry;
  captureRegisteredPublicClient: typeof captureRegisteredPublicClient;
  capturePublicClientRegistrationReceipt: typeof capturePublicClientRegistrationReceipt;
  createPrismaOAuthConsentPolicyStore: typeof createPrismaOAuthConsentPolicyStore;
  captureOAuthConsentPolicy: typeof captureOAuthConsentPolicy;
  captureOAuthConsentPolicyTarget: typeof captureOAuthConsentPolicyTarget;
  captureOAuthConsentPolicyReceipt: typeof captureOAuthConsentPolicyReceipt;
}
export function createOriginalMcpReviewedGovernanceControlPlane(
  mcp: OriginalReviewedGovernancePackageExports, config: McpReviewedGovernanceConfig,
  auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal' | 'resolveTrustedPlatformBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  original: { database: OAuthSqlDatabase<Prisma.TransactionClient>;
    clientReview?: PublicClientRegistrationReviewSource<Prisma.TransactionClient>;
    noticeReview?: OriginalOAuthConsentPolicyReviewSource<Prisma.TransactionClient> }
): ReturnType<typeof createMcpReviewedGovernanceControlPlane> {
  if (typeof mcp?.createMcpReviewedGovernanceControlPlane !== 'function' || typeof mcp.createPrismaPublicClientRegistry !== 'function'
    || typeof mcp.captureRegisteredPublicClient !== 'function' || typeof mcp.capturePublicClientRegistrationReceipt !== 'function'
    || typeof mcp.createPrismaOAuthConsentPolicyStore !== 'function' || typeof mcp.captureOAuthConsentPolicy !== 'function'
    || typeof mcp.captureOAuthConsentPolicyTarget !== 'function' || typeof mcp.captureOAuthConsentPolicyReceipt !== 'function'
    || typeof auth?.resolveTrustedBrowserPrincipal !== 'function' || typeof auth.resolveTrustedPlatformBrowserPrincipal !== 'function'
    || typeof platform?.assertTrustedWorkspaceIntegrationManagement !== 'function' || typeof logs?.recordOriginalOAuthAudit !== 'function'
    || typeof original?.database?.$transaction !== 'function'
    || original.clientReview !== undefined && typeof original.clientReview?.current !== 'function'
    || original.noticeReview !== undefined && typeof original.noticeReview?.current !== 'function') throw new Error('Original reviewed governance composition unavailable');
  const resourceUrl = config.resourceUrl, database = original.database;
  const runtime = Object.freeze({ createMcpReviewedGovernanceControlPlane: mcp.createMcpReviewedGovernanceControlPlane,
    createPrismaPublicClientRegistry: mcp.createPrismaPublicClientRegistry, captureRegisteredPublicClient: mcp.captureRegisteredPublicClient,
    capturePublicClientRegistrationReceipt: mcp.capturePublicClientRegistrationReceipt, createPrismaOAuthConsentPolicyStore: mcp.createPrismaOAuthConsentPolicyStore,
    captureOAuthConsentPolicy: mcp.captureOAuthConsentPolicy, captureOAuthConsentPolicyTarget: mcp.captureOAuthConsentPolicyTarget,
    captureOAuthConsentPolicyReceipt: mcp.captureOAuthConsentPolicyReceipt });
  const clientReview = original.clientReview === undefined ? undefined : Object.freeze({ current: original.clientReview.current.bind(original.clientReview) });
  const noticeReview = original.noticeReview === undefined ? undefined : Object.freeze({ current: original.noticeReview.current.bind(original.noticeReview) });
  return runtime.createMcpReviewedGovernanceControlPlane<Prisma.TransactionClient>(config, { forRequest(browser) {
    const fixed = new Request(browser.url, { method: browser.method, headers: new Headers(browser.headers), signal: browser.signal });
    let clients: PrismaPublicClientRegistry<Prisma.TransactionClient> | undefined, policies: PrismaOAuthConsentPolicyStore<Prisma.TransactionClient> | undefined;
    const clientManagement = createOriginalMcpPublicClientManagement({ registration: runtime.captureRegisteredPublicClient, receipt: runtime.capturePublicClientRegistrationReceipt }, auth, fixed,
      { readIn(tx, clientId, signal) { if (!clients) throw new Error('Original registry unavailable'); return clients.readIn(tx, clientId, signal); } }, logs, clientReview);
    clients = runtime.createPrismaPublicClientRegistry<Prisma.TransactionClient>(database, clientManagement);
    const policyManagement = createOriginalMcpConsentPolicyManagement({ policy: runtime.captureOAuthConsentPolicy, target: runtime.captureOAuthConsentPolicyTarget, receipt: runtime.captureOAuthConsentPolicyReceipt },
      { resourceUrl }, auth, platform, fixed, { readIn(tx, target, signal) { if (!policies) throw new Error('Original policy unavailable'); return policies.readIn(tx, target, signal); } }, logs, noticeReview);
    policies = runtime.createPrismaOAuthConsentPolicyStore<Prisma.TransactionClient>({ resourceUrl }, database, policyManagement);
    return Object.freeze({ clients, policies });
  } });
}
