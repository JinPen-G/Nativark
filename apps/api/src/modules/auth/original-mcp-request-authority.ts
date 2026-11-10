/** Original MCP callback -> original request's Native policy observer.
 * Requires a real original Native resource authorizer; scope/catalog Guard alone
 * does not grant scene-resource access. No Web token, global client, request/goal
 * creation, grant re-lock, execution, publication or commit/unknown handling. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AiExecutionContext, AiSceneRequestBody } from '@rental-os/shared';
import type { OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import { captureOriginalMcpRequestCall, createOriginalMcpRequestScopeSource } from './original-mcp-request-scope';
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';
import { createNativeOriginalRequestAuthority, type AiOriginalRequestNativeAuthority, type AiSceneCreationRule } from '../ai-native/task-request/original-request.authority';
import type { PrismaSubscriptionBudgetReader } from '../ai-native/budget/prisma-subscription-budget-reader';

/** Construct inside the original Guard callback. The original owner must await
 * every participant under the same Native/lifecycle and supply current original
 * resource checks, coherent isolation and lock order. Missing producers reject. */
export function createOriginalMcpRequestAuthority(context: OriginalMcpCatalogReadContext,
  raw: OriginalMcpReadCallRef, input: {
    creationRules: readonly AiSceneCreationRule[];
    entitlements: Pick<PrismaSubscriptionBudgetReader, 'readIn'>;
    authorizeResourcesIn(body: AiSceneRequestBody, native: Prisma.TransactionClient, signal: AbortSignal): Promise<AiExecutionContext>;
  }, clock: () => Date = () => new Date()): AiOriginalRequestNativeAuthority {
  if (typeof context?.current !== 'function') throw new Error('Original MCP request authority unavailable');
  const call = captureOriginalMcpRequestCall(raw), current = context.current.bind(context);
  const subject = structuredClone(current(call));
  const assertCurrent = () => {
    if (!isDeepStrictEqual(subject, structuredClone(current(call)))) throw new Error('Original MCP request authority unavailable');
  };
  const scopes = createOriginalMcpRequestScopeSource(context, clock);
  return createNativeOriginalRequestAuthority({
    ...input, assertCurrent,
    currentIn: (native, signal) => scopes.currentIn(call, native, signal)
  }, clock);
}
