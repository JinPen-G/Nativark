/** Original host assembly: one OAuth core/native database plus existing Web
 * control planes, fixed disjoint routes and shared close. Missing review evidence
 * disables review handling, never manufactures verification/approval. Not a Nest
 * registration, listener, new role/runtime/ledger or business publication permit. */
import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import type { AuthService } from './auth.service';
import type { PlatformService } from '../platform/platform.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpOAuthCore } from './original-mcp-oauth-core';
import type { OriginalMcpOAuthCoreExports } from './original-mcp-oauth-core';
import { createOriginalMcpReviewControlPlane } from './original-mcp-review-control-plane';
import type { OriginalMcpReviewPackageExports } from './original-mcp-review-control-plane';
import { createOriginalMcpGrantControlPlane } from './original-mcp-grant-control-plane';
import type { OriginalMcpGrantPackageExports } from './original-mcp-grant-control-plane';
import { createOriginalMcpAdmissionControlPlane } from './original-mcp-admission-control-plane';
import type { OriginalMcpAdmissionPackageExports } from './original-mcp-admission-control-plane';
import { createOriginalMcpReviewedGovernanceControlPlane } from './original-mcp-reviewed-governance-control-plane';
import type { OriginalReviewedGovernancePackageExports } from './original-mcp-reviewed-governance-control-plane';
import { createOriginalMcpSubjectControlPlane } from './original-mcp-subject-control-plane';
import type { OriginalMcpSubjectPackageExports } from './original-mcp-subject-control-plane';
import { createOriginalMcpCatalogGoalControlPlane } from './original-mcp-catalog-goal-control-plane';
import type { OriginalMcpCatalogGoalPackageExports } from './original-mcp-catalog-goal-control-plane';
import type { OriginalCatalogGoalIntentVerificationSource } from './original-mcp-catalog-goal-intent-authority';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { McpCatalogGoalControlPlaneConfig } from '@rental-os/mcp-server/catalog-goal-control-plane' with { 'resolution-mode':'import' };
import type { OriginalClientReviewVerificationSource } from './original-mcp-client-review-management';
import type { OriginalNoticeReviewVerificationSource } from './original-mcp-notice-review-management';
import type { createMcpHostRouter } from '@rental-os/mcp-server/host-router';
import type { createPrismaOAuthConsentPolicyReader } from '@rental-os/mcp-server/prisma-oauth-consent-policy-store';
import type { McpReviewControlPlaneConfig } from '@rental-os/mcp-server/review-control-plane';
import type { McpGrantControlPlaneConfig } from '@rental-os/mcp-server/grant-control-plane';
import type { McpAdmissionControlPlaneConfig } from '@rental-os/mcp-server/admission-control-plane';
import type { McpReviewedGovernanceConfig } from '@rental-os/mcp-server/reviewed-governance-control-plane';
import type { McpSubjectControlPlaneConfig } from '@rental-os/mcp-server/subject-control-plane';
import type { createMcpConsentControlPlane, McpConsentControlPlaneConfig } from '@rental-os/mcp-server/consent-control-plane';
export type OriginalMcpHostExports = OriginalMcpOAuthCoreExports & OriginalMcpReviewPackageExports & OriginalMcpGrantPackageExports
  & OriginalMcpAdmissionPackageExports & OriginalReviewedGovernancePackageExports & OriginalMcpSubjectPackageExports & Partial<OriginalMcpCatalogGoalPackageExports>
  & { createMcpHostRouter: typeof createMcpHostRouter; createPrismaOAuthConsentPolicyReader: typeof createPrismaOAuthConsentPolicyReader;
    createMcpConsentControlPlane: typeof createMcpConsentControlPlane };
