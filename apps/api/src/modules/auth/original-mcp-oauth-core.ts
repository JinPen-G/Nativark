/** Original-host OAuth/MCP core composition on ONE native database/store.
 * Reuses original Auth/browser/grant identity, approved policy/MFA reads and audit;
 * owns one completed-read observer, not a second ledger/identity or listener.
 * Internal Web producers are not HTTP/model tools; host routing/lifecycle and real
 * Guard/goal/accounting/field/UI prerequisites remain separate requirements. */
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { OperationLogService } from '../../common/operation-log.service';
import { createOriginalMcpOAuthAudit } from './original-mcp-oauth-audit';
import { createOriginalMcpGrantIdentity } from './original-mcp-grant-identity';
import { createOriginalMcpBrowserIdentity } from './original-mcp-browser-identity';
import type { createRentalMcpService, RentalMcpServiceConfig } from '@rental-os/mcp-server/service' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthStore, OAuthSqlDatabase, PrismaOAuthStore } from '@rental-os/mcp-server/prisma-oauth-store' with { 'resolution-mode': 'import' };
import type { createPrismaPublicClientRegistry, PrismaPublicClientRegistry } from '@rental-os/mcp-server/prisma-public-client-registry' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthAdmissionReader, PrismaOAuthAdmissionStore } from '@rental-os/mcp-server/prisma-oauth-admission-store' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthGrantAuthority, PrismaOAuthGrantAuthority } from '@rental-os/mcp-server/prisma-oauth-grant-authority' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthGrantUseStore, PrismaOAuthGrantUseStore } from '@rental-os/mcp-server/prisma-oauth-grant-use' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthGrantAdmissionSource, OriginalOAuthGrantAdmissionSource } from '@rental-os/mcp-server/prisma-oauth-grant-admission' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthConsentReview, OriginalOAuthVerificationSource } from '@rental-os/mcp-server/prisma-oauth-consent-review' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthWebConsent, PrismaOAuthWebConsent } from '@rental-os/mcp-server/prisma-oauth-web-consent' with { 'resolution-mode': 'import' };
import type { createPrismaOAuthConsentAuthority, PrismaOAuthConsentAuthority } from '@rental-os/mcp-server/prisma-oauth-consent-authority' with { 'resolution-mode': 'import' };
import type { OriginalAuthorizationMetadata } from '@rental-os/mcp-server/authorization-server-metadata' with { 'resolution-mode': 'import' };
import type { McpReadTools } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { createPrismaMcpProtocolTraffic } from '@rental-os/mcp-server/protocol-traffic' with { 'resolution-mode':'import' };
import type { OriginalMcpTrafficPolicySource } from '@rental-os/mcp-server/original-traffic-meter' with { 'resolution-mode':'import' };
/** Construction-only original-host hook; not a model tool or request callback.
 * Receives THIS core's ports before its one standard service is constructed. */
export type OriginalMcpReadCore = Readonly<Pick<OriginalMcpOAuthCore, 'store' | 'grantAuthority'>
  & { database: OAuthSqlDatabase<Prisma.TransactionClient> }>;
