/** Client-entry refusals in the existing OperationLog. The original Guard
 * supplies the attempted principal. Commands, credentials and business effects
 * are never projected into this observation. */
import type { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AI_ENTRY_ACTION_CONTRACT_VERSION } from '@rental-os/shared';
import type { ClientRequestContext } from '../../client/client-auth.service';
import { AiClientEntryError } from './client-entry-action';
import { originalClientMaterialScope } from './prisma-client-scene-material.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const refusalCodes = new Set(['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE',
  'AI_PROPOSAL_STALE', 'AI_REVISION_CONFLICT', 'AI_RESULT_UNKNOWN']);
const observations = new AsyncLocalStorage<{ requestId: string; attempted: boolean }>();

/** Server-only receipt correlation. The original reader verifies ownership;
 * unknown denotes its observation, never proof of no commit or a send grant. */
export type ClientEntryAuditOrigin = Readonly<{
  ownerHash: string; kind: 'material' | 'task_creation' | 'booking' | 'transfer' | 'submission';
  locatorHash: string; state: 'observed' | 'unknown';
  materialRef?: string; inputRef?: string; taskId?: string; originRunId?: string;
  draftId?: string; handoffRef?: string; acceptanceRef?: string; transferRef?: string;
}>;

/** The Controller and its original application share one observation attempt.
 * Direct application calls get their own context, including concurrent refusals. */
export function withClientEntryRefusalAudit<T>(work: () => Promise<T>): Promise<T> {
  if (observations.getStore()) return work();
  return observations.run({ requestId: randomUUID(), attempted: false }, work);
}

export async function recordClientEntryRefusal(store: Pick<PrismaClient, 'operationLog'>, identity: ClientRequestContext,
  event: { channel: 'web' | 'wechat_miniprogram'; operation: string; code: string; durationMs: number; origin?: ClientEntryAuditOrigin }) {
  const fail = () => new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_entry_refusal_audit_unavailable');
  const observation = observations.getStore();
  if (!observation) throw fail();
  if (observation.attempted) return;
  const { requestId } = observation;
  if (typeof store.operationLog?.create !== 'function' || !refusalCodes.has(event.code)
    || ![identity.tenantId, identity.workspaceId, identity.customerId, requestId, event.operation]
      .every(value => typeof value === 'string' && identifier.test(value))
    || !Number.isFinite(event.durationMs) || event.durationMs < 0) throw fail();
  const source = event.code === 'AI_RESULT_UNKNOWN' ? event.origin : undefined;
  const ownerHash = requestFingerprint(originalClientMaterialScope(identity, event.channel));
  let origin: Omit<ClientEntryAuditOrigin, 'ownerHash'> | undefined;
  if (source && source.ownerHash === ownerHash && /^[a-f0-9]{64}$/u.test(source.locatorHash)
    && ['material', 'task_creation', 'booking', 'transfer', 'submission'].includes(source.kind)
    && ['observed', 'unknown'].includes(source.state)) {
    const { ownerHash: _ownerHash, ...receipt } = source;
    const fields = ['materialRef', 'inputRef', 'taskId', 'originRunId', 'draftId', 'handoffRef', 'acceptanceRef', 'transferRef'] as const;
    if (Object.keys(receipt).every(key => ['kind', 'locatorHash', 'state', ...fields].includes(key))
      && fields.every(key => receipt[key] === undefined || typeof receipt[key] === 'string' && identifier.test(receipt[key]!)))
      origin = receipt;
  }
  // Set before the await. An uncertain write is not a license to append again
  // when the same failure reaches the Controller's response boundary.
  observation.attempted = true;
  const result = await store.operationLog.create({ data: {
    tenantId: identity.tenantId, workspaceId: identity.workspaceId, action: 'ai.native.entry.observation',
    detail: { operator: identity.customerId, targetType: 'ai-client-entry', targetId: requestId,
      metadata: { version: AI_ENTRY_ACTION_CONTRACT_VERSION, requestId, stage: 'ENTRY',
        audience: 'client', surface: event.channel === 'web' ? 'tenant_website' : 'client_miniprogram',
        actorKind: 'customer', actorId: identity.customerId, operation: event.operation,
        state: event.code === 'AI_RESULT_UNKNOWN' ? 'unknown' : 'refused', refusalCode: event.code,
        durationMs: Math.min(Math.floor(event.durationMs), 120000), ...(origin ? { original: origin } : {}) } },
  }, select: { id: true } });
  if (!result || typeof result.id !== 'string' || !identifier.test(result.id)) throw fail();
}
