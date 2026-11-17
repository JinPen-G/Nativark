/** Private notification-draft inputs and observations for the registered R1
 * Action. Public HTTP/shared adapters remain at the application boundary.
 * A review hash is consistency evidence, never permission to send or retry. */
import { z } from 'zod';
import type { RentalNotificationDraftObservation } from '../../rental-core/rental-business.service';
import { AI_ENTRY_NOTIFICATION_DRAFT_VERSION, aiEntryNotificationDraftPrepareSchema,
  aiEntryNotificationDraftSaveCommandSchema, aiEntryNotificationDraftReadSchema,
  aiEntryNotificationDraftResourceSchema } from '@rental-os/shared';

export const ENTRY_NOTIFICATION_DRAFT_VERSION = AI_ENTRY_NOTIFICATION_DRAFT_VERSION;
export const entryNotificationDraftPrepareSchema = aiEntryNotificationDraftPrepareSchema;
export const entryNotificationDraftSaveSchema = aiEntryNotificationDraftSaveCommandSchema;
export const entryNotificationDraftReadSchema = aiEntryNotificationDraftReadSchema;
export const entryNotificationDraftResourceSchema = aiEntryNotificationDraftResourceSchema;
export type EntryNotificationDraftPrepare = z.infer<typeof entryNotificationDraftPrepareSchema>;
export type EntryNotificationDraftSave = z.infer<typeof entryNotificationDraftSaveSchema>;
export type EntryNotificationDraftRead = z.infer<typeof entryNotificationDraftReadSchema>;

export interface EntryNotificationDraftCredentials {
  current(): Promise<{ authorization: string; audience: 'operator' | 'staff'; requestId: string }>;
}
export type EntryNotificationDraftResponse = {
  contractVersion: typeof ENTRY_NOTIFICATION_DRAFT_VERSION;
  operationKey: string;
  scope: { kind: 'workspace'; tenantId: string; workspaceId: string };
  observedAt: string;
  automaticRetry: false;
  dispatch: 'not_dispatched';
  nextAction: 'explicit_save_or_original_notification_page' | 'read_original_notification_draft';
} & (
  | { state: 'prepared'; material: RentalNotificationDraftObservation; reviewHash: string; expiresAt: string;
      persistence: 'not_saved'; execution: 'not_attempted' }
  | { state: 'saved'; draft: RentalNotificationDraftObservation; persistence: 'draft_saved'; execution: 'not_sent' }
  | { state: 'unknown'; draft: null; persistence: 'not_attested'; execution: 'not_attested' }
);

export class EntryNotificationDraftError extends Error {
  readonly retryable = false;
  readonly nextAction = 'read_original_notification_draft' as const;
  constructor(readonly code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_REVISION_CONFLICT'
    | 'AI_RESOURCE_UNAVAILABLE' | 'AI_RESULT_UNKNOWN') { super(code); }
}

export function parseEntryNotificationDraft<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  let copy: unknown;
  try {
    copy = structuredClone(value);
    if (Buffer.byteLength(JSON.stringify(copy) ?? '', 'utf8') > 32768) throw Error();
  } catch { throw new EntryNotificationDraftError('AI_INVALID_INPUT'); }
  const result = schema.safeParse(copy);
  if (!result.success) throw new EntryNotificationDraftError('AI_INVALID_INPUT');
  return result.data;
}
