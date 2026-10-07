import type { Prisma } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';

export interface ApprovedOrderInputReference {
  scopeId: string;
  taskId: string;
  runId: string;
  stepId: string;
  actionId: string;
  inputRef: string;
  registrationRef: string;
  fingerprint: string;
}

export interface ApprovedOrderInputAuthority {
  authorizeOrderInput(reference: Readonly<ApprovedOrderInputReference>, tx: Prisma.TransactionClient): Promise<{
    context: AiExecutionContext;
    reference: ApprovedOrderInputReference;
    toolCode: 'rental.order.commit';
    toolVersion: string;
    policyRevision: number;
    policyHash: string;
    bindingHash: string;
    expiresAt: string;
  }>;
}