export type OriginalMcpReadToolsFactory = (core: OriginalMcpReadCore) => McpReadTools;
export interface OriginalMcpOAuthCoreExports {
  createRentalMcpService: typeof createRentalMcpService;
  createPrismaOAuthStore: typeof createPrismaOAuthStore;
  createPrismaPublicClientRegistry: typeof createPrismaPublicClientRegistry;
  createPrismaOAuthAdmissionReader: typeof createPrismaOAuthAdmissionReader;
  createPrismaOAuthGrantAuthority: typeof createPrismaOAuthGrantAuthority;
  createPrismaOAuthGrantUseStore: typeof createPrismaOAuthGrantUseStore;
  createPrismaOAuthGrantAdmissionSource: typeof createPrismaOAuthGrantAdmissionSource;
  createPrismaOAuthConsentReview: typeof createPrismaOAuthConsentReview;
  createPrismaOAuthWebConsent: typeof createPrismaOAuthWebConsent;
  createPrismaOAuthConsentAuthority: typeof createPrismaOAuthConsentAuthority;
  /** Required only for the explicit original authenticated-discovery policy. */
  createPrismaMcpProtocolTraffic?: typeof createPrismaMcpProtocolTraffic;
}
export interface OriginalMcpOAuthCore {
  service: ReturnType<typeof createRentalMcpService>;
  /** Original-host internal ports only. Never serialize or expose native handles,
   * subject/grant locators, raw factories or Web decision methods as model tools. */
  store: PrismaOAuthStore<Prisma.TransactionClient>;
  registrations: PrismaPublicClientRegistry<Prisma.TransactionClient>;
  admissions: Pick<PrismaOAuthAdmissionStore<Prisma.TransactionClient>, 'readIn'>;
  grantAuthority: PrismaOAuthGrantAuthority;
  grantUse: PrismaOAuthGrantUseStore<Prisma.TransactionClient>;
  grantAdmission: OriginalOAuthGrantAdmissionSource<Prisma.TransactionClient>;
  consentAuthority: PrismaOAuthConsentAuthority;
  webConsent: PrismaOAuthWebConsent<Prisma.TransactionClient>;
}
export function createOriginalMcpOAuthCore(
  mcp: OriginalMcpOAuthCoreExports,
  config: { service: RentalMcpServiceConfig; consentEndpoint: string },
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal' | 'consumeTrustedWorkspaceAccess' | 'resolveTrustedBrowserPrincipal'>,
  logs: Pick<OperationLogService, 'recordOriginalOAuthAudit'>,
  original: { database: OAuthSqlDatabase<Prisma.TransactionClient>; metadata: OriginalAuthorizationMetadata;
    verification?: OriginalOAuthVerificationSource<Prisma.TransactionClient>; createReadTools?: OriginalMcpReadToolsFactory;
    protocolTraffic?: OriginalMcpTrafficPolicySource<Prisma.TransactionClient> }
): OriginalMcpOAuthCore {
  const runtime: OriginalMcpOAuthCoreExports = Object.freeze({ createRentalMcpService: mcp?.createRentalMcpService,
    createPrismaOAuthStore: mcp?.createPrismaOAuthStore, createPrismaPublicClientRegistry: mcp?.createPrismaPublicClientRegistry,
    createPrismaOAuthAdmissionReader: mcp?.createPrismaOAuthAdmissionReader, createPrismaOAuthGrantAuthority: mcp?.createPrismaOAuthGrantAuthority,
    createPrismaOAuthGrantUseStore: mcp?.createPrismaOAuthGrantUseStore,
    createPrismaOAuthGrantAdmissionSource: mcp?.createPrismaOAuthGrantAdmissionSource,
    createPrismaOAuthConsentReview: mcp?.createPrismaOAuthConsentReview, createPrismaOAuthWebConsent: mcp?.createPrismaOAuthWebConsent,
    createPrismaOAuthConsentAuthority: mcp?.createPrismaOAuthConsentAuthority });
  if (Object.values(runtime).some(value => typeof value !== 'function') || typeof original?.database?.$transaction !== 'function'
    || typeof original.metadata?.read !== 'function' || original.verification !== undefined && typeof original.verification?.current !== 'function') throw new Error('Original MCP OAuth core unavailable');
  if (original.protocolTraffic !== undefined && (typeof original.protocolTraffic?.current !== 'function'
    || typeof mcp.createPrismaMcpProtocolTraffic !== 'function' || config.service.resource.protocolTraffic !== undefined)) throw new Error('Original MCP protocol traffic owner unavailable');
  const createProtocolTraffic = mcp.createPrismaMcpProtocolTraffic?.bind(mcp);
  const suppliedReadTools = config.service.resource.readTools;
  if (original.createReadTools !== undefined && (typeof original.createReadTools !== 'function' || suppliedReadTools !== undefined)) {
    throw new Error('Original MCP OAuth core requires one read-provider owner');
  }
  const createReadTools = original.createReadTools?.bind(original);
  if (suppliedReadTools?.usage !== undefined) throw new Error('Original MCP OAuth core owns completed-read usage');
  const resourceUrl = config.service.resource.resourceUrl, allowedScopes = Object.freeze([...config.service.tokens.allowedScopes]);
  const grantConfig = Object.freeze({ enabled: config.service.enabled, resourceUrl, allowedScopes });
  const audit = createOriginalMcpOAuthAudit(logs), identity = createOriginalMcpGrantIdentity(auth), browserIdentity = createOriginalMcpBrowserIdentity(auth);
  const database: OAuthSqlDatabase<Prisma.TransactionClient> = Object.freeze({ $transaction: original.database.$transaction.bind(original.database) });
  const store = runtime.createPrismaOAuthStore<Prisma.TransactionClient>(database, { record: audit.code });
  const registrations = runtime.createPrismaPublicClientRegistry<Prisma.TransactionClient>(database);
  const admissions = runtime.createPrismaOAuthAdmissionReader<Prisma.TransactionClient>({ resourceUrl });
  const verification = original.verification === undefined ? undefined : Object.freeze({ current: original.verification.current.bind(original.verification) });
  const review = runtime.createPrismaOAuthConsentReview<Prisma.TransactionClient>(grantConfig, identity, verification);
  const webConsent = runtime.createPrismaOAuthWebConsent<Prisma.TransactionClient>({ resourceUrl, allowedScopes,
    authorizationEndpoint: config.service.authorization.authorizationEndpoint, consentEndpoint: config.consentEndpoint }, store, registrations, admissions, browserIdentity,
    { current: review.current, audit: audit.consent, auditGrant: audit.grant });
  const consentAuthority = runtime.createPrismaOAuthConsentAuthority<Prisma.TransactionClient>(grantConfig, store, registrations, admissions, identity, webConsent.source);
  const grantAuthority = runtime.createPrismaOAuthGrantAuthority<Prisma.TransactionClient>(grantConfig, store, registrations, identity);
  const grantUse = runtime.createPrismaOAuthGrantUseStore<Prisma.TransactionClient>(grantConfig, store, grantAuthority);
  const grantAdmission = runtime.createPrismaOAuthGrantAdmissionSource<Prisma.TransactionClient>({ resourceUrl }, store, grantAuthority);
  // One synchronous hook breaks the store/grant -> business-authority dependency
  // without constructing another core or service. Failure never falls back to old
  // providers; the hook must not perform I/O or return a Promise/partial binding.
  const readTools = createReadTools ? createReadTools(Object.freeze({ store, grantAuthority, database })) : suppliedReadTools;
  if (createReadTools && (!readTools || !Array.isArray(readTools.tools)
    || typeof readTools.publication?.allows !== 'function' || typeof readTools.authority?.withRead !== 'function'
    || typeof readTools.accounting?.withCall !== 'function' || typeof readTools.release?.project !== 'function')) {
    throw new Error('Original MCP OAuth core read providers unavailable');
  }
  if (readTools?.usage !== undefined) throw new Error('Original MCP OAuth core owns completed-read usage');
  // Observation supplies no Guard/accounting/release and must run after the read
  // transaction. Both legacy and composed providers use this ONE observer.
  const discovery = original.protocolTraffic === undefined ? config.service.resource.protocolTraffic
    : createProtocolTraffic!(grantConfig,{ store,grantAuthority },original.protocolTraffic);
  const protocolResource = discovery === undefined ? config.service.resource : { ...config.service.resource,protocolTraffic:discovery };
  const resource = readTools === undefined ? protocolResource
    : { ...protocolResource, readTools: { ...readTools, usage: grantUse.reads } };
  // Standard AS code/token/resource paths all use exactly this store. Internal
  // Web preparation/decision routing remains with the original trusted host.
  const service = runtime.createRentalMcpService({ ...config.service, resource }, { store, registrations, metadata: original.metadata,
    consent: consentAuthority, issuance: grantAuthority.issuance, access: grantAuthority.access });
  return Object.freeze({ service, store, registrations, admissions, grantAuthority, grantUse, grantAdmission, consentAuthority, webConsent });
}
