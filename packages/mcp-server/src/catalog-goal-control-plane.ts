/** Fixed trusted Web catalog-goal control transport, NOT MCP business tools.
 * Original owner/nonce/goal participant owns authorization and commit. This only
 * bounds/routes prepare, decide, optional adopt and original-key receipts through
 * the shared close/timeout transport. No listener, retry, role or quota bypass. */
import { snapshotJson } from './json-snapshot.js';
import { createOriginalWebControlPlane } from './web-control-plane.js';
import type { OriginalWebControlPlane } from './web-control-plane.js';
import { createPrismaMcpCatalogGoalIntents, CatalogGoalIntentError } from './prisma-mcp-catalog-goal-intents.js';
import type { OriginalCatalogGoalIntentAuthority } from './prisma-mcp-catalog-goal-intents.js';
import type { OAuthSqlTransaction } from './prisma-oauth-store.js';
import { readOAuthReviewBody } from './prisma-public-client-review.js';
export interface McpCatalogGoalControlPlaneConfig {
  enabled: boolean; resourceUrl: string; allowedScopes: readonly string[]; requiredToolScopes: readonly string[];
  requestTimeoutMs: number; maxResponseBytes: number;
  prepareEndpoint: string; decideEndpoint: string; receiptEndpoint: string; adoptEndpoint?: string;
}
const fail = (kind: CatalogGoalIntentError['kind']) => new CatalogGoalIntentError(kind);
export function createMcpCatalogGoalControlPlane<Native extends OAuthSqlTransaction>(
  raw: McpCatalogGoalControlPlaneConfig, original?: OriginalCatalogGoalIntentAuthority<Native>
): OriginalWebControlPlane {
  const config = snapshotJson(raw,{ stringCharacters:2048,arrayItems:32 }) as unknown as McpCatalogGoalControlPlaneConfig;
  const resource = new URL(config.resourceUrl), scopes = config.allowedScopes, required = config.requiredToolScopes;
  const validScope = (v: unknown) => typeof v === 'string' && /^[\x21\x23-\x5b\x5d-\x7e]{1,128}$/.test(v);
  if (resource.protocol !== 'https:' || resource.username || resource.password || resource.search || resource.hash || resource.href !== config.resourceUrl || resource.href.length > 2048
    || !Array.isArray(scopes) || !scopes.length || scopes.length > 32 || new Set(scopes).size !== scopes.length || scopes.some(v=>!validScope(v))
    || !Array.isArray(required) || !required.length || required.length > 32 || new Set(required).size !== required.length || required.some(v=>!validScope(v)||!scopes.includes(v))) throw fail('invalid');
  const intents = original === undefined ? undefined : createPrismaMcpCatalogGoalIntents(config,original);
  const endpoints = [config.prepareEndpoint,config.decideEndpoint,config.receiptEndpoint];
  if (config.adoptEndpoint !== undefined) endpoints.push(config.adoptEndpoint);
  const prepare = intents?.prepare.bind(intents), decide = intents?.decide.bind(intents), receipt = intents?.receipt.bind(intents), adopt = intents?.adopt.bind(intents);
  const handle = async (browser: Request,signal: AbortSignal,index: number): Promise<unknown> => {
    const url = new URL(browser.url),expected = new URL(endpoints[index]!),post = index !== 2;
    if (url.username || url.password || url.hash || url.href.length > 8192 || post && url.search || browser.headers.has('cookie')) throw fail('invalid');
    const origin=browser.headers.get('origin'),site=browser.headers.get('sec-fetch-site');
    if (post && origin !== expected.origin || origin !== null && origin !== expected.origin || site !== null && !['same-origin','none'].includes(site)) throw fail('denied');
    if (!/^Bearer [^\s]{1,8192}$/i.test(browser.headers.get('authorization') ?? '')) throw fail('denied');
    if (signal.aborted || !intents) throw fail('unavailable');
    if (index === 0) return prepare!(browser,signal);
    if (index === 3) return adopt!(browser,signal);
    if (index === 1) {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(browser.headers.get('content-type') ?? '')) throw fail('invalid');
      let input: Record<string,unknown>;
      try {
        const raw = snapshotJson(JSON.parse(await readOAuthReviewBody(browser,signal,4096)),{ stringCharacters:2048,arrayItems:50 });
        const fields=['operationKey','expectedRevision','decision','nonce','nextInput'];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== fields.length || fields.some(v=>!Object.hasOwn(raw,v))) throw fail('invalid');
        input=raw as Record<string,unknown>;
      } catch { throw fail(signal.aborted ? 'unavailable' : 'invalid'); }
      // The existing private method keeps its original four-field nonce form.
      // nextInput is supplied separately and still checked against the original
      // prepared hash; this does NOT reconstruct an identity or authorization.
      const headers=new Headers(browser.headers);headers.delete('content-length');
      const form=new Request(config.decideEndpoint,{ method:'POST',headers,signal,body:JSON.stringify({ operationKey:input.operationKey,
        expectedRevision:input.expectedRevision,decision:input.decision,nonce:input.nonce }) });
      return decide!(form,input.nextInput,signal);
    }
    const values=[...url.searchParams];
    if (values.length !== 1 || values[0]![0] !== 'operationKey' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(values[0]![1])) throw fail('invalid');
    const canonical=new Request(config.receiptEndpoint,{ headers:new Headers(browser.headers),signal });
    return receipt!(values[0]![1],canonical,signal);
  };
  return createOriginalWebControlPlane(config,endpoints.map((url,index)=>({ url,method:index === 2 ? 'GET' as const : 'POST' as const,
    ...(intents === undefined ? {} : { handle:(browser: Request,signal: AbortSignal)=>handle(browser,signal,index) }) })),
    { prefix:'goal',kind:error=>error instanceof CatalogGoalIntentError ? error.kind : undefined });
}
