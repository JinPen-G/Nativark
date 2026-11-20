import type { AiExecutionContext, AiUsageAssociationDraft, AiUsageQuantityDraft, AiUsageSettingsDraft } from '@rental-os/shared';

export type BudgetAction = 'settings_read' | 'settings_write' | 'reserve' | 'dispatch' | 'read' | 'settle' | 'release' | 'unknown' | 'reconcile';
/** Original reservation lifecycle only. These actions cannot admit a new call;
 * current action authority and persisted association/evidence remain mandatory. */
export function isOriginalBudgetLifecycleAction(action: BudgetAction): boolean {
  return action === 'read' || action === 'settle' || action === 'release' || action === 'unknown' || action === 'reconcile';
}
export type BudgetStatus = 'reserved' | 'settled' | 'released' | 'pending_reconciliation';
export interface BudgetPolicyKey { scopeId: string; scopeKind: 'PLATFORM' | 'TENANT' | 'WORKSPACE'; sceneCode: string; }
export interface BudgetPolicy extends BudgetPolicyKey { id: string; revision: number; settings: AiUsageSettingsDraft; }
/** Server-bound management operation, not budget admission or a dispatch token. */
export type BudgetSettingsOperation = { operationKey: string; commandHash: string; actorId: string } & (
  | { kind?: undefined; action: 'change' | 'initialize' | 'refreshConfiguration'; tenantId: string; workspaceId: string }
  | { kind: 'platform'; action: 'platformSave' });
export interface BudgetGrant {
  context: AiExecutionContext;
  /** Fresh, action-specific result from the server authorization adapter. */
  authorizationKey: string;
  expiresAt: Date;
  /** Current commercial permission for NEW usage, not authority over old money.
   * False blocks settings/new admission; original accounting needs its own grant. */
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
  countRequestHash?: string;
}
export interface BudgetQuote {
  association: AiUsageAssociationDraft;
  callId: string;
  sceneCode: string;
  model: string;
  actorId: string;
  quantity: AiUsageQuantityDraft;
  /** Scope keys are resolved by this trusted port, never supplied by the model. */
  policies: BudgetPolicyKey[];
  consumerScope: BudgetPolicyKey;
  evidenceHash: string;
  expiresAt: Date;
}
export interface BudgetQuotePort { quote(command: Readonly<BudgetReserveCommand>, grant: Readonly<BudgetGrant>): Promise<BudgetQuote>; }
export interface BudgetRecord {
  id: string; scopeId: string; scopeKind: 'PLATFORM' | 'TENANT' | 'WORKSPACE'; actorId: string; revision: number; storageVersion: Date; association: AiUsageAssociationDraft; callId: string; sceneCode: string;
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
  saveSettings(key: BudgetPolicyKey, settings: AiUsageSettingsDraft, expectedRevision: number, revalidate: () => Promise<void>, operation?: BudgetSettingsOperation): Promise<BudgetPolicy>;
  reserve(quote: BudgetQuote, command: BudgetReserveCommand, identityHash: string, revalidate: () => Promise<void>): Promise<BudgetRecord>;
  get(id: string, association: AiUsageAssociationDraft): Promise<BudgetRecord | null>;
  /** Exact original ledger event only. Optional for legacy adapters; absence
   * cannot be inferred from a current balance or by replaying mutate. */
  readMutation?(record: BudgetRecord, input: { action: 'release' | 'reconcile'; eventKey: string; usage?: BudgetUsageEvidence }, revalidate: () => Promise<void>): Promise<BudgetRecord | null>;
  /** All mutations and ledger events are one DB transaction. No blind retry. */
  mutate(record: BudgetRecord, input: { action: 'dispatch' | 'settle' | 'release' | 'unknown' | 'reconcile'; eventKey: string; usage?: BudgetUsageEvidence; reason?: string }, revalidate: () => Promise<void>): Promise<BudgetRecord>;
}
export class BudgetError extends Error {
  constructor(readonly code: 'INVALID' | 'FORBIDDEN' | 'UNAVAILABLE' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'EXHAUSTED' | 'PENDING_RECONCILIATION') { super(code); }
}
