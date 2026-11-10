/** Original catalog producer composition for ONE OAuth core/store/database.
 * Commits initial goal metadata before the separate budget; reads original facts
 * in the original Auth/Guard Native. Publication/closed wire schemas and external
 * field release remain REQUIRED owner inputs, never inferred from internal facts.
 * No listener, Task/ledger, caller goal ID, automatic rollover or approval. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { OperationLogService } from '../../common/operation-log.service';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import type { McpReadTools, McpReadTool, McpReadAuthorization, McpReadAccounting } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { createPrismaMcpReadAccounting } from '@rental-os/mcp-server/prisma-mcp-read-accounting' with { 'resolution-mode': 'import' };
import type { OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { createOriginalMcpTrafficMeter, OriginalMcpTrafficPolicySource } from '@rental-os/mcp-server/original-traffic-meter' with { 'resolution-mode': 'import' };
import type { Prisma } from '@prisma/client';
import type { OriginalMcpReadCore } from './original-mcp-oauth-core';
import { createOriginalMcpCatalogReadContext } from './original-mcp-read-context';
import { createOriginalMcpCatalogReadAuthority, type OriginalMcpCatalogAuthorityExports } from './original-mcp-catalog-read-authority';
import { createOriginalMcpCatalogGoals, type OriginalMcpCatalogGoalsExports } from './original-mcp-catalog-goals';
import { createOriginalMcpCatalogResources } from './original-mcp-catalog-resources';
import { captureOriginalMcpRequestCall } from './original-mcp-request-scope';

export type OriginalMcpCatalogReadToolsExports = OriginalMcpCatalogAuthorityExports & OriginalMcpCatalogGoalsExports
  & { createPrismaMcpReadAccounting: typeof createPrismaMcpReadAccounting; createOriginalMcpTrafficMeter: typeof createOriginalMcpTrafficMeter };
export interface OriginalMcpCatalogReadPolicy {
  /** Approved MCP wire descriptor, NOT the internal API projection/schema. */
  tool: Omit<McpReadTool, 'read'>;
  publication: McpReadTools['publication'];
  release: McpReadTools['release'];
  /** Original approved class-rate policy; not caller flags or a default ceiling. */
  traffic: OriginalMcpTrafficPolicySource<Prisma.TransactionClient>;
}
const fail = () => new Error('Original MCP catalog composition unavailable');
export function createOriginalMcpCatalogReadTools(
  mcp: OriginalMcpCatalogReadToolsExports,
  config: Parameters<typeof createOriginalMcpCatalogReadAuthority>[1],
  original: OriginalMcpReadCore,
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal'>,
  guard: Pick<ApiAuthGuard, 'withTrustedCatalogRead'>,
  core: Pick<RentalCoreService, 'listItemGroupsPageInTransaction'>,
  logs: Pick<OperationLogService, 'recordOriginalMcpReadGoalAudit'>,
  policy: OriginalMcpCatalogReadPolicy
): McpReadTools {
  const mapping = mcp?.MCP_BUSINESS_CAPABILITIES?.find(row => row.code === 'rental.catalog.search');
  if (!mapping || mapping.operation !== 'read' || policy?.tool?.name !== mapping.name
    || typeof policy.publication?.allows !== 'function' || typeof policy.release?.project !== 'function'
    || typeof mcp.createPrismaMcpReadAccounting !== 'function' || typeof mcp.createOriginalMcpTrafficMeter !== 'function'
    || typeof policy.traffic?.current !== 'function' || typeof original?.database?.$transaction !== 'function'
    || typeof core?.listItemGroupsPageInTransaction !== 'function') throw fail();
  for (const schema of [policy.tool.inputSchema, policy.tool.outputSchema]) {
    if (!schema || schema.type !== 'object' || schema.additionalProperties !== false) throw fail();
  }
  const runtime = Object.freeze({ ...mcp }), name = mapping.name;
  const traffic = runtime.createOriginalMcpTrafficMeter(policy.traffic);
  const database = Object.freeze({ $transaction: original.database.$transaction.bind(original.database) });
  const readCore = Object.freeze({ listItemGroupsPageInTransaction: core.listItemGroupsPageInTransaction.bind(core) });
  const currentAuth = Object.freeze({ withTrustedWorkspacePrincipal: auth.withTrustedWorkspacePrincipal.bind(auth) });
  const currentGuard = Object.freeze({ withTrustedCatalogRead: guard.withTrustedCatalogRead.bind(guard) });
  const context = createOriginalMcpCatalogReadContext();
  const goals = createOriginalMcpCatalogGoals(runtime, { enabled: config.enabled }, context, logs);
  const authority = createOriginalMcpCatalogReadAuthority(runtime, config, original, currentAuth, currentGuard, context, goals.preparation);
  // This is callback-local invocation linkage, NOT a goal/call counter or an
  // authority. Only the persisted accounting producer can supply this call ref.
  interface Entry { active: boolean; accountingStarted: boolean; readStarted: boolean; call?: OriginalMcpReadCallRef;
    signal: AbortSignal; persisted: McpReadAccounting; lifetime: AbortController; inputHash: string; authorization: McpReadAuthorization }
  const calls = new AsyncLocalStorage<Entry>();
  const prepare = (authorization: McpReadAuthorization, input: unknown, signal: AbortSignal): Entry => {
    const captured = runtime.captureMcpReadInput(input), lifetime = new AbortController();
    let entry!: Entry, trafficConsumed = false;
    const persisted = runtime.createPrismaMcpReadAccounting(database, { async resolve(raw, value, native, stop) {
      if (!entry.active || entry.signal.aborted || stop.aborted) throw fail();
      const call = captureOriginalMcpRequestCall(raw);
      if (call.toolName !== name || call.inputHash !== captured.inputHash
        || !isDeepStrictEqual(call.authorization, authorization) || entry.call && !isDeepStrictEqual(entry.call, call)) throw fail();
      const owner = context.current(call); // SAME original authenticated callback.
      entry.call = call;
      const target = await goals.source.resolve(call, value, native, stop);
      // Same budget Native: original goal -> class bucket -> budget/call. Source
      // rechecks do not consume the class twice; rollback/unknown never retries.
      if (target && !trafficConsumed) {
        if (typeof owner.workspaceId !== 'string') throw fail();
        await traffic.consumeIn('mcp.tools.call', { userId: owner.userId, tenantId: owner.tenantId, workspaceId: owner.workspaceId }, native, stop);
        trafficConsumed = true;
      }
      return target;
    } });
    entry = { active: true, accountingStarted: false, readStarted: false, signal: AbortSignal.any([signal, lifetime.signal]),
      persisted, lifetime, inputHash: captured.inputHash, authorization };
    return entry;
  };
  const close = (entry: Entry) => { entry.active = false; entry.lifetime.abort(); delete entry.call; };
  const consumeCall = async <T>(entry: Entry, input: unknown, consume: (signal?: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> => {
    if (!entry.active || entry.accountingStarted || entry.signal.aborted || signal.aborted) throw fail();
    entry.accountingStarted = true;
    return entry.persisted.withCall(entry.authorization, name, input, async readSignal => {
      if (!entry.call || !entry.active || entry.signal.aborted) throw fail();
      const reading = new AbortController();
      entry.signal = AbortSignal.any([entry.signal, readSignal ?? signal, reading.signal]);
      // The native read reference expires at the callback boundary, even though
      // the persisted invocation hold survives owner commit and final checks.
      try { return await consume(entry.signal); }
      finally { reading.abort(); delete entry.call; }
    }, signal);
  };
  const accounting: McpReadTools['accounting'] = Object.freeze({
    async withInvocation<T>(authorization: McpReadAuthorization, toolName: string, input: unknown,
      consume: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (toolName !== name || signal.aborted || typeof consume !== 'function' || calls.getStore()) throw fail();
      const entry = prepare(authorization, input, signal);
      try {
        if (!entry.persisted.withInvocation) throw fail();
        return await calls.run(entry, () => entry.persisted.withInvocation!(authorization, name, input, consume, signal));
      } finally { close(entry); }
    },
    async withCall<T>(authorization: McpReadAuthorization, toolName: string, input: unknown,
      consume: (signal?: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (toolName !== name || signal.aborted || typeof consume !== 'function') throw fail();
      const current = calls.getStore();
      if (current) {
        if (runtime.captureMcpReadInput(input).inputHash !== current.inputHash || !isDeepStrictEqual(authorization, current.authorization)) throw fail();
        return consumeCall(current, input, consume, signal);
      }
      const entry = prepare(authorization, input, signal);
      try { return await calls.run(entry, () => consumeCall(entry, input, consume, signal)); }
      finally { close(entry); }
    },
  });
  const tool: McpReadTool = Object.freeze({ name, description: policy.tool.description,
    inputSchema: structuredClone(policy.tool.inputSchema), outputSchema: structuredClone(policy.tool.outputSchema),
    async read(input: unknown, signal: AbortSignal) {
      const entry = calls.getStore();
      if (!entry?.active || !entry.call || entry.readStarted || entry.signal.aborted || signal.aborted
        || runtime.captureMcpReadInput(input).inputHash !== entry.call.inputHash) throw fail();
      // One persisted invocation permits ONE original read, not an internal
      // loop/concurrent duplicate sharing its call ID. This is no local quota.
      entry.readStarted = true;
      const stop = AbortSignal.any([entry.signal, signal]);
      const value = await createOriginalMcpCatalogResources(runtime, context, entry.call, currentAuth, currentGuard, readCore).read(input, stop);
      if (!entry.active || stop.aborted || calls.getStore() !== entry) throw fail();
      return value;
    },
  });
  return Object.freeze({ tools: Object.freeze([tool]), authority, accounting,
    publication: Object.freeze({ allows: policy.publication.allows.bind(policy.publication) }),
    release: Object.freeze({ project: policy.release.project.bind(policy.release) }) });
}
