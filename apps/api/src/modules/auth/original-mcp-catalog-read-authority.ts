/** Fixed catalog MCP authority over original credential/grant, Auth and Guard/ALS.
 * Owns no reader, field projection, goal accounting, listener or Web token proxy.
 * One native transaction holds current identity/grant checks through the read;
 * transport mapping and input limits never substitute for original permissions. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { OriginalMcpCatalogGoalPreparation } from './original-mcp-catalog-goals';
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { OriginalMcpOAuthCore } from './original-mcp-oauth-core';
import type { McpReadAuthority, McpReadAuthorization } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { MCP_BUSINESS_CAPABILITIES } from '@rental-os/mcp-server/capability-mapping' with { 'resolution-mode': 'import' };
import type { createPersistentOAuthAccessReader } from '@rental-os/mcp-server/persistent-oauth-tokens' with { 'resolution-mode': 'import' };
import type { captureMcpReadInput } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';
export interface OriginalMcpCatalogAuthorityExports {
  MCP_BUSINESS_CAPABILITIES: typeof MCP_BUSINESS_CAPABILITIES;
  createPersistentOAuthAccessReader: typeof createPersistentOAuthAccessReader;
  /** Required only when the original host supplies a goal subject context. */
  captureMcpReadInput?: typeof captureMcpReadInput;
}
const unavailable = () => new Error('Original MCP catalog read unavailable');
function readLimit(input: unknown): number {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw unavailable();
  const field = Object.getOwnPropertyDescriptor(input, 'limit');
  if (!field?.enumerable || !Object.hasOwn(field, 'value') || !Number.isSafeInteger(field.value) || field.value < 1 || field.value > 50) throw unavailable();
  return field.value;
}
/** Supply only the original catalog authority slot. Other tool names fail closed;
 * the original owner must still validate full input/schema and supply accounting/release.
 * Optional context exposes checked metadata and a controlled ORIGINAL reader
 * callback over this same Native, never a public SQL handle. Omitted context keeps
 * the legacy callback. Goal preparation/accounting/release remain independent. */
export function createOriginalMcpCatalogReadAuthority(
  mcp: OriginalMcpCatalogAuthorityExports,
  config: Parameters<typeof createPersistentOAuthAccessReader>[0],
  original: Pick<OriginalMcpOAuthCore, 'store' | 'grantAuthority'>,
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal'>,
  guard: Pick<ApiAuthGuard, 'withTrustedCatalogRead'>,
  context?: OriginalMcpCatalogReadContext,
  goals?: OriginalMcpCatalogGoalPreparation
): McpReadAuthority {
  const mapping = mcp?.MCP_BUSINESS_CAPABILITIES?.find(value => value.code === 'rental.catalog.search');
  if (!mapping || mapping.operation !== 'read' || typeof mcp.createPersistentOAuthAccessReader !== 'function'
    || typeof original?.store?.transaction !== 'function' || typeof original.store.native !== 'function'
    || typeof original.grantAuthority?.principal !== 'function' || typeof auth?.withTrustedWorkspacePrincipal !== 'function'
    || typeof guard?.withTrustedCatalogRead !== 'function') throw unavailable();
  if (goals !== undefined && (typeof goals?.prepareIn !== 'function' || typeof context?.withReadNative !== 'function')) throw unavailable();
  const prepareGoal = goals?.prepareIn.bind(goals);
  const prepareContext = context === undefined ? undefined : (() => {
    if (typeof context.bind !== 'function' || typeof mcp.captureMcpReadInput !== 'function') throw unavailable();
    const bind = context.bind.bind(context), capture = mcp.captureMcpReadInput.bind(mcp);
    return (authorization: McpReadAuthorization, toolName: string, input: unknown) => bind(authorization, toolName, capture(input).inputHash);
  })();
  const name = mapping.name, reader = mcp.createPersistentOAuthAccessReader(config, original.grantAuthority.access);
  const transaction = original.store.transaction.bind(original.store), native = original.store.native.bind(original.store);
  const principal = original.grantAuthority.principal.bind(original.grantAuthority), withPrincipal = auth.withTrustedWorkspacePrincipal.bind(auth), withCatalog = guard.withTrustedCatalogRead.bind(guard);
  return Object.freeze({ async withRead<T>(authorization: McpReadAuthorization, toolName: string, input: unknown, consume: () => Promise<T>, signal: AbortSignal): Promise<T> {
    try {
      if (signal.aborted || toolName !== name || typeof consume !== 'function') throw unavailable();
      const limit = readLimit(input), enterContext = prepareContext?.(authorization, toolName, input);
      const runIn = <R>(read: (native: Prisma.TransactionClient) => Promise<R>) => transaction(async tx => {
        const before = await reader.readIn(tx, authorization.token, signal), current = before.authorization;
        if (current.subject !== authorization.subject || current.clientId !== authorization.clientId || current.resource !== authorization.resource
          || !isDeepStrictEqual(current.scopes, authorization.scopes) || readLimit(input) !== limit) throw unavailable();
        const nativeTx = native(tx);
        const result = await withPrincipal(nativeTx, () => principal(before.grantId, tx, signal), signal,
          resolve => withCatalog(limit, resolve, identity => enterContext ? enterContext(before, identity, signal, () => read(nativeTx), nativeTx) : read(nativeTx), signal));
        // Principal equality alone cannot attest unchanged credential/grant scopes.
        if (readLimit(input) !== limit || !isDeepStrictEqual(await reader.readIn(tx, authorization.token, signal), before)) throw unavailable();
        return result;
      }, signal);
      // Original goal/publication/audit must be COMMITTED before separate budget
      // locks. Unknown preparation never proceeds or retries. Reauthorize the
      // actual read afresh; do not retain its old Native/context as a permit.
      if (prepareGoal) await runIn(nativeTx => prepareGoal(nativeTx, authorization, toolName, input, signal));
      return await runIn(() => consume());
    } catch { throw unavailable(); }
  } });
}
