import type { Prisma } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiApprovalConsumptionInput } from '../approval-consumption.ports';
import type { ApprovedOrderBinding } from '../../rental-core/approved-order-transaction.ports';

export interface AiApprovedOrderInput extends AiApprovalConsumptionInput {
  lease: { runId: string; holderId: string; revision: number; fencingToken: string };
}

export interface AiApprovedOrderAuthority {
  resolve(input: Readonly<AiApprovedOrderInput>, binding: Readonly<ApprovedOrderBinding>,
    action: 'execute' | 'replay', tx?: Prisma.TransactionClient): Promise<AiExecutionContext>;
}
