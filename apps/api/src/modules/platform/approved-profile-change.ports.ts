/** Server/domain ports for ordinary personal-name changes. Approval references
 * reuse the public approval contract; no DTO field or snapshot grants execution. */
import type { AiApprovalRecordDraft } from '@rental-os/shared';
import type { Prisma } from '@prisma/client';
import type { ApprovedProfileActor } from './approved-profile-route.authority';

export type ApprovedProfileApprovalReference = Pick<AiApprovalRecordDraft,
  'approvalId' | 'proposalId' | 'proposalRevision' | 'payloadHash'>;
export interface ApprovedProfileBinding extends ApprovedProfileActor {
  customerId: string;
  changeId: string;
  changeHash: string;
  baseRevision: number;
  operationKey: string;
  approval: ApprovedProfileApprovalReference;
}
export interface ApprovedProfileOperationReceipt {
  receiptId: string;
  operationKey: string;
  changeId: string;
  changeHash: string;
  customerId: string;
  baseRevision: number;
  resultRevision: number;
  resultName: string;
  resultHash: string;
  committedAt: string;
}
export interface ApprovedProfileParticipant {
  authorize(binding: Readonly<ApprovedProfileBinding>, tx: Prisma.TransactionClient): Promise<void>;
  consume(binding: Readonly<ApprovedProfileBinding>, receipt: Readonly<ApprovedProfileOperationReceipt>, tx: Prisma.TransactionClient): Promise<void>;
  replay(binding: Readonly<ApprovedProfileBinding>, receipt: Readonly<ApprovedProfileOperationReceipt>): Promise<void>;
}
export class ApprovedProfileResultUnknownError extends Error {
  readonly code = 'PROFILE_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'read_original_profile_operation';
  constructor() { super('原普通资料操作结果待核对'); }
}
