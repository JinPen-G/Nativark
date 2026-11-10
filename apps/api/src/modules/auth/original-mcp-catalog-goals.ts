/** Original initial catalog-goal author/locator over the real Guard callback.
 * Preparation persists goal/bindings/audit in the ORIGINAL Auth transaction and
 * must commit BEFORE separate budget/read. Budget source only reads existing
 * metadata, never re-locks outer Auth/grant or creates goals. No Task/Run, caller
 * goal ID, automatic rollover, field release, listener or transaction owner. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { AI_CONTRACT_DRAFT_VERSION, aiCatalogReadInputSchema } from '@rental-os/shared';
import type { captureMcpReadInput, OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { createPrismaMcpCatalogGoals, OriginalCatalogGoal, ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION } from '@rental-os/mcp-server/prisma-mcp-catalog-goals' with { 'resolution-mode': 'import' };
import type { createPrismaMcpReadBindings, OriginalMcpReadGoalOwner } from '@rental-os/mcp-server/prisma-mcp-read-bindings' with { 'resolution-mode': 'import' };
import type { OriginalMcpReadInputTargetSource } from '@rental-os/mcp-server/prisma-mcp-read-accounting' with { 'resolution-mode': 'import' };
import type { createPrismaMcpReadGoalSettlement, OriginalMcpReadGoalSettlement } from '@rental-os/mcp-server/prisma-mcp-read-goal-settlement' with { 'resolution-mode': 'import' };
import type { MCP_BUSINESS_CAPABILITIES } from '@rental-os/mcp-server/capability-mapping' with { 'resolution-mode': 'import' };
import type { McpReadAuthorization } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { OperationLogService } from '../../common/operation-log.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { captureOriginalMcpRequestCall } from './original-mcp-request-scope';
import type { OriginalMcpCatalogReadContext, OriginalMcpReadSubject } from './original-mcp-read-context';

export interface OriginalMcpCatalogGoalPreparation {
  prepareIn(native: Prisma.TransactionClient, authorization: McpReadAuthorization, toolName: string, input: unknown, signal: AbortSignal): Promise<void>;
}
export interface OriginalMcpCatalogGoalsExports {
  captureMcpReadInput: typeof captureMcpReadInput;
  createPrismaMcpCatalogGoals: typeof createPrismaMcpCatalogGoals;
  createPrismaMcpReadBindings: typeof createPrismaMcpReadBindings;
  ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION: typeof ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION;
  MCP_BUSINESS_CAPABILITIES: typeof MCP_BUSINESS_CAPABILITIES;
  /** Optional original read-only observation; absence is never settled evidence. */
  createPrismaMcpReadGoalSettlement?: typeof createPrismaMcpReadGoalSettlement;
}
const fail = () => new Error('Original catalog goal author unavailable');
/** One original Guard/admission fingerprint for both MCP and trusted Web owners.
 * This is metadata equality, NOT field release, verification or an authorization. */
