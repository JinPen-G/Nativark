/** Rental通知设置的批准、修订与原操作合同；参与者只在调用方同一事务消费原批准，恢复不新授执行权。 */
import type { TenantRentalBusinessSettings } from './contracts';
import type { CategoryWriteBinding } from './configuration-basis';

export type ApprovedSettingsNotifications = TenantRentalBusinessSettings['notifications'];
import type { VersionedBusinessSettings } from "./configuration-basis";
export type { VersionedBusinessSettings } from "./configuration-basis";
export interface NotificationSettingsPreview extends VersionedBusinessSettings {
  baseSettingsHash: string;
  before: ApprovedSettingsNotifications;
  after: ApprovedSettingsNotifications;
  binding: CategoryWriteBinding;
  nextSettings: TenantRentalBusinessSettings;
}
export interface ApprovedSettingsReference {
  proposalId: string;
  proposalRevision: number;
  approvalId: string;
  reviewedPayloadHash: string;
}
export interface ApprovedSettingsBinding {
  tenantId: string;
  workspaceId: string;
  actorId: string;
  operationKey: string;
  changeId: string;
  changeHash: string;
  baseRevision: number;
  approval: ApprovedSettingsReference;
}
export interface ApprovedSettingsOperationReceipt {
  receiptId: string;
  operationKey: string;
  changeId: string;
  changeHash: string;
  baseRevision: number;
  resultRevision: number;
  resultHash: string;
  committedAt: string;
}
export interface ApprovedSettingsParticipant<TTransaction = unknown> {
  authorize(binding: Readonly<ApprovedSettingsBinding>, tx: TTransaction): Promise<void>;
  // Revalidate the exact approval and write its one-time consumption using this transaction only.
  consume(binding: Readonly<ApprovedSettingsBinding>, receipt: Readonly<ApprovedSettingsOperationReceipt>, tx: TTransaction): Promise<void>;
  // Verify the original consumption, not today's expiry or execution eligibility.
  replay(binding: Readonly<ApprovedSettingsBinding>, receipt: Readonly<ApprovedSettingsOperationReceipt>): Promise<void>;
}
export class ApprovedSettingsResultUnknownError extends Error {
  readonly code = 'SETTINGS_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'read_operation';
  constructor() { super('SETTINGS_RESULT_UNKNOWN'); }
}
