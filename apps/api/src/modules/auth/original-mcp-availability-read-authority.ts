/** Fixed availability MCP credential -> original grant/Auth/POST Guard/Native.
 * Uses THIS core's store/grant; no Web token forwarding, catalog rights, reader,
 * field release, goal creation or listener. Optional original preparation commits
 * before a fresh read transaction; absence is NOT goal/accounting readiness. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { OriginalMcpOAuthCore } from './original-mcp-oauth-core';
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';
import { aiAvailabilityReadInputSchema } from '../ai-native/availability-read-facts.service';
import type { McpReadAuthority, McpReadAuthorization } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { MCP_BUSINESS_CAPABILITIES } from '@rental-os/mcp-server/capability-mapping' with { 'resolution-mode': 'import' };
import type { createPersistentOAuthAccessReader } from '@rental-os/mcp-server/persistent-oauth-tokens' with { 'resolution-mode': 'import' };
import type { captureMcpReadInput } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
export interface OriginalMcpAvailabilityAuthorityExports {
  MCP_BUSINESS_CAPABILITIES: typeof MCP_BUSINESS_CAPABILITIES;
  createPersistentOAuthAccessReader: typeof createPersistentOAuthAccessReader;
  captureMcpReadInput: typeof captureMcpReadInput;
}
export interface OriginalMcpAvailabilityGoalPreparation {
  /** Trusted ORIGINAL availability goal/binding/audit producer only. Never use
   * initial catalog preparation or caller goalId/human flags to obtain a budget. */
  prepareIn(native: Prisma.TransactionClient, authorization: McpReadAuthorization, toolName: string, input: unknown, signal: AbortSignal): Promise<void>;
}
const fail = () => new Error('Original MCP availability read unavailable');
export function createOriginalMcpAvailabilityReadAuthority(
  mcp: OriginalMcpAvailabilityAuthorityExports,
  config: Parameters<typeof createPersistentOAuthAccessReader>[0] & { requiredToolScopes: readonly string[] },
  original: Pick<OriginalMcpOAuthCore, 'store' | 'grantAuthority'>,
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal'>,
  guard: Pick<ApiAuthGuard, 'withTrustedAvailabilityRead'>,
  context: OriginalMcpCatalogReadContext,
  goals?: OriginalMcpAvailabilityGoalPreparation
): McpReadAuthority {
  const mapping = mcp?.MCP_BUSINESS_CAPABILITIES?.find(row => row.code === 'rental.availability.check');
  if (!mapping || mapping.operation !== 'read' || typeof mcp.createPersistentOAuthAccessReader !== 'function'
    || typeof mcp.captureMcpReadInput !== 'function' || typeof original?.store?.transaction !== 'function'
    || typeof original.store.native !== 'function' || typeof original.grantAuthority?.principal !== 'function'
    || typeof auth?.withTrustedWorkspacePrincipal !== 'function' || typeof guard?.withTrustedAvailabilityRead !== 'function'
    || typeof context?.bind !== 'function' || typeof context.withReadNative !== 'function'
    || goals !== undefined && typeof goals?.prepareIn !== 'function') throw fail();
  // Scope names are supplied by the original approved capability owner, not
  // invented by this adapter or selected by a model. Missing binding fails closed.
  if (!Array.isArray(config?.requiredToolScopes) || !config.requiredToolScopes.length || config.requiredToolScopes.length > 32
    || new Set(config.requiredToolScopes).size !== config.requiredToolScopes.length
    || config.requiredToolScopes.some(scope => typeof scope !== 'string' || !scope || !config.allowedScopes.includes(scope))) throw fail();
  const scopes = Object.freeze([...config.requiredToolScopes]), name = mapping.name;
  const capture = mcp.captureMcpReadInput.bind(mcp), bind = context.bind.bind(context), prepare = goals?.prepareIn.bind(goals);
  const transaction = original.store.transaction.bind(original.store), native = original.store.native.bind(original.store);
  const principal = original.grantAuthority.principal.bind(original.grantAuthority);
  const withPrincipal = auth.withTrustedWorkspacePrincipal.bind(auth), withAvailability = guard.withTrustedAvailabilityRead.bind(guard);
  const reader = mcp.createPersistentOAuthAccessReader({ enabled: config.enabled, resourceUrl: config.resourceUrl, allowedScopes: [...config.allowedScopes] }, original.grantAuthority.access);
  return Object.freeze({ async withRead<T>(authorization: McpReadAuthorization, toolName: string, input: unknown,
    consume: () => Promise<T>, signal: AbortSignal): Promise<T> {
    try {
      if (toolName !== name || signal.aborted || typeof consume !== 'function') throw fail();
      const fixed = structuredClone(authorization), captured = capture(input), parsed = aiAvailabilityReadInputSchema.safeParse(captured.input);
      if (!parsed.success || parsed.data.lines.length > 50 || !scopes.every(scope => fixed.scopes.includes(scope))) throw fail();
      Object.freeze(fixed.scopes); Object.freeze(fixed);
      const live = () => {
        if (signal.aborted || !isDeepStrictEqual(authorization, fixed) || capture(input).inputHash !== captured.inputHash) throw fail();
      };
      live(); const enter = bind(fixed, name, captured.inputHash);
      const runIn = <R>(read: (native: Prisma.TransactionClient) => Promise<R>) => transaction(async tx => {
        live(); const before = await reader.readIn(tx, fixed.token, signal); live();
        const current = before.authorization;
        // The verified resource projection has expiry but no credential; compare
        // its identity/scope tuple, not the differently shaped transport object.
        // Credential verification is the original reader's fixed-token readIn.
        if (current.subject !== fixed.subject || current.clientId !== fixed.clientId || current.resource !== fixed.resource
          || !isDeepStrictEqual(current.scopes, fixed.scopes) || !scopes.every(scope => current.scopes.includes(scope))) throw fail();
        const originalNative = native(tx);
        const result = await withPrincipal(originalNative, () => principal(before.grantId, tx, signal), signal,
          resolve => withAvailability(parsed.data.locationId, parsed.data.lines.length, resolve,
            identity => enter(before, identity, signal, () => read(originalNative), originalNative), signal));
        live();
        if (!isDeepStrictEqual(await reader.readIn(tx, fixed.token, signal), before)) throw fail();
        live(); return result;
      }, signal);
      // Confirm ORIGINAL metadata preparation first. Failure/unknown does not
      // enter read, choose a replacement goal or retry. Read reauthorizes afresh.
      if (prepare) await runIn(originalNative => prepare(originalNative, fixed, name, captured.input, signal));
      return await runIn(() => consume());
    } catch { throw fail(); }
  } });
}
