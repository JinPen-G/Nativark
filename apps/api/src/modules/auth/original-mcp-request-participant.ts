/** Original MCP request participant: same-Native save + mandatory original audit,
 * and separate original-key observation. No transaction/commit owner, goal/Task,
 * tool publication or budget. The original caller supplies the trusted command
 * mapping and fences, awaits all participants, and reconciles unknown by old keys. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { captureMcpReadInput, OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { OperationLogService } from '../../common/operation-log.service';
import type { PrismaOriginalRequestRepository } from '../ai-native/task-request/prisma-original-request.repository';
import type { AiOriginalRequestNativeAuthority } from '../ai-native/task-request/original-request.authority';
import type { OriginalMcpCatalogReadContext } from './original-mcp-read-context';
import { captureOriginalMcpRequestCall } from './original-mcp-request-scope';
import { createOriginalMcpRequestSaveAudit } from './original-mcp-request-save-audit';

type Originals = Pick<PrismaOriginalRequestRepository, 'saveIn' | 'reconcileIn' | 'withCurrentInputIn'>;
export interface OriginalMcpRequestParticipant {
  /** Only prepares the original save and audit inside this active Native. It does
   * not establish a first catalog goal, call locator or committed response. */
  saveIn(native: Prisma.TransactionClient, command: unknown, signal: AbortSignal, isReissue?: boolean): ReturnType<Originals['saveIn']>;
  /** Current independent historical read, never a save/audit replay or Task read.
   * The owner supplies a fresh read Native and confirms its own read transaction. */
  reconcileIn(native: Prisma.TransactionClient, command: unknown, signal: AbortSignal, isReissue?: boolean): ReturnType<Originals['reconcileIn']>;
}
const fail = () => new Error('Original MCP request participant unavailable');

/** Construct in the real authorized callback, with the real Native authority and
 * original repository/log service. Capture methods, not mutable Web/SQL defaults.
 * Missing dependencies reject even if only reconciliation was intended; callers
 * needing a read-only port may use the original repository's reconcileIn directly. */
export function createOriginalMcpRequestParticipant(mcp: { captureMcpReadInput: typeof captureMcpReadInput },
  context: OriginalMcpCatalogReadContext, raw: OriginalMcpReadCallRef, originals: Originals,
  nativeAuthority: AiOriginalRequestNativeAuthority,
  logs: Pick<OperationLogService, 'recordOriginalMcpRequestSaveAudit'>,
  clock: () => Date = () => new Date()): OriginalMcpRequestParticipant {
  if (typeof mcp?.captureMcpReadInput !== 'function' || typeof context?.current !== 'function'
    || typeof originals?.saveIn !== 'function' || typeof originals.reconcileIn !== 'function'
    || typeof originals.withCurrentInputIn !== 'function' || typeof nativeAuthority?.bindIn !== 'function'
    || typeof logs?.recordOriginalMcpRequestSaveAudit !== 'function' || typeof clock !== 'function') throw fail();
  const call = captureOriginalMcpRequestCall(raw), current = context.current.bind(context);
  const subject = structuredClone(current(call));
  const capture = mcp.captureMcpReadInput.bind(mcp), save = originals.saveIn.bind(originals), reconcile = originals.reconcileIn.bind(originals);
  const authority = Object.freeze({ bindIn: nativeAuthority.bindIn.bind(nativeAuthority) });
  const audit = createOriginalMcpRequestSaveAudit(mcp, context, call, originals, authority, logs, clock);
  const live = (native: Prisma.TransactionClient, signal: AbortSignal, isReissue: boolean) => {
    if (!native || '$transaction' in native || signal.aborted || typeof isReissue !== 'boolean'
      || !isDeepStrictEqual(subject, structuredClone(current(call)))) throw fail();
  };
  return Object.freeze({
    async saveIn(native: Prisma.TransactionClient, value: unknown, signal: AbortSignal, isReissue = false) {
      live(native, signal, isReissue);
      const command = capture(value).input; // ordinary JSON snapshot before any await
      let entered = false, associated: unknown;
      const prepared = await save(native, command, authority, signal, isReissue, async (tx, receipt) => {
        live(native, signal, isReissue);
        if (tx !== native || entered) throw fail();
        entered = true;
        await audit.associateIn(tx, receipt, signal);
        live(native, signal, isReissue);
        associated = capture(receipt).input;
      });
      live(native, signal, isReissue);
      // The original association receipt excludes save's replay marker. Never
      // return preparation if an adapter skipped audit or adopted a different row.
      const { replayed: _replayed, ...receipt } = prepared.receipt;
      if (!entered || associated === undefined || prepared.state !== 'prepared' || prepared.commit !== 'not_observed'
        || !isDeepStrictEqual(associated, capture(receipt).input)) throw fail();
      return prepared;
    },
    async reconcileIn(native: Prisma.TransactionClient, value: unknown, signal: AbortSignal, isReissue = false) {
      live(native, signal, isReissue);
      const command = capture(value).input;
      const observed = await reconcile(native, command, authority, signal, isReissue);
      live(native, signal, isReissue);
      return observed;
    },
  });
}
