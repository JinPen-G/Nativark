/** Authenticated JSON-RPC discovery classification over actual body methods.
 * SDK still owns message/method validation, Tools lists and era projection. No
 * header/clientInfo exemption, business admission, listener or anonymous-IP policy. */
import { isJSONRPCRequest } from '@modelcontextprotocol/server';
import { isDeepStrictEqual } from 'node:util';
import { snapshotJson, snapshotJsonFields } from './json-snapshot.js';
import { createOriginalMcpTrafficMeter } from './original-traffic-meter.js';
import type { OriginalMcpTrafficPolicySource } from './original-traffic-meter.js';
import { createPersistentOAuthAccessReader } from './persistent-oauth-tokens.js';
import type { PrismaOAuthStore, OAuthSqlTransaction } from './prisma-oauth-store.js';
import type { PrismaOAuthGrantAuthority } from './prisma-oauth-grant-authority.js';
import type { McpReadAuthorization } from './read-tools.js';
const methods = Object.freeze({ initialize:'mcp.initialize', 'server/discover':'mcp.server.discover',
  'tools/list':'mcp.tools.list', 'prompts/list':'mcp.prompts.list', 'prompts/get':'mcp.prompts.get',
  'resources/list':'mcp.resources.list', 'resources/templates/list':'mcp.resources.templates.list' } as const);
export type McpProtocolTrafficOperation = typeof methods[keyof typeof methods];
export interface McpProtocolTraffic {
  /** Original current resource/grant/identity and independent class-rate source.
   * Called only for body-derived discovery operations, never business arguments. */
  consume(authorization: McpReadAuthorization, operations: readonly McpProtocolTrafficOperation[], signal: AbortSignal): Promise<void>;
}
const fail = () => new Error('Original MCP protocol traffic unavailable');
/** Extract fixed discovery operations from the ORIGINAL parsed JSON-RPC body.
 * Per-method validators still run in the SDK. Mixed legacy batches count every
 * matching request, never their first method; notifications/responses do not
 * become requests. No mutation/stripping of the body passed back to the SDK.
 * @param body - raw JSON from the bounded original HTTP request.
 * @returns fixed server operations only; tool/resource calls remain business. */
export function originalMcpProtocolOperations(body: unknown): readonly McpProtocolTrafficOperation[] {
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length > 50) throw fail(); // Bounded batch; never silently truncate.
  const result: McpProtocolTrafficOperation[] = [];
  for (const message of messages) {
    if (!isJSONRPCRequest(message) || !Object.hasOwn(methods, message.method)) continue;
    result.push(methods[message.method as keyof typeof methods]);
  }
  return Object.freeze(result);
}
/** Same original store/grant Native as the OAuth core. Independent discovery
 * counters do not create goals, count business calls or prove a delivery/commit.
 * @param config - fixed original resource/scope pins.
 * @param original - this core's existing persistent store/grant authority.
 * @param policy - original approved discovery limits, no defaults or human facts.
 * @returns a method-bound source for the authenticated transport. */
export function createPrismaMcpProtocolTraffic<Native extends OAuthSqlTransaction>(
  config: Parameters<typeof createPersistentOAuthAccessReader>[0],
  original: { store: PrismaOAuthStore<Native>; grantAuthority: PrismaOAuthGrantAuthority },
  policy: OriginalMcpTrafficPolicySource<Native>
): McpProtocolTraffic {
  if (typeof original?.store?.transaction !== 'function' || typeof original.store.native !== 'function'
    || typeof original.grantAuthority?.principal !== 'function') throw fail();
  const reader = createPersistentOAuthAccessReader(config, original.grantAuthority.access), meter = createOriginalMcpTrafficMeter(policy);
  const transact = original.store.transaction.bind(original.store), nativeIn = original.store.native.bind(original.store), principal = original.grantAuthority.principal.bind(original.grantAuthority);
  return Object.freeze({ async consume(authorization: McpReadAuthorization, operations: readonly McpProtocolTrafficOperation[], signal: AbortSignal): Promise<void> {
    try {
      if (signal.aborted) throw fail();
      const selected = snapshotJson(operations, { stringCharacters:200, arrayItems:50 });
      if (!Array.isArray(selected) || !selected.length) throw fail();
      const fixed: McpProtocolTrafficOperation[] = selected.map(operation => {
        if (typeof operation !== 'string' || !Object.values(methods).some(value => value===operation)) throw fail();
        return operation as McpProtocolTrafficOperation;
      });
      const scope = Object.freeze({ ...authorization, scopes:Object.freeze([...authorization.scopes]) });
      await transact(async tx => {
        const before = await reader.readIn(tx, scope.token, signal), a = before.authorization;
        if (a.subject !== scope.subject || a.clientId !== scope.clientId || a.resource !== scope.resource || !isDeepStrictEqual(a.scopes, scope.scopes)) throw fail();
        const owner = await principal(before.grantId, tx, signal); if (!owner || signal.aborted) throw fail();
        const who = snapshotJsonFields(owner, ['userId','tenantId','workspaceId','audience'], { stringCharacters:200, arrayItems:1 });
        if (who.audience !== 'operator' || typeof who.userId !== 'string' || typeof who.tenantId !== 'string' || typeof who.workspaceId !== 'string') throw fail();
        const native = nativeIn(tx);
        for (const operation of fixed) {
          await meter.consumeIn(operation, { userId:who.userId, tenantId:who.tenantId, workspaceId:who.workspaceId }, native, signal);
        }
        if (!isDeepStrictEqual(await principal(before.grantId, tx, signal), owner)
          || !isDeepStrictEqual(await reader.readIn(tx, scope.token, signal), before) || signal.aborted) throw fail();
      }, signal);
    } catch { throw fail(); } // Unknown commit never causes replay/refund.
  } });
}
