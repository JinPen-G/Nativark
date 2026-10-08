import type { Prisma } from '@prisma/client';
import type { TenantRentalBusinessSettings } from '@rental-os/shared';
import type { CategoryWriteBinding } from './category-active-write';

export type ApprovedSettingsNotifications = TenantRentalBusinessSettings['notifications'];
export interface VersionedBusinessSettings {
  settings: TenantRentalBusinessSettings;
  settingsRevision: number;
}
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
export interface ApprovedSettingsParticipant {
  authorize(binding: Readonly<ApprovedSettingsBinding>, tx: Prisma.TransactionClient): Promise<void>;
  // Revalidate the exact approval and write its one-time consumption using this transaction only.
  consume(binding: Readonly<ApprovedSettingsBinding>, receipt: Readonly<ApprovedSettingsOperationReceipt>, tx: Prisma.TransactionClient): Promise<void>;
  // Verify the original consumption, not today's expiry or execution eligibility.
  replay(binding: Readonly<ApprovedSettingsBinding>, receipt: Readonly<ApprovedSettingsOperationReceipt>): Promise<void>;
}
export class ApprovedSettingsResultUnknownError extends Error {
  readonly code = 'SETTINGS_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'read_operation';
  constructor() { super('SETTINGS_RESULT_UNKNOWN'); }
}
