import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';

/** Expected context is a server aggregation binding, never authority. The
 * original Guard must first resolve `current`; refreshed timestamps may vary. */
export function assertAiReadContextBinding(current: AiExecutionContext, expected?: AiExecutionContext): void {
  if (!expected) return;
  const principal = (context: AiExecutionContext) => {
    const { authorizedAt: _, requestId: __, ...value } = context;
    return requestFingerprint(value);
  };
  if (principal(current) !== principal(expected)) throw new ModelGatewayError('FORBIDDEN');
}
