import type { AiProfileScope } from './provider-profile.ports';
export type AiUsageStatus = 'reserved' | 'released' | 'settled' | 'unknown';
export interface AiUsageRecord { id: string; scope: AiProfileScope; callId: string; idempotencyKey: string; status: AiUsageStatus; reservedUnits: number; actualInput: number | null; actualOutput: number | null; unknownReason: string | null; expiresAt: Date; }
export interface UsageReserveInput { scope: AiProfileScope; callId: string; idempotencyKey: string; reservedUnits: number; expiresAt: Date; }
export interface UsageAccountingRepository {
  get(scope: AiProfileScope, key: { callId?: string; idempotencyKey?: string }): Promise<AiUsageRecord | null>;
  reserve(input: UsageReserveInput): Promise<AiUsageRecord>;
  transition(scope: AiProfileScope, id: string, from: AiUsageStatus, to: AiUsageStatus, patch?: { input?: number; output?: number; reason?: string }): Promise<AiUsageRecord | null>;
  appendLedger(input: { reservationId: string; tenantId: string; eventKey: string; kind: string; input: number; output: number }): Promise<void>;
}
