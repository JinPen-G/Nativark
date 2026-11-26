/** The original persisted model intent, routing and identity binding. Scene
 * adapters add their own material validation before any invocation is registered. */
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const taskModelInputBindingSchema = z.object({ mode: z.enum(['invoke', 'stream']), intent: z.unknown(), configuration: z.unknown(),
  priceVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u), routingHash: hash, identityHash: hash }).strict();

export function taskModelIdentity({ requestId: _, authorizedAt: __, ...context }: AiExecutionContext) {
  return requestFingerprint(context);
}
