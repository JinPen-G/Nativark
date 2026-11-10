import { z } from 'zod';
import { AI_ENTRY_ACTION_CONTRACT_VERSION, aiEntryActionSchema, type AiEntryActionDraft,
  type AiEntryFailureDraft, type AiCustomerEntrySurface } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiClientSceneMaterial } from './prisma-client-scene-material.repository';

export const entryId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const entryHash = z.string().regex(/^[a-f0-9]{64}$/u);
export const entryDate = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export class AiClientEntryError extends Error implements AiEntryFailureDraft {
  readonly retryable = false as const;
  constructor(readonly code: AiEntryFailureDraft['code'], readonly reason: string,
    readonly nextAction: AiEntryFailureDraft['nextAction'] = 'manual_booking') { super(code); }
}
export const entryActionSchema = aiEntryActionSchema;

export function parseEntry<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiClientEntryError('AI_INVALID_INPUT', 'invalid_contract');
  return parsed.data;
}

export function clientEntrySurface(channel: string): AiCustomerEntrySurface {
  if (channel === 'web') return 'tenant_website';
  if (channel === 'wechat_miniprogram') return 'client_miniprogram';
  throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'surface_not_assembled');
}

export function materialEntryAction(row: AiClientSceneMaterial, surface: AiCustomerEntrySurface, policyFingerprint: string,
  policyExpiresAt: Date, resourceId: string, actionCode: 'OPEN_ORDER' | 'CREATE_BOOKING_DRAFT'): AiEntryActionDraft {
  return entryActionSchema.parse({ contractVersion: AI_ENTRY_ACTION_CONTRACT_VERSION,
    actionId: row.id, actionCode, audience: 'customer', surface,
    scope: { kind: 'workspace', tenantId: row.tenantId, workspaceId: row.workspaceId },
    resource: { kind: actionCode === 'OPEN_ORDER' ? 'order' : 'quote', id: resourceId, resourceVersion: row.materialHash },
    requiresConfirmation: actionCode === 'CREATE_BOOKING_DRAFT', riskLevel: actionCode === 'OPEN_ORDER' ? 'R0' : 'R1',
    issuedAt: row.createdAt.toISOString(), expiresAt: new Date(Math.min(row.expiresAt.getTime(), policyExpiresAt.getTime())).toISOString(),
    inputFingerprint: row.inputHash, bindingFingerprint: row.bindingHash, policyFingerprint,
    associations: { materialRef: row.id, taskId: null, proposalId: null,
      quoteId: actionCode === 'CREATE_BOOKING_DRAFT' ? resourceId : null, bookingDraftId: null }
  });
}

export function assertEntryAction(actual: AiEntryActionDraft, expected: AiEntryActionDraft, now: Date) {
  if (Date.parse(actual.expiresAt) <= now.getTime()) throw new AiClientEntryError('AI_PROPOSAL_STALE', 'action_expired', 'reprepare');
  if (requestFingerprint(actual) !== requestFingerprint(expected)) throw new AiClientEntryError('AI_ACCESS_DENIED', 'action_binding_changed');
}
