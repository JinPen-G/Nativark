/** Original-request save audit participant in its caller's Native transaction.
 * Uses actual callback subject/scope, original request-policy/row observation and
 * original OperationLog. No goal/call creation, new ledger, Web fallback, model
 * material, publication, transaction ownership or commit/unknown reconciliation. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { AiSceneRequestReceiptDraft } from '@rental-os/shared';
import type { captureMcpReadInput } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { OperationLogService } from '../../common/operation-log.service';
import type { PrismaOriginalRequestRepository } from '../ai-native/task-request/prisma-original-request.repository';
import type { AiOriginalRequestNativeAuthority } from '../ai-native/task-request/original-request.authority';
import { originalIdentityHash } from '../ai-native/task-request/original-request.authority';
import { captureOriginalMcpRequestCall, createOriginalMcpRequestScopeSource } from './original-mcp-request-scope';
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';

export interface OriginalMcpRequestSaveAudit {
  /** Receipt is the original saveIn association argument, not a caller goal or
   * an external/committed response. Owner awaits this with all metadata before
   * commit, rolls failures back, and separately reconciles unknown by old keys. */
  associateIn(native: Prisma.TransactionClient, receipt: AiSceneRequestReceiptDraft, signal: AbortSignal): Promise<void>;
}
const fail = () => new Error('Original MCP request save audit unavailable');
export function createOriginalMcpRequestSaveAudit(mcp: { captureMcpReadInput: typeof captureMcpReadInput },
  context: OriginalMcpCatalogReadContext, raw: OriginalMcpReadCallRef,
  originals: Pick<PrismaOriginalRequestRepository, 'withCurrentInputIn'>,
  nativeAuthority: AiOriginalRequestNativeAuthority,
  logs: Pick<OperationLogService, 'recordOriginalMcpRequestSaveAudit'>,
  clock: () => Date = () => new Date()): OriginalMcpRequestSaveAudit {
  if (typeof mcp?.captureMcpReadInput !== 'function' || typeof context?.current !== 'function'
    || typeof originals?.withCurrentInputIn !== 'function' || typeof nativeAuthority?.bindIn !== 'function'
    || typeof logs?.recordOriginalMcpRequestSaveAudit !== 'function') throw fail();
  const call = captureOriginalMcpRequestCall(raw), current = context.current.bind(context);
  const subject = structuredClone(current(call));
  if (!subject.userId || !subject.tenantId || !subject.workspaceId || subject.audience !== 'operator') throw fail();
  const capture = mcp.captureMcpReadInput.bind(mcp), observe = originals.withCurrentInputIn.bind(originals);
  const boundAuthority = Object.freeze({ bindIn: nativeAuthority.bindIn.bind(nativeAuthority) });
  const record = logs.recordOriginalMcpRequestSaveAudit.bind(logs), scopes = createOriginalMcpRequestScopeSource(context, clock);
  const live = (signal: AbortSignal) => { if (signal.aborted || !isDeepStrictEqual(subject, structuredClone(current(call)))) throw fail(); };
  return Object.freeze({ async associateIn(native: Prisma.TransactionClient, receipt: AiSceneRequestReceiptDraft, signal: AbortSignal) {
    live(signal);
    if (!native || '$transaction' in native) throw fail();
    // Use the actual neutral JSON capture; getters/private additions must never
    // become SQL or audit fields. Full equality is checked against the original.
    const snapshot = capture(receipt).input;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !('inputRef' in snapshot) || !('draftVersion' in snapshot)) throw fail();
    const before = await scopes.currentIn(call, native, signal); live(signal);
    await observe(native, { draftVersion: snapshot.draftVersion, inputRef: snapshot.inputRef }, async original => {
      live(signal);
      if (!isDeepStrictEqual(snapshot, original.receipt) || original.scopeId !== before.scopeId
        || originalIdentityHash(original.context) !== originalIdentityHash(before.context)) throw fail();
      const scope = original.context.scope, actor = original.context.actor;
      if (scope.kind !== 'workspace' || actor.kind !== 'user' || actor.userId !== subject.userId
        || scope.tenantId !== subject.tenantId || scope.workspaceId !== subject.workspaceId || original.context.audience !== 'operator') throw fail();
      await record(native, { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: actor.userId,
        scopeId: original.scopeId, inputRef: original.receipt.inputRef, revision: original.receipt.revision,
        contentHash: original.receipt.contentHash, sceneCode: original.receipt.sceneCode, sceneVersion: original.receipt.sceneVersion,
        policyRevision: original.policyRevision, policyHash: original.policyHash, grantId: subject.grantId, grantRevision: subject.grantRevision }, signal);
      live(signal);
    }, signal, boundAuthority);
    live(signal);
    const after = await scopes.currentIn(call, native, signal); live(signal);
    if (after.scopeId !== before.scopeId || originalIdentityHash(after.context) !== originalIdentityHash(before.context)) throw fail();
  } });
}
