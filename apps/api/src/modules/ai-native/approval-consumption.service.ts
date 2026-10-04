import { ModelGatewayError } from './model-gateway.ports';
import type {
  AiApprovalConsumptionAuthority,
  AiApprovalConsumptionInput,
  AiApprovalConsumptionRecord,
  AiApprovalConsumptionRepository
} from './approval-consumption.ports';

const validId = (value: string) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
const validHash = (value: string) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const validRevision = (value: number) => Number.isSafeInteger(value) && value > 0;

/**
 * AIN-07's persistence boundary. It reserves one action, then lets the Core
 * business transaction consume it. It never executes a tool or marks a
 * business operation successful on its own.
 */
export class AiApprovalConsumptionService {
  constructor(
    private readonly repository: AiApprovalConsumptionRepository,
    private readonly authority: AiApprovalConsumptionAuthority
  ) {
    if (!repository || !authority || typeof repository.reserve !== 'function' || typeof authority.authorize !== 'function') {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
  }

  private validate(input: AiApprovalConsumptionInput) {
    if (!input || !input.context || !validId(input.scopeId) || !validId(input.taskId) || !validId(input.actionId)
      || !validId(input.approvalId) || !validId(input.proposalId) || !validRevision(input.proposalRevision)
      || !validHash(input.actionFingerprint) || !validId(input.businessIdempotencyKey)) {
      throw new ModelGatewayError('INVALID_REQUEST');
    }
    return structuredClone(input);
  }

  private async authorized(input: AiApprovalConsumptionInput, operation: Parameters<AiApprovalConsumptionAuthority['authorize']>[1]) {
    try { await this.authority.authorize(structuredClone(input), operation); }
    catch { throw new ModelGatewayError('FORBIDDEN'); }
  }

  async reserve(input: AiApprovalConsumptionInput): Promise<AiApprovalConsumptionRecord> {
    const copy = this.validate(input);
    await this.authorized(copy, 'reserve');
    try {
      const { context: _context, ...persisted } = copy;
      return structuredClone(await this.repository.reserve(persisted));
    }
    catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      const code = (error as { code?: string })?.code;
      if (code === 'INVALID_BINDING') throw new ModelGatewayError('FORBIDDEN');
      if (code === 'CONFLICT') throw new ModelGatewayError('CONFIG_INVALID');
      throw new ModelGatewayError('CONFIG_INVALID');
    }
  }

  private async mutate(input: AiApprovalConsumptionInput, operation: Parameters<AiApprovalConsumptionAuthority['authorize']>[1], mutation: () => Promise<AiApprovalConsumptionRecord>) {
    const copy = this.validate(input);
    await this.authorized(copy, operation);
    try { return structuredClone(await mutation()); }
    catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if ((error as { code?: string })?.code === 'UNKNOWN') throw new ModelGatewayError('ACCOUNTING_PENDING');
      throw new ModelGatewayError('CONFIG_INVALID');
    }
  }

  async commit(input: AiApprovalConsumptionInput, resultRef: string) {
    if (!validId(resultRef)) throw new ModelGatewayError('INVALID_REQUEST');
    const copy = this.validate(input);
    return this.mutate(copy, 'commit', () => this.repository.commit({ scopeId: copy.scopeId, taskId: copy.taskId, actionId: copy.actionId, businessIdempotencyKey: copy.businessIdempotencyKey, resultRef }));
  }

  async markUnknown(input: AiApprovalConsumptionInput) {
    const copy = this.validate(input);
    return this.mutate(copy, 'unknown', () => this.repository.markUnknown({ scopeId: copy.scopeId, taskId: copy.taskId, actionId: copy.actionId, businessIdempotencyKey: copy.businessIdempotencyKey }));
  }

  async markFailedNoEffect(input: AiApprovalConsumptionInput) {
    const copy = this.validate(input);
    return this.mutate(copy, 'failed_no_effect', () => this.repository.markFailedNoEffect({ scopeId: copy.scopeId, taskId: copy.taskId, actionId: copy.actionId, businessIdempotencyKey: copy.businessIdempotencyKey }));
  }
}
