import type { AiExecutionContext, AiUsageAssociationDraft, AiUsageQuantityDraft, AiUsageSettingsDraft } from '@rental-os/shared';

export type BudgetAction = 'settings_read' | 'settings_write' | 'reserve' | 'dispatch' | 'read' | 'settle' | 'release' | 'unknown' | 'reconcile';
export type BudgetStatus = 'reserved' | 'settled' | 'released' | 'pending_reconciliation';
export interface BudgetPolicyKey { scopeId: string; scopeKind: 'PLATFORM' | 'TENANT' | 'WORKSPACE'; sceneCode: string; }
export interface BudgetPolicy extends BudgetPolicyKey { id: string; revision: number; settings: AiUsageSettingsDraft; }
export interface BudgetGrant {
  context: AiExecutionContext;
  /** Fresh, action-specific result from the server authorization adapter. */
  authorizationKey: string;
  expiresAt: Date;
  entitled: boolean;
}
export interface BudgetAuthority {
  resolve(action: BudgetAction, resource: Readonly<{ association?: AiUsageAssociationDraft; reservationId?: string; policy?: BudgetPolicyKey }>): Promise<BudgetGrant>;
}
export interface BudgetReserveCommand {
  association: AiUsageAssociationDraft;
  callId: string;
  sceneCode: string;
  expiresAt: Date;
}
export interface BudgetQuote {
  association: AiUsageAssociationDraft;
  callId: string;
  sceneCode: string;
  model: string;
  quantity: AiUsageQuantityDraft;
  /** Scope keys are resolved by this trusted port, never supplied by the model. */
  policies: BudgetPolicyKey[];
  consumerScope: BudgetPolicyKey;
  evidenceHash: string;
  expiresAt: Date;
}
export interface BudgetQuotePort { quote(command: Readonly<BudgetReserveCommand>, grant: Readonly<BudgetGrant>): Promise<BudgetQuote>; }
export interface BudgetRecord {
  id: string; scopeId: string; scopeKind: 'PLATFORM' | 'TENANT' | 'WORKSPACE'; revision: number; storageVersion: Date; association: AiUsageAssociationDraft; callId: string; sceneCode: string;
  status: BudgetStatus; reserved: AiUsageQuantityDraft; actual: AiUsageQuantityDraft | null;
  dispatched: boolean; unknownReason: string | null; expiresAt: Date;
}
export interface BudgetUsageEvidence {
  quantity: AiUsageQuantityDraft;
  inputTokens?: number;
  outputTokens?: number;
  evidenceHash: string;
}
export interface BudgetEvidencePort {
  /** Resolve dispatch/usage evidence independently of caller claims. */
  dispatch(record: Readonly<BudgetRecord>): Promise<'not_dispatched' | 'dispatched' | 'unknown'>;
  usage(record: Readonly<BudgetRecord>, evidenceRef: string, reconcile: boolean): Promise<BudgetUsageEvidence>;
}
export interface BudgetTransactionRepository {
  settings(key: BudgetPolicyKey): Promise<BudgetPolicy | null>;
  saveSettings(key: BudgetPolicyKey, settings: AiUsageSettingsDraft, expectedRevision: number, revalidate: () => Promise<void>): Promise<BudgetPolicy>;
  reserve(quote: BudgetQuote, command: BudgetReserveCommand, identityHash: string, revalidate: () => Promise<void>): Promise<BudgetRecord>;
  get(id: string, association: AiUsageAssociationDraft): Promise<BudgetRecord | null>;
  /** All mutations and ledger events are one DB transaction. No blind retry. */
  mutate(record: BudgetRecord, input: { action: 'dispatch' | 'settle' | 'release' | 'unknown' | 'reconcile'; eventKey: string; usage?: BudgetUsageEvidence; reason?: string }, revalidate: () => Promise<void>): Promise<BudgetRecord>;
}
export class BudgetError extends Error {
  constructor(readonly code: 'INVALID' | 'FORBIDDEN' | 'UNAVAILABLE' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'EXHAUSTED' | 'PENDING_RECONCILIATION') { super(code); }
}