export interface OriginalMcpHostConfig {
  core: Parameters<typeof createOriginalMcpOAuthCore>[1];
  consent: McpConsentControlPlaneConfig;
  review: McpReviewControlPlaneConfig;
  grant: McpGrantControlPlaneConfig;
  admission: McpAdmissionControlPlaneConfig;
  governance: McpReviewedGovernanceConfig;
  subject: McpSubjectControlPlaneConfig;
  /** Optional declared Web goal routes; absent does not register a hidden endpoint. */
  catalogGoal?: McpCatalogGoalControlPlaneConfig;
}
export function createOriginalMcpHost(
  mcp: OriginalMcpHostExports, config: OriginalMcpHostConfig,
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal' | 'consumeTrustedWorkspaceAccess' | 'resolveTrustedBrowserPrincipal' | 'resolveTrustedPlatformBrowserPrincipal'>,
  platform: Pick<PlatformService, 'assertTrustedWorkspaceIntegrationManagement' | 'assertTrustedWorkspaceSubjectManagement'>,
  logs: Pick<OperationLogService,'recordOriginalOAuthAudit'> & Partial<Pick<OperationLogService,'recordOriginalMcpReadGoalAudit'|'recordOriginalMcpCatalogGoalIntentAudit'|'recordOriginalMcpCatalogGoalAdoptionAudit'>>,
  original: Parameters<typeof createOriginalMcpOAuthCore>[4] & {
    reviewVerification?: { client: OriginalClientReviewVerificationSource; notice: OriginalNoticeReviewVerificationSource };
    receiptTraffic?: Parameters<typeof createOriginalMcpGrantControlPlane>[5]['receiptTraffic'];
    catalogGoal?: { guard: Pick<ApiAuthGuard,'withTrustedCatalogRead'>;verification: OriginalCatalogGoalIntentVerificationSource } }
): ReturnType<typeof createMcpHostRouter> {
  const service = config.core.service, resource = service.resource.resourceUrl, enabled = service.enabled, scopes = service.tokens.allowedScopes;
  if (typeof mcp?.createMcpHostRouter !== 'function' || typeof mcp.createPrismaOAuthConsentPolicyReader !== 'function' || typeof mcp.createMcpConsentControlPlane !== 'function'
    || [config.consent, config.review, config.grant, config.admission, config.governance, config.subject].some(value => value.enabled !== enabled)
    || [config.consent.resourceUrl, config.review.notice.resourceUrl, config.grant.resourceUrl, config.admission.resourceUrl, config.governance.resourceUrl, config.subject.resourceUrl].some(value => value !== resource)
    || config.consent.authorizationEndpoint !== service.authorization.authorizationEndpoint || config.consent.decisionEndpoint !== config.core.consentEndpoint
    || !isDeepStrictEqual(config.consent.allowedScopes, scopes) || !isDeepStrictEqual(config.review.client.allowedScopes, scopes)
    || !isDeepStrictEqual(config.admission.allowedScopes, scopes)) throw new Error('Original MCP host pins unavailable');
  if (config.catalogGoal !== undefined && (config.catalogGoal.enabled !== enabled || config.catalogGoal.resourceUrl !== resource
    || !isDeepStrictEqual(config.catalogGoal.allowedScopes,scopes) || typeof mcp.createMcpCatalogGoalControlPlane !== 'function')) throw new Error('Original MCP host goal pins unavailable');
  if (original.catalogGoal !== undefined && config.catalogGoal === undefined) throw new Error('Original MCP host goal pins unavailable');
  // Construction starts no I/O; each actual request still resolves original current
  // identity/review in this one database. No caller-selected store is accepted.
  const core = createOriginalMcpOAuthCore(mcp, config.core, auth, logs, original);
  const consent = mcp.createMcpConsentControlPlane<Prisma.TransactionClient>(config.consent,
    { webConsent: core.webConsent, registrations: core.registrations });
  const policies = mcp.createPrismaOAuthConsentPolicyReader<Prisma.TransactionClient>({ resourceUrl: resource });
  const review = original.reviewVerification === undefined ? mcp.createMcpReviewControlPlane(config.review)
    : createOriginalMcpReviewControlPlane(mcp, config.review, auth, platform, logs,
      { database: original.database, registrations: core.registrations, policies }, original.reviewVerification);
  const governance = createOriginalMcpReviewedGovernanceControlPlane(mcp, config.governance, auth, platform, logs,
    { database: original.database, ...(review.clientReview === undefined ? {} : { clientReview: review.clientReview.source }),
      ...(review.noticeReview === undefined ? {} : { noticeReview: review.noticeReview.source }) });
  const grant = createOriginalMcpGrantControlPlane(mcp, config.grant, auth, platform, logs,
    { database: original.database, usage: core.grantUse, admission: core.grantAdmission,
      ...(original.receiptTraffic === undefined ? {} : { receiptTraffic: original.receiptTraffic }) });
  const admission = createOriginalMcpAdmissionControlPlane(mcp, config.admission, auth, platform, logs,
    { database: original.database, registrations: core.registrations });
  const subject = createOriginalMcpSubjectControlPlane(mcp, config.subject, auth, platform, logs, original.database);
  const catalogGoal = config.catalogGoal === undefined ? undefined : (() => {
    if (typeof mcp.createMcpCatalogGoalControlPlane !== 'function') throw new Error('Original MCP host goal unavailable');
    if (original.catalogGoal === undefined) return mcp.createMcpCatalogGoalControlPlane(config.catalogGoal);
    if (typeof mcp.captureMcpReadInput !== 'function' || typeof mcp.createPrismaMcpCatalogGoals !== 'function' || mcp.ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION !== 'catalog-admission-1'
      || typeof logs.recordOriginalMcpReadGoalAudit !== 'function' || typeof logs.recordOriginalMcpCatalogGoalIntentAudit !== 'function') throw new Error('Original MCP host goal unavailable');
    const pkg: OriginalMcpCatalogGoalPackageExports = { captureMcpReadInput:mcp.captureMcpReadInput,createPrismaMcpCatalogGoals:mcp.createPrismaMcpCatalogGoals,
      ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION:mcp.ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION,createMcpCatalogGoalControlPlane:mcp.createMcpCatalogGoalControlPlane,
      ...(mcp.createPrismaMcpCatalogGoalAdoptions === undefined ? {} : { createPrismaMcpCatalogGoalAdoptions:mcp.createPrismaMcpCatalogGoalAdoptions }) };
    const originalLogs = { recordOriginalMcpReadGoalAudit:logs.recordOriginalMcpReadGoalAudit.bind(logs),recordOriginalMcpCatalogGoalIntentAudit:logs.recordOriginalMcpCatalogGoalIntentAudit.bind(logs),
      ...(logs.recordOriginalMcpCatalogGoalAdoptionAudit === undefined ? {} : { recordOriginalMcpCatalogGoalAdoptionAudit:logs.recordOriginalMcpCatalogGoalAdoptionAudit.bind(logs) }) };
    return createOriginalMcpCatalogGoalControlPlane(pkg,config.catalogGoal,core,auth,original.catalogGoal.guard,originalLogs,original.catalogGoal.verification);
  })();
  const routes = [
    ...[config.consent.prepareEndpoint, config.consent.decisionEndpoint, config.consent.receiptEndpoint,
      ...(config.consent.referenceEndpoint === undefined ? [] : [config.consent.referenceEndpoint])].map(url => ({ url, component: 'consent' })),
    ...[config.review.client.prepareEndpoint, config.review.client.decisionEndpoint, config.review.client.receiptEndpoint,
      config.review.notice.prepareEndpoint, config.review.notice.decisionEndpoint, config.review.notice.receiptEndpoint].map(url => ({ url, component: 'review' })),
    ...[config.grant.listEndpoint, config.grant.summaryEndpoint, config.grant.revocationEndpoint, config.grant.receiptEndpoint,
      ...[config.grant.readCallReceiptEndpoint, config.grant.readCallListEndpoint].filter((url): url is string => url !== undefined)].map(url => ({ url, component: 'grant' })),
    ...[config.admission.readEndpoint, config.admission.saveEndpoint, config.admission.receiptEndpoint].map(url => ({ url, component: 'admission' })),
    ...[config.governance.client.readEndpoint, config.governance.client.saveEndpoint, config.governance.client.receiptEndpoint,
      config.governance.notice.readEndpoint, config.governance.notice.saveEndpoint, config.governance.notice.receiptEndpoint].map(url => ({ url, component: 'governance' })),
    ...[config.subject.readEndpoint, config.subject.saveEndpoint, config.subject.receiptEndpoint].map(url => ({ url, component: 'subject' })),
    ...(config.catalogGoal === undefined ? [] : [config.catalogGoal.prepareEndpoint,config.catalogGoal.decideEndpoint,config.catalogGoal.receiptEndpoint,
      ...(config.catalogGoal.adoptEndpoint === undefined ? [] : [config.catalogGoal.adoptEndpoint])].map(url=>({ url,component:'catalogGoal' }))),
  ];
  return mcp.createMcpHostRouter({ service, routes }, { service: core.service, consent, review, grant, admission, governance, subject,...(catalogGoal === undefined ? {} : { catalogGoal }) });
}
