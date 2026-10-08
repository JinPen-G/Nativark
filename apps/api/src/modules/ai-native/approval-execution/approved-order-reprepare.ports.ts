import type { Prisma } from '@prisma/client';
import type { AiExecutionContext, CreateRentalOrderRequest } from '@rental-os/shared';
import type { AiApprovalReprepareCommandDraft, AiApprovalReprepareReceiptDraft } from '../../../../../../packages/shared/src/ai-approval-application-draft';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import type { AiApprovedOrderInput } from './approved-order.ports';

export interface ApprovedOrderReprepareServices {
  selection: {
    readAuthorized(value: { draftVersion: 'ain-quote-selection-draft-1'; originalInputRef: string; selectionId: string;
      taskId: string; runId: string; inputHash: string }, tx?: Prisma.TransactionClient): Promise<{
      context: AiExecutionContext; scopeId: string; taskId: string; runId: string; originalInputRef: string;
      originalInputHash: string; selectionId: string; selectionRevision: number; quoteId: string; quoteHash: string;
      inputHash: string; body: Readonly<CreateRentalOrderRequest>; expiresAt: string; bindingHash: string;
    }>;
  };
  lease: {
    current(reference: AiApprovalReprepareCommandDraft['replacement'], tx: Prisma.TransactionClient): Promise<AiApprovedOrderInput['lease'] | null>;
  };
}
export type ApprovedOrderReprepareServicesFactory = (dependencies: ControlledApprovedOrderDependencies) => ApprovedOrderReprepareServices;
export interface ApprovedOrderReprepareApplication {
  reprepare(value: unknown): Promise<AiApprovalReprepareReceiptDraft>;
  readReceipt(value: unknown): Promise<AiApprovalReprepareReceiptDraft>;
}