export function originalMcpCatalogGoalAuthorityHash(s: OriginalMcpReadSubject, policyVersion: string): string {
  if (!s.userId || !s.tenantId || !s.workspaceId || s.audience !== 'operator' || !s.permissions || !s.dataScope || !s.locationScope) throw fail();
  return requestFingerprint({ owner: { userId: s.userId, tenantId: s.tenantId, workspaceId: s.workspaceId, grantId: s.grantId, grantRevision: s.grantRevision }, audience: s.audience,
    permissions: [...s.permissions].sort(), dataScope: s.dataScope, organizationId: s.organizationId ?? null,
    locationScope: { ...s.locationScope, locationIds: [...s.locationScope.locationIds].sort() },
    contractVersion: AI_CONTRACT_DRAFT_VERSION, admissionPolicyVersion: policyVersion });
}
export function createOriginalMcpCatalogGoals(mcp: OriginalMcpCatalogGoalsExports, config: { enabled: boolean },
  context: OriginalMcpCatalogReadContext, logs: Pick<OperationLogService, 'recordOriginalMcpReadGoalAudit'>): {
    preparation: OriginalMcpCatalogGoalPreparation; source: OriginalMcpReadInputTargetSource<Prisma.TransactionClient>;
    settlement: { readIn(call: OriginalMcpReadCallRef, input: unknown, native: Prisma.TransactionClient, signal: AbortSignal): Promise<OriginalMcpReadGoalSettlement> };
  } {
  const mapping = mcp?.MCP_BUSINESS_CAPABILITIES?.find(v => v.code === 'rental.catalog.search');
  if (!mapping || mapping.operation !== 'read' || typeof config?.enabled !== 'boolean' || typeof context?.current !== 'function' || typeof context.withReadNative !== 'function'
    || typeof logs?.recordOriginalMcpReadGoalAudit !== 'function' || typeof mcp.captureMcpReadInput !== 'function'
    || typeof mcp.createPrismaMcpCatalogGoals !== 'function' || typeof mcp.createPrismaMcpReadBindings !== 'function'
    || mcp.ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION !== 'catalog-admission-1') throw fail();
  const enabled = config.enabled, capture = mcp.captureMcpReadInput.bind(mcp), subjectFor = context.current.bind(context);
  const record = logs.recordOriginalMcpReadGoalAudit.bind(logs), bind = mcp.createPrismaMcpReadBindings;
  const policyVersion = mcp.ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION, name = mapping.name;
  const createGoals = mcp.createPrismaMcpCatalogGoals, ownerRead = context.withReadNative.bind(context);
  if (mcp.createPrismaMcpReadGoalSettlement !== undefined && typeof mcp.createPrismaMcpReadGoalSettlement !== 'function') throw fail();
  const createSettlement = mcp.createPrismaMcpReadGoalSettlement;
  const who = (call: OriginalMcpReadCallRef): OriginalMcpReadSubject & Required<OriginalMcpReadGoalOwner> => {
    const s = structuredClone(subjectFor(call));
    if (!s.userId || !s.tenantId || !s.workspaceId || s.audience !== 'operator' || !s.permissions || !s.dataScope || !s.locationScope) throw fail();
    return Object.freeze({ ...s, userId: s.userId, tenantId: s.tenantId, workspaceId: s.workspaceId });
  };
  const owner = (s: ReturnType<typeof who>) => ({ userId: s.userId, tenantId: s.tenantId, workspaceId: s.workspaceId, grantId: s.grantId, grantRevision: s.grantRevision });
  // Metering-admission policy only, NOT external field/release permission. Current
  // original grant and full Guard remain enforced by the enclosing authority.
  const hash = (s: ReturnType<typeof who>) => originalMcpCatalogGoalAuthorityHash(s, policyVersion);
  const check = (call: OriginalMcpReadCallRef, s: ReturnType<typeof who>, signal: AbortSignal) => {
    if (signal.aborted || !isDeepStrictEqual(s, who(call))) throw fail();
  };
  const audit = (kind: 'admitted' | 'bindings_published', goal: OriginalCatalogGoal, native: Prisma.TransactionClient,
    keys: readonly string[], signal: AbortSignal, requireExisting = false) => record(native, { kind, goalId: goal.target.goalId, ownerKey: goal.ownerKey,
      userId: goal.owner.userId, tenantId: goal.owner.tenantId, workspaceId: goal.owner.workspaceId,
      grantId: goal.owner.grantId, grantRevision: goal.owner.grantRevision, authorityHash: goal.authorityHash,
      recordHash: goal.recordHash, bindingKeys: keys }, signal, requireExisting);
  const goalsFor = (call: OriginalMcpReadCallRef, s: ReturnType<typeof who>) => createGoals<Prisma.TransactionClient>({
    async admitted(g, tx, stop) { check(call, s, stop); await audit('admitted', g, tx, [], stop); check(call, s, stop); },
    async published(g, keys, tx, stop) { check(call, s, stop); await audit('bindings_published', g, tx, keys, stop); check(call, s, stop); },
  });
  const observe = async (call: OriginalMcpReadCallRef, s: ReturnType<typeof who>, native: Prisma.TransactionClient, signal: AbortSignal) => {
    check(call, s, signal);
    const g = await goalsFor(call, s).readOwnerIn(owner(s), native, signal); check(call, s, signal);
    if (!g || !isDeepStrictEqual(g.owner, owner(s)) || g.authorityHash !== hash(s)
      || g.target.policyVersion !== policyVersion || g.target.subject !== call.authorization.subject
      || g.target.clientId !== call.authorization.clientId || g.target.resource !== call.authorization.resource
      || !isDeepStrictEqual(g.target.scopes, call.authorization.scopes)) throw fail();
    await audit('admitted', g, native, [], signal, true); check(call, s, signal);
    return g;
  };
  const publication = (call: OriginalMcpReadCallRef, s: ReturnType<typeof who>) => bind<Prisma.TransactionClient, ReturnType<typeof who>>({
    async readExisting(id, native, signal) {
      const g = await observe(call, s, native, signal); if (g.target.goalId !== id) throw fail();
      return { target: g.target, owner: g.owner, bindings: [{ toolName: call.toolName, inputHash: call.inputHash }] };
    },
    async locate(actual, current, native, signal) {
      if (!isDeepStrictEqual(actual, call) || !isDeepStrictEqual(current, s)) throw fail();
      return (await observe(call, s, native, signal)).target.goalId;
    },
    async current(target, binding, current, native, signal) {
      if (!isDeepStrictEqual(current, s) || binding.toolName !== call.toolName || binding.inputHash !== call.inputHash) throw fail();
      const g = await observe(call, s, native, signal);
      const key = capture({ goalId: g.target.goalId, grantId: g.owner.grantId, toolName: binding.toolName, inputHash: binding.inputHash }).inputHash;
      await audit('bindings_published', g, native, [key], signal, true); check(call, s, signal);
      return isDeepStrictEqual(target, g.target);
    },
    async auditPublished(id, keys, native, signal) {
      check(call, s, signal); await goalsFor(call, s).auditPublishedIn(id, keys, native, signal); check(call, s, signal);
    },
  }, { current: actual => { if (!isDeepStrictEqual(actual, call)) throw fail(); check(call, s, new AbortController().signal); return s; } });
  return Object.freeze({
    preparation: Object.freeze({ async prepareIn(native: Prisma.TransactionClient, authorization: McpReadAuthorization,
      toolName: string, input: unknown, signal: AbortSignal) {
      if (!enabled) return;
      const captured = capture(input), parsed = aiCatalogReadInputSchema.safeParse(captured.input);
      if (!parsed.success || parsed.data.limit > 50 || toolName !== name || signal.aborted) throw fail();
      const call = captureOriginalMcpRequestCall({ callId: randomUUID(), authorization, toolName, inputHash: captured.inputHash }), s = who(call);
      check(call, s, signal);
      await ownerRead(call, signal, async (originalNative, stop) => {
        if (originalNative !== native) throw fail();
        const goal = await goalsFor(call, s).prepareIn({ owner: owner(s), authorityHash: hash(s), target: {
          grantId: s.grantId, subject: call.authorization.subject, clientId: call.authorization.clientId, resource: call.authorization.resource,
          scopes: [...call.authorization.scopes], purpose: 'rental.catalog.search', originalInputHash: captured.inputHash, policyVersion,
        } }, native, stop); check(call, s, stop);
        const published = publication(call, s);
        await published.publishIn(goal.target.goalId, native, stop); check(call, s, stop);
        if (!await published.source.resolve(call, captured.input, native, stop)) throw fail(); check(call, s, stop);
      });
    } }),
    settlement: Object.freeze({ async readIn(raw: OriginalMcpReadCallRef, input: unknown, native: Prisma.TransactionClient, signal: AbortSignal) {
      if (!enabled || !createSettlement) throw fail();
      const call = captureOriginalMcpRequestCall(raw), captured = capture(input), parsed = aiCatalogReadInputSchema.safeParse(captured.input);
      if (signal.aborted || call.toolName !== name || captured.inputHash !== call.inputHash || !parsed.success || parsed.data.limit > 50) throw fail();
      const s = who(call);
      return ownerRead(call, signal, async (originalNative, stop) => {
        if (originalNative !== native) throw fail();
        const goal = await observe(call, s, native, stop); check(call, s, stop);
        const observer = createSettlement<Prisma.TransactionClient>({ async readIn(id, tx, currentSignal) {
          check(call, s, currentSignal); if (tx !== native || id !== goal.target.goalId) throw fail();
          const found = await goalsFor(call, s).readIn(id, tx, currentSignal); check(call, s, currentSignal); return found;
        } });
        const result = await observer.readIn(goal, native, stop); check(call, s, stop);
        // Resource rows do not close a business goal or attest the enclosing Auth
        // commit. Trusted completion/adoption must consume fresh original evidence.
        return result;
      });
    } }),
    source: Object.freeze({ async resolve(raw: OriginalMcpReadCallRef, input: unknown, native: Prisma.TransactionClient, signal: AbortSignal) {
      if (!enabled) return undefined;
      const call = captureOriginalMcpRequestCall(raw), captured = capture(input), parsed = aiCatalogReadInputSchema.safeParse(captured.input);
      if (signal.aborted || call.toolName !== name || captured.inputHash !== call.inputHash || !parsed.success || parsed.data.limit > 50) throw fail();
      const s = who(call);
      // Read ONLY a committed original frontier. Never admit/recreate under the
      // budget transaction or infer ownership from query, latest row or callId.
      return publication(call, s).source.resolve(call, captured.input, native, signal);
    } }),
  });
}
