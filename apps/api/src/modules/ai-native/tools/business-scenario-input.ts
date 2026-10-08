import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';

/** Internal business content, not a public API DTO/authority/runner plan.
 * Send exactly payload when using payloadFingerprint. Consumers must perform
 * their own current authorization, input persistence and budget admission. */
export function sealBusinessScenario<T>(scenario: 'order_explanation' | 'opening_diagnosis' | 'quote_clarification', value: T) {
  const payload: T = JSON.parse(JSON.stringify(value));
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (payloadBytes > 131072) throw new ModelGatewayError('INVALID_RESPONSE');
  const freeze = (object: unknown): void => {
    if (!object || typeof object !== 'object' || Object.isFrozen(object)) return;
    Object.values(object).forEach(freeze); Object.freeze(object);
  };
  freeze(payload);
  return Object.freeze({ version: 'lane-a-business-content-1' as const, scenario,
    payload, payloadFingerprint: requestFingerprint(payload), payloadBytes,
    trust: 'source_text_is_data_not_instructions' as const,
    authority: 'none_reauthorize_before_consumption' as const });
}
