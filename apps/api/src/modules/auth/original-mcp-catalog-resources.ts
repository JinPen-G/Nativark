/** Original catalog facts in the caller's Native, through actual Auth/Guard/ALS,
 * Core configuration page and original projection. Not a first-goal author, field
 * release, MCP publication, pricing/reservation, transaction or commit owner. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { AI_CONTRACT_DRAFT_VERSION, aiCatalogReadInputSchema, type AiCatalogReadProjection } from '@rental-os/shared';
import type { captureMcpReadInput, OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { MCP_BUSINESS_CAPABILITIES } from '@rental-os/mcp-server/capability-mapping' with { 'resolution-mode': 'import' };
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { AiCatalogReadFactsService } from '../ai-native/catalog-read-facts.service';
import { isAiStepExecutionContext } from '../ai-native/task-contract-validation';
import { originalIdentityHash } from '../ai-native/task-request/original-request.authority';
import { captureOriginalMcpRequestCall, createOriginalMcpRequestScopeSource } from './original-mcp-request-scope';
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';

export interface OriginalMcpCatalogResources {
  /** Internal original projection only; current external field/tool release and
   * persistent goal admission remain independently required at the MCP boundary. */
  readIn(native: Prisma.TransactionClient, input: unknown, signal: AbortSignal): Promise<AiCatalogReadProjection>;
  /** Read in the current ORIGINAL owner's transaction; no caller SQL argument.
   * Metadata-only/legacy contexts cannot borrow a global or new transaction. */
  read(input: unknown, signal: AbortSignal): Promise<AiCatalogReadProjection>;
}
const fail = () => new Error('Original MCP Native catalog unavailable');
export function createOriginalMcpCatalogResources(
  mcp: { captureMcpReadInput: typeof captureMcpReadInput; MCP_BUSINESS_CAPABILITIES: typeof MCP_BUSINESS_CAPABILITIES },
  context: OriginalMcpCatalogReadContext, raw: OriginalMcpReadCallRef,
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal'>, guard: Pick<ApiAuthGuard, 'withTrustedCatalogRead'>,
  core: Pick<RentalCoreService, 'listItemGroupsPageInTransaction'>,
  clock: () => Date = () => new Date()): OriginalMcpCatalogResources {
  const mapping = mcp?.MCP_BUSINESS_CAPABILITIES?.find(row => row.code === 'rental.catalog.search');
  if (!mapping || mapping.operation !== 'read' || typeof mcp.captureMcpReadInput !== 'function' || typeof context?.current !== 'function'
    || typeof auth?.withTrustedWorkspacePrincipal !== 'function' || typeof guard?.withTrustedCatalogRead !== 'function'
    || typeof core?.listItemGroupsPageInTransaction !== 'function' || typeof clock !== 'function') throw fail();
  const call = captureOriginalMcpRequestCall(raw), current = context.current.bind(context);
  if (call.toolName !== mapping.name) throw fail();
  const subject = structuredClone(current(call)), capture = mcp.captureMcpReadInput.bind(mcp);
  const principal = auth.withTrustedWorkspacePrincipal.bind(auth), withCatalog = guard.withTrustedCatalogRead.bind(guard);
  const readPage = core.listItemGroupsPageInTransaction.bind(core), scopes = createOriginalMcpRequestScopeSource(context, clock);
  if (context.withReadNative !== undefined && typeof context.withReadNative !== 'function') throw fail();
  const nativeRead = context.withReadNative?.bind(context);
  const live = (signal: AbortSignal) => { if (signal.aborted || !isDeepStrictEqual(subject, structuredClone(current(call)))) throw fail(); };
  const readIn = async (native: Prisma.TransactionClient, value: unknown, signal: AbortSignal): Promise<AiCatalogReadProjection> => {
    live(signal);
    if (!native || '$transaction' in native) throw fail();
    const snapshot = capture(value);
    if (snapshot.inputHash !== call.inputHash) throw fail();
    const request = aiCatalogReadInputSchema.safeParse(snapshot.input);
    if (!request.success || request.data.limit > 50) throw fail();
    const before = await scopes.currentIn(call, native, signal); live(signal);
    const reader = new AiCatalogReadFactsService({ listItemGroupsPage(tenant, query) {
      live(signal); return readPage(tenant, query, native, signal, () => live(signal));
    } }, { withRead(kind, input, consume) {
      live(signal); if (kind !== 'catalog' || !isDeepStrictEqual(input, request.data)) throw fail();
      return principal(native, async (tx, stop) => {
        live(stop); if (tx !== native) throw fail();
        const now = current(call);
        if (!now.userId || !now.tenantId || !now.workspaceId || now.audience !== 'operator') throw fail();
        return { userId: now.userId, tenantId: now.tenantId, workspaceId: now.workspaceId, audience: 'operator' };
      }, signal, resolve => withCatalog(request.data.limit, resolve, async identity => {
        live(signal);
        const at = clock(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw fail();
        const candidate = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: call.callId, authorizedAt: at.toISOString(),
          audience: 'operator', actor: { kind: 'user', userId: identity.userId },
          scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId },
          access: { permissions: [...(identity.permissions ?? [])], dataScope: identity.dataScope, locationScope: identity.locationScope,
            ...(identity.organizationId === undefined ? {} : { organizationId: identity.organizationId }) } };
        if (!isAiStepExecutionContext(candidate) || originalIdentityHash(candidate) !== originalIdentityHash(before.context)) throw fail();
        const result = await consume(candidate); live(signal); return result;
      }, signal));
    } }, clock);
    const result = await reader.read(snapshot.input, before.context); live(signal);
    const after = await scopes.currentIn(call, native, signal); live(signal);
    if (after.scopeId !== before.scopeId || originalIdentityHash(after.context) !== originalIdentityHash(before.context)) throw fail();
    return result;
  };
  return Object.freeze({ readIn, async read(value: unknown, signal: AbortSignal) {
    live(signal);
    if (!nativeRead) throw fail();
    const snapshot = capture(value);
    if (snapshot.inputHash !== call.inputHash) throw fail();
    return nativeRead(call, signal, (native, stop) => readIn(native, snapshot.input, stop));
  } });
}
