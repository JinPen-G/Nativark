/** Original availability facts over the ORIGINAL owner Native and POST Guard.
 * Uses original Core inventory/buffers/bundle arithmetic, never legacy state
 * initialization, reservation or price calculation. Not publication/field release,
 * a goal producer, transaction/commit owner or proof that stock is reserved. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { AI_CONTRACT_DRAFT_VERSION } from '@rental-os/shared';
import type { captureMcpReadInput, OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { MCP_BUSINESS_CAPABILITIES } from '@rental-os/mcp-server/capability-mapping' with { 'resolution-mode': 'import' };
import type { AuthService } from './auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { AiAvailabilityReadFactsService, aiAvailabilityReadInputSchema, type AiAvailabilityReadProjection } from '../ai-native/availability-read-facts.service';
import { isAiStepExecutionContext } from '../ai-native/task-contract-validation';
import { originalIdentityHash } from '../ai-native/task-request/original-request.authority';
import { captureOriginalMcpRequestCall, createOriginalMcpRequestScopeSource } from './original-mcp-request-scope';
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';

export interface OriginalMcpAvailabilityResources {
  readIn(native: Prisma.TransactionClient, input: unknown, signal: AbortSignal): Promise<AiAvailabilityReadProjection>;
  /** Current private owner callback only; no caller SQL, new/global transaction. */
  read(input: unknown, signal: AbortSignal): Promise<AiAvailabilityReadProjection>;
}
const fail = () => new Error('Original MCP Native availability unavailable');
export function createOriginalMcpAvailabilityResources(
  mcp: { captureMcpReadInput: typeof captureMcpReadInput; MCP_BUSINESS_CAPABILITIES: typeof MCP_BUSINESS_CAPABILITIES },
  context: OriginalMcpCatalogReadContext, raw: OriginalMcpReadCallRef,
  auth: Pick<AuthService, 'withTrustedWorkspacePrincipal'>, guard: Pick<ApiAuthGuard, 'withTrustedAvailabilityRead'>,
  core: Pick<RentalCoreService, 'readAvailabilityInTransaction'>,
  clock: () => Date = () => new Date()): OriginalMcpAvailabilityResources {
  const mapping = mcp?.MCP_BUSINESS_CAPABILITIES?.find(row => row.code === 'rental.availability.check');
  if (!mapping || mapping.operation !== 'read' || typeof mcp.captureMcpReadInput !== 'function' || typeof context?.current !== 'function'
    || typeof auth?.withTrustedWorkspacePrincipal !== 'function' || typeof guard?.withTrustedAvailabilityRead !== 'function'
    || typeof core?.readAvailabilityInTransaction !== 'function' || typeof clock !== 'function') throw fail();
  const call = captureOriginalMcpRequestCall(raw), current = context.current.bind(context);
  if (call.toolName !== mapping.name) throw fail();
  const subject = structuredClone(current(call)), capture = mcp.captureMcpReadInput.bind(mcp);
  const principal = auth.withTrustedWorkspacePrincipal.bind(auth), withAvailability = guard.withTrustedAvailabilityRead.bind(guard);
  const readAvailability = core.readAvailabilityInTransaction.bind(core), scopes = createOriginalMcpRequestScopeSource(context, clock);
  if (context.withReadNative !== undefined && typeof context.withReadNative !== 'function') throw fail();
  const nativeRead = context.withReadNative?.bind(context);
  const live = (signal: AbortSignal) => { if (signal.aborted || !isDeepStrictEqual(subject, structuredClone(current(call)))) throw fail(); };
  const readIn = async (native: Prisma.TransactionClient, value: unknown, signal: AbortSignal): Promise<AiAvailabilityReadProjection> => {
    live(signal);
    if (!native || '$transaction' in native) throw fail();
    const snapshot = capture(value);
    if (snapshot.inputHash !== call.inputHash) throw fail();
    const request = aiAvailabilityReadInputSchema.safeParse(snapshot.input);
    if (!request.success || request.data.lines.length > 50) throw fail();
    const before = await scopes.currentIn(call, native, signal); live(signal);
    const reader = new AiAvailabilityReadFactsService({ readAvailability(tenant, input) {
      live(signal); return readAvailability(tenant, input, native, signal, () => live(signal));
    } }, { withRead(kind, input, consume) {
      live(signal); if (kind !== 'availability' || !isDeepStrictEqual(input, request.data)) throw fail();
      return principal(native, async (tx, stop) => {
        live(stop); if (tx !== native) throw fail();
        const now = current(call);
        if (!now.userId || !now.tenantId || !now.workspaceId || now.audience !== 'operator') throw fail();
        return { userId: now.userId, tenantId: now.tenantId, workspaceId: now.workspaceId, audience: 'operator' };
      }, signal, resolve => withAvailability(request.data.locationId, request.data.lines.length, resolve, async identity => {
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
