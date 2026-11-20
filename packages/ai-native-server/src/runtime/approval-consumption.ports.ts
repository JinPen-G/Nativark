import type { AiExecutionContext } from '@rental-os/shared';

export type AiApprovalConsumptionStatus = 'reserved' | 'committed' | 'unknown' | 'failed_no_effect';

export interface AiApprovalConsumptionInput {
  context: AiExecutionContext;
  scopeId: string;
  taskId: string;
  actionId: string;
  approvalId: string;
  proposalId: string;
  proposalRevision: number;
  actionFingerprint: string;
  businessIdempotencyKey: string;
}

export interface AiApprovalConsumptionRecord extends Omit<AiApprovalConsumptionInput, 'context'> {
  status: AiApprovalConsumptionStatus;
  resultRef: string | null;
}

/** The application must bind this to its real current authorization source. */
export interface AiApprovalConsumptionAuthority {
  authorize(input: Readonly<AiApprovalConsumptionInput>, operation: 'reserve' | 'commit' | 'unknown' | 'failed_no_effect'): Promise<void>;
}

export interface AiApprovalConsumptionRepository {
  reserve(input: Omit<AiApprovalConsumptionInput, 'context'>): Promise<AiApprovalConsumptionRecord>;
  commit(input: Pick<AiApprovalConsumptionInput, 'scopeId' | 'taskId' | 'actionId' | 'businessIdempotencyKey'> & { resultRef: string }): Promise<AiApprovalConsumptionRecord>;
  markUnknown(input: Pick<AiApprovalConsumptionInput, 'scopeId' | 'taskId' | 'actionId' | 'businessIdempotencyKey'>): Promise<AiApprovalConsumptionRecord>;
  markFailedNoEffect(input: Pick<AiApprovalConsumptionInput, 'scopeId' | 'taskId' | 'actionId' | 'businessIdempotencyKey'>): Promise<AiApprovalConsumptionRecord>;
}
