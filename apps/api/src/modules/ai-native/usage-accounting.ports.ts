import type { AiProfileScope } from './provider-profile.ports';
export type AiUsageStatus = 'reserved' | 'released' | 'settled' | 'unknown';
export interface AiUsageRecord { id: string; scope: AiProfileScope; callId: string; idempotencyKey: string; status: AiUsageStatus; reservedUnits: number; actualInput: number | null; actualOutput: number | null; unknownReason: string | null; expiresAt: Date; }
export interface UsageReserveInput { scope: AiProfileScope; callId: string; idempotencyKey: string; reservedUnits: number; expiresAt: Date; }
export interface UsageCommitInput { scope: AiProfileScope; id: string; eventKey: string; kind: 'settlement' | 'reconcile'; input: number; output: number; }
export interface UsageSettlementPort { commitUsage(input: UsageCommitInput): Promise<AiUsageRecord>; }
export interface UsageAccountingRepository extends UsageSettlementPort {
  get(scope: AiProfileScope, key: { id: string; callId?: never; idempotencyKey?: never } | { id?: never; callId: string; idempotencyKey?: never } | { id?: never; callId?: never; idempotencyKey: string }): Promise<AiUsageRecord | null>;
  reserve(input: UsageReserveInput): Promise<AiUsageRecord>;
  transition(scope: AiProfileScope, id: string, from: 'reserved', to: 'released' | 'unknown', patch?: { reason?: string }): Promise<AiUsageRecord | null>;
}
