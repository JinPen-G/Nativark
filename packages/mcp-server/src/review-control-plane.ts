/** Original-host Web review composition. One fixed-origin fetch/close entry for
 * existing client/notice prepare, decision and receipt handlers. Not MCP business
 * tools, login UI, an HTTP listener, Auth/Guard replacement or projection save.
 * Unknown/timeout/close never prove rollback or authorize another attempt. */
import { createPrismaPublicClientReview, PublicClientReviewError } from "./prisma-public-client-review.js";
import type { OriginalPublicClientReviewManagement, PrismaPublicClientReview } from "./prisma-public-client-review.js";
import { createPrismaOAuthNoticeReview, OAuthNoticeReviewError } from "./prisma-oauth-notice-review.js";
import type { OriginalOAuthNoticeReviewManagement, PrismaOAuthNoticeReview } from "./prisma-oauth-notice-review.js";
import type { PrismaPublicClientRegistry } from "./prisma-public-client-registry.js";
import type { PrismaOAuthConsentPolicyStore } from "./prisma-oauth-consent-policy-store.js";
import type { OAuthSqlDatabase, OAuthSqlTransaction } from "./prisma-oauth-store.js";
import { snapshotJson } from "./json-snapshot.js";
import { createOriginalWebControlPlane } from "./web-control-plane.js";
export interface McpReviewControlPlaneConfig {
  enabled: boolean; requestTimeoutMs: number; maxResponseBytes: number;
  client: Omit<Parameters<typeof createPrismaPublicClientReview>[0], "enabled">;
  notice: Omit<Parameters<typeof createPrismaOAuthNoticeReview>[0], "enabled">;
}
export interface OriginalMcpReviewControlPlaneDependencies<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  database: OAuthSqlDatabase<Native>;
  registrations: Pick<PrismaPublicClientRegistry<Native>, "readIn">;
  policies: Pick<PrismaOAuthConsentPolicyStore<Native>, "readIn">;
  clientManagement: OriginalPublicClientReviewManagement<Native>;
  noticeManagement: OriginalOAuthNoticeReviewManagement<Native>;
}
export interface McpReviewControlPlane<Native extends OAuthSqlTransaction = OAuthSqlTransaction> {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
  /** Internal original-host sources only, never HTTP identity or model output. */
  clientReview: PrismaPublicClientReview<Native> | undefined;
  noticeReview: PrismaOAuthNoticeReview<Native> | undefined;
}
export function createMcpReviewControlPlane<Native extends OAuthSqlTransaction = OAuthSqlTransaction>(
  raw: McpReviewControlPlaneConfig, original?: OriginalMcpReviewControlPlaneDependencies<Native>
): McpReviewControlPlane<Native> {
  const config = snapshotJson(raw, { stringCharacters: 2048, arrayItems: 32 }) as unknown as McpReviewControlPlaneConfig;
  const clientReview = original ? createPrismaPublicClientReview({ ...config.client, enabled: config.enabled }, original.database, original.registrations, original.clientManagement) : undefined;
  const noticeReview = original ? createPrismaOAuthNoticeReview({ ...config.notice, enabled: config.enabled }, original.database, original.policies, original.noticeManagement) : undefined;
  const endpoints = [config.client.prepareEndpoint, config.client.decisionEndpoint, config.client.receiptEndpoint,
    config.notice.prepareEndpoint, config.notice.decisionEndpoint, config.notice.receiptEndpoint];
  const handlers = clientReview && noticeReview ? [clientReview.prepare.bind(clientReview), clientReview.decide.bind(clientReview), clientReview.receipt.bind(clientReview),
    noticeReview.prepare.bind(noticeReview), noticeReview.decide.bind(noticeReview), noticeReview.receipt.bind(noticeReview)] : undefined;
  const transport = createOriginalWebControlPlane(config, endpoints.map((url, index) => ({ url, method: index % 3 === 2 ? "GET" as const : "POST" as const,
    ...(handlers === undefined ? {} : { handle: handlers[index]! }) })),
    { prefix: "review", kind: error => error instanceof PublicClientReviewError || error instanceof OAuthNoticeReviewError ? error.kind : undefined });
  return Object.freeze({ ...transport, clientReview, noticeReview });
}
